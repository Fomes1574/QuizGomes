import type { Env } from '../env.js';
import { ApiError } from '../http/api-error.js';
import { isQuestionImageKey } from '../storage/image-storage.js';

/**
 * Perguntas apagadas por chamada. Cada chamada fica pequena (poucos
 * parâmetros por consulta e pouco CPU); o painel repete até não sobrar nada.
 */
export const PURGE_CHUNK = 40;
/** Partidas/desafios apagados por consulta (abaixo dos 100 parâmetros do D1). */
const CONTEXT_CHUNK = 90;
/** Partidas que ainda estão acontecendo: com elas, nada é apagado. */
const LIVE_MATCH_STATUSES = "('PREPARING', 'PLAYING', 'WAITING_SECOND')";
/** Desafios ainda vivos no tema: são cancelados antes de apagar. */
const LIVE_CHALLENGE_STATUSES = "('PENDING_DIRECT', 'WAITING_FOR_SECOND')";

export interface PurgeStep {
  deletedImages: number;
  deletedQuestions: number;
  remaining: number;
}

function list(count: number, offset = 0): string {
  return Array.from({ length: count }, (_, index) => `?${index + 1 + offset}`).join(',');
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

/** O nome digitado bate com o do tema (sem diferenciar maiúsculas nem espaços nas pontas). */
function sameName(typed: string, actual: string): boolean {
  const normalize = (value: string) => value.normalize('NFC').trim().toLocaleLowerCase('pt-BR');
  return normalize(typed) === normalize(actual);
}

/**
 * Apaga de vez as perguntas de um tema, em partes. O tema continua existindo
 * (nome, capa, categoria, ranking e conquistas dos jogadores ficam).
 *
 * Por pergunta sai: o texto, as alternativas, as fontes, as estatísticas,
 * as denúncias e recibos de "pergunta vista", as cópias seladas nas
 * partidas e desafios já encerrados (com as respostas daquelas rodadas) e a
 * foto no armazenamento, se nenhuma outra pergunta usa a mesma foto.
 *
 * Exige o tema oculto (ninguém entra numa fila vazia) e nenhuma partida em
 * andamento nele. Desafios ainda vivos no tema são cancelados.
 */
export async function purgeThemeQuestions(
  env: Pick<Env, 'CORE_DB' | 'QUESTIONS_DB' | 'QUESTION_IMAGES'>,
  input: { confirmName: string; themeId: string },
): Promise<PurgeStep> {
  const core = env.CORE_DB;
  const questionsDb = env.QUESTIONS_DB;
  const theme = await core.prepare('SELECT id, name, hidden_at FROM themes WHERE id = ?1')
    .bind(input.themeId).first<{ hidden_at: string | null; id: string; name: string }>();
  if (theme === null) throw new ApiError(404, 'THEME_NOT_FOUND', 'Tema não encontrado.');
  if (!sameName(input.confirmName, theme.name)) {
    throw new ApiError(400, 'CONFIRMATION_MISMATCH', 'O nome digitado não é o nome deste tema.');
  }
  if (theme.hidden_at === null) {
    throw new ApiError(409, 'THEME_NOT_HIDDEN', 'Oculte o tema antes de apagar as perguntas dele.');
  }
  const live = await core.prepare(`SELECT 1 FROM matches WHERE theme_id = ?1 AND status IN ${LIVE_MATCH_STATUSES} LIMIT 1`)
    .bind(theme.id).first();
  if (live !== null) {
    throw new ApiError(409, 'THEME_IN_PLAY', 'Ainda tem partida acontecendo neste tema. Tente de novo em alguns minutos.');
  }
  await core.prepare(
    `UPDATE challenges SET status = 'CANCELLED', updated_at = ?2, revision = revision + 1
      WHERE theme_id = ?1 AND status IN ${LIVE_CHALLENGE_STATUSES}`,
  ).bind(theme.id, new Date().toISOString()).run();

  const pool = await questionsDb.prepare('SELECT id FROM question_pools WHERE theme_id = ?1')
    .bind(theme.id).first<{ id: string }>();
  if (pool === null) return { deletedImages: 0, deletedQuestions: 0, remaining: 0 };

  const batch = await questionsDb.prepare('SELECT id, image_key FROM questions WHERE pool_id = ?1 LIMIT ?2')
    .bind(pool.id, PURGE_CHUNK).all<{ id: string; image_key: string | null }>();
  const ids = batch.results.map((row) => row.id);

  if (ids.length > 0) {
    await purgeCoreTraces(core, ids);
    const marks = list(ids.length);
    await questionsDb.batch([
      questionsDb.prepare(`DELETE FROM question_statistics_ledger WHERE question_id IN (${marks})`).bind(...ids),
      questionsDb.prepare(`DELETE FROM question_statistics WHERE question_id IN (${marks})`).bind(...ids),
      questionsDb.prepare(`DELETE FROM question_sources WHERE question_id IN (${marks})`).bind(...ids),
      questionsDb.prepare(`DELETE FROM questions WHERE id IN (${marks})`).bind(...ids),
    ]);
  }
  const deletedImages = await deleteOrphanImages(env, batch.results.map((row) => row.image_key));

  const left = await questionsDb.prepare('SELECT COUNT(*) AS total FROM questions WHERE pool_id = ?1')
    .bind(pool.id).first<{ total: number }>();
  const remaining = left?.total ?? 0;
  if (remaining === 0) {
    // Tema vazio: o sorteio não tem mais nada e a descoberta de cada jogador recomeça.
    await questionsDb.prepare(
      'UPDATE question_pools SET active_count = 0, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?1',
    ).bind(pool.id).run();
    await core.batch([
      core.prepare('DELETE FROM user_pool_states WHERE pool_id = ?1').bind(pool.id),
      core.prepare('UPDATE themes SET active_question_count = 0 WHERE id = ?1').bind(theme.id),
    ]);
  }
  return { deletedImages, deletedQuestions: ids.length, remaining };
}

/** Cópias e rastros das perguntas no banco principal. */
async function purgeCoreTraces(core: D1Database, questionIds: readonly string[]): Promise<void> {
  const marks = list(questionIds.length);
  const [matchRows, challengeRows] = await core.batch<{ id: string }>([
    core.prepare(`SELECT DISTINCT match_id AS id FROM match_questions WHERE question_id IN (${marks})`).bind(...questionIds),
    core.prepare(`SELECT DISTINCT challenge_id AS id FROM challenge_questions WHERE question_id IN (${marks})`).bind(...questionIds),
  ]);
  const statements: D1PreparedStatement[] = [
    core.prepare(`DELETE FROM question_reports WHERE question_id IN (${marks})`).bind(...questionIds),
    core.prepare(`DELETE FROM question_report_views WHERE question_id IN (${marks})`).bind(...questionIds),
  ];
  // A partida guarda as perguntas seladas e as respostas de cada rodada; o
  // placar e o resultado (em matches/match_players) continuam.
  for (const group of chunks((matchRows?.results ?? []).map((row) => row.id), CONTEXT_CHUNK)) {
    statements.push(
      core.prepare(`DELETE FROM match_answers WHERE match_id IN (${list(group.length)})`).bind(...group),
      core.prepare(`DELETE FROM match_questions WHERE match_id IN (${list(group.length)})`).bind(...group),
    );
  }
  for (const group of chunks((challengeRows?.results ?? []).map((row) => row.id), CONTEXT_CHUNK)) {
    statements.push(
      core.prepare(`DELETE FROM challenge_answers WHERE challenge_id IN (${list(group.length)})`).bind(...group),
      core.prepare(`DELETE FROM challenge_questions WHERE challenge_id IN (${list(group.length)})`).bind(...group),
    );
  }
  await core.batch(statements);
}

/** Apaga do armazenamento as fotos que nenhuma pergunta usa mais. */
async function deleteOrphanImages(
  env: Pick<Env, 'QUESTIONS_DB' | 'QUESTION_IMAGES'>,
  keys: ReadonlyArray<string | null>,
): Promise<number> {
  const candidates = [...new Set(keys.filter((key): key is string => key !== null && isQuestionImageKey(key)))];
  if (candidates.length === 0) return 0;
  const stillUsed = await env.QUESTIONS_DB.prepare(
    `SELECT DISTINCT image_key FROM questions WHERE image_key IN (${list(candidates.length)})`,
  ).bind(...candidates).all<{ image_key: string }>();
  const used = new Set(stillUsed.results.map((row) => row.image_key));
  const orphans = candidates.filter((key) => !used.has(key));
  if (orphans.length > 0) await env.QUESTION_IMAGES.delete(orphans);
  return orphans.length;
}
