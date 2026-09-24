import {
  CHALLENGE_MODE,
  DAILY_MISSION_DEFINITIONS,
  challengePair,
  decideChallengeCreation,
  directChallengeExpiresAt,
  isTerminalChallenge,
  questionsForMode,
  transitionChallenge,
  xpAward,
  utcDayKey,
  ChallengeRuleError,
  LIVE_CHALLENGE_STATUSES,
  TOTAL_XP_TO_MAX_LEVEL,
  type ChallengeAction,
  type ChallengeKind,
  type ChallengeRecord,
  type ChallengeStatus,
  type FriendPresence,
  type LiveQuestion,
  type SealedRoundAnswer,
} from '@quiz-gomes/domain';
import { ApiError } from '../http/api-error.js';
import { QuestionRepository } from './question-repository.js';
import { QuestionSelectionService } from '../services/question-selection-service.js';
import { recordQuestionAnswers } from '../services/question-statistics-service.js';
import { StreakRepository } from './streak-repository.js';
import { customAvatarUrl } from '../storage/custom-avatar.js';

const LIVE_STATUS_LIST = LIVE_CHALLENGE_STATUSES.map((status) => `'${status}'`).join(', ');

/** Teto técnico de criação de desafios por usuário numa janela curta. */
export const CHALLENGE_RATE_LIMIT = 12;
export const CHALLENGE_RATE_WINDOW_MS = 60_000;

export interface ChallengeParticipant {
  customAvatarUrl: string | null;
  displayName: string;
  frameId: string | null;
  photoUrl: string | null;
  publicId: string;
  userId: string;
}

export interface ChallengeView {
  challenged: ChallengeParticipant;
  challenger: ChallengeParticipant;
  expiresAt: string | null;
  id: string;
  kind: ChallengeKind;
  /** Papel de quem consulta: quem desafiou ou quem foi desafiado. */
  role: 'CHALLENGED' | 'CHALLENGER';
  /**
   * Sala DIRECT já reservada (PREPARING/ACTIVE). Só aparece para os dois
   * participantes — a mesma restrição de `forUser` — e é o que permite
   * recuperar a partida depois de um reload/reconexão sem depender só do
   * push `CHALLENGE_STARTED`.
   */
  roomId: string | null;
  status: ChallengeStatus;
  theme: { name: string; slug: string };
}

/** Página de desafios vivos, paginada por cursor opaco para nunca esconder o resto. */
export interface ChallengeViewPage {
  challenges: ChallengeView[];
  nextCursor: string | null;
}

/**
 * Resultado de uma escrita autoritativa com CAS: `APPLIED` é a transição que
 * este chamado realizou; `ALREADY_APPLIED` é a mesma transição já persistida
 * antes (retry/alarm idempotente); `NOT_APPLICABLE` é uma corrida perdida —
 * outro desfecho (cancelamento, anulação, o outro jogador) já decidiu o
 * desafio, e quem chamou nunca deve anunciar um terminal a partir disto.
 */
export type ChallengeWriteOutcome = 'ALREADY_APPLIED' | 'APPLIED' | 'NOT_APPLICABLE';

interface ChallengeRow {
  expires_at: string | null;
  first_player_user_id: string;
  id: string;
  kind: ChallengeKind;
  match_id: string | null;
  revision: number;
  second_player_agreed: number;
  second_player_user_id: string;
  status: ChallengeStatus;
  theme_id: string;
  updated_at: string;
}

interface ChallengeViewRow extends ChallengeRow {
  challenged_avatar_version: number | null;
  challenged_display_name: string;
  challenged_frame_id: string | null;
  challenged_photo_url: string | null;
  challenged_public_id: string;
  challenged_user_id: string;
  challenger_avatar_version: number | null;
  challenger_display_name: string;
  challenger_frame_id: string | null;
  challenger_photo_url: string | null;
  challenger_public_id: string;
  challenger_user_id: string;
  theme_name: string;
  theme_slug: string;
}

function record(row: ChallengeRow): ChallengeRecord {
  return {
    expiresAtMs: row.expires_at === null ? null : Date.parse(row.expires_at),
    firstPlayerUserId: row.first_player_user_id,
    id: row.id,
    kind: row.kind,
    revision: row.revision,
    secondPlayerAgreed: row.second_player_agreed === 1,
    secondPlayerUserId: row.second_player_user_id,
    status: row.status,
    themeId: row.theme_id,
  };
}

function ruleError(error: unknown): never {
  if (error instanceof ChallengeRuleError) {
    const status = error.code === 'CHALLENGE_ALREADY_ACTIVE' ? 409 : 409;
    throw new ApiError(status, error.code, error.message);
  }
  throw error;
}

const VIEW_COLUMNS = `
  c.id, c.expires_at, c.first_player_user_id, c.kind, c.match_id, c.revision,
  c.second_player_agreed, c.second_player_user_id, c.status, c.theme_id,
  t.name AS theme_name, t.slug AS theme_slug,
  p.user_id AS challenger_user_id, p.public_id AS challenger_public_id,
  p.display_name AS challenger_display_name, p.photo_url AS challenger_photo_url,
  p.equipped_frame_id AS challenger_frame_id,
  CASE WHEN a.active = 1 THEN a.version ELSE NULL END AS challenger_avatar_version,
  q.user_id AS challenged_user_id, q.public_id AS challenged_public_id,
  q.display_name AS challenged_display_name, q.photo_url AS challenged_photo_url,
  q.equipped_frame_id AS challenged_frame_id,
  CASE WHEN b.active = 1 THEN b.version ELSE NULL END AS challenged_avatar_version
`;

export class ChallengeRepository {
  constructor(
    private readonly db: D1Database,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /** Resolve o alvo exigindo amizade válida e ausência de bloqueio nos dois sentidos. */
  async friendTarget(actorUserId: string, targetPublicId: string): Promise<string> {
    const row = await this.db.prepare(
      `SELECT p.user_id
         FROM user_profiles p
         JOIN users u ON u.id = p.user_id AND u.disabled_at IS NULL
        WHERE p.public_id = ?2 COLLATE NOCASE
          AND p.user_id <> ?1
          AND EXISTS (
            SELECT 1 FROM friendships
             WHERE user_low_id = MIN(?1, p.user_id) AND user_high_id = MAX(?1, p.user_id)
          )
          AND NOT EXISTS (
            SELECT 1 FROM user_blocks b
             WHERE (b.blocker_user_id = ?1 AND b.blocked_user_id = p.user_id)
                OR (b.blocker_user_id = p.user_id AND b.blocked_user_id = ?1)
          )`,
    ).bind(actorUserId, targetPublicId).first<{ user_id: string }>();
    if (row === null) throw new ApiError(404, 'USER_UNAVAILABLE', 'Este usuário não está disponível.');
    return row.user_id;
  }

  /** Desafio vivo da dupla no tipo pedido; o limite é por tipo, não global. */
  async activeForPair(first: string, second: string, kind: ChallengeKind): Promise<ChallengeRecord | null> {
    const [low, high] = challengePair(first, second);
    const row = await this.db.prepare(
      `SELECT id, expires_at, first_player_user_id, kind, revision,
              second_player_agreed, second_player_user_id, status, theme_id
         FROM challenges
        WHERE pair_low_id = ?1 AND pair_high_id = ?2 AND kind = ?3
          AND status IN (${LIVE_STATUS_LIST})`,
    ).bind(low, high, kind).first<ChallengeRow>();
    return row === null ? null : record(row);
  }

  /** Todos os desafios vivos da dupla, dos dois tipos. */
  async allActiveForPair(first: string, second: string): Promise<ChallengeRecord[]> {
    const [low, high] = challengePair(first, second);
    const result = await this.db.prepare(
      `SELECT id, expires_at, first_player_user_id, kind, revision,
              second_player_agreed, second_player_user_id, status, theme_id
         FROM challenges
        WHERE pair_low_id = ?1 AND pair_high_id = ?2 AND status IN (${LIVE_STATUS_LIST})`,
    ).bind(low, high).all<ChallengeRow>();
    return result.results.map(record);
  }

  async byId(challengeId: string): Promise<(ChallengeRecord & { matchId: string | null }) | null> {
    const row = await this.db.prepare(
      `SELECT id, expires_at, first_player_user_id, kind, match_id, revision,
              second_player_agreed, second_player_user_id, status, theme_id
         FROM challenges WHERE id = ?1`,
    ).bind(challengeId).first<ChallengeRow>();
    return row === null ? null : { ...record(row), matchId: row.match_id };
  }

  /**
   * Pequeno recorte autoritativo usado na reconciliação oportunística. Não é
   * polling: cada chamada vem de abrir/listar/criar desafio e retorna no máximo
   * os desafios vivos do próprio participante.
   */
  async liveLifecycleForUser(userId: string): Promise<Array<ChallengeRecord & {
    matchId: string | null;
    updatedAtMs: number;
  }>> {
    // Ordem ASC por updated_at: as linhas mais paradas (candidatas a órfã) são
    // convergidas primeiro. Com mais de 50 desafios vivos — caso extremo dos 200
    // amigos, dois desafios cada — o restante avança nas próximas chamadas em vez
    // de nunca ser tocado, porque as mais recentes deixam de monopolizar o topo.
    const result = await this.db.prepare(
      `SELECT id, expires_at, first_player_user_id, kind, match_id, revision,
              second_player_agreed, second_player_user_id, status, theme_id, updated_at
         FROM challenges
        WHERE (first_player_user_id = ?1 OR second_player_user_id = ?1)
          AND status IN (${LIVE_STATUS_LIST})
        ORDER BY updated_at ASC LIMIT 50`,
    ).bind(userId).all<ChallengeRow>();
    return result.results.map((row) => ({
      ...record(row),
      matchId: row.match_id,
      updatedAtMs: Number.isFinite(Date.parse(row.updated_at)) ? Date.parse(row.updated_at) : 0,
    }));
  }

  /** Converge a linha DIRECT com o terminal já persistido pelo MatchRoom. */
  async reconcileDirectMatch(challenge: ChallengeRecord & { matchId: string | null }): Promise<boolean> {
    if (challenge.kind !== 'DIRECT' || challenge.matchId === null || !['PREPARING', 'ACTIVE'].includes(challenge.status)) {
      return false;
    }
    // Esta consulta só converte um terminal que já foi decidido pelo
    // MatchRoom; ela nunca é usada como prova de que uma sala ainda vive.
    const match = (await this.db.prepare('SELECT status FROM matches WHERE id = ?1')
      .bind(challenge.matchId).first<{ status: string }>())?.status ?? null;
    if (match !== 'FINISHED' && match !== 'VOID') return false;
    const terminal = match === 'FINISHED' ? 'COMPLETED' : 'VOID';
    const applied = await this.db.prepare(
      `UPDATE challenges SET status = ?1, updated_at = ?2, revision = revision + 1
        WHERE id = ?3 AND revision = ?4 AND kind = 'DIRECT' AND status IN ('PREPARING', 'ACTIVE')`,
    ).bind(terminal, this.clock().toISOString(), challenge.id, challenge.revision).run();
    if ((applied.meta.changes ?? 0) === 1 && terminal === 'VOID') await this.cleanupPayload(challenge.id);
    return (applied.meta.changes ?? 0) === 1;
  }

  async reconcileDirectMatchId(matchId: string): Promise<{
    challengeId: string | null; changed: boolean; participants: [string, string] | null;
  }> {
    const row = await this.db.prepare(
      `SELECT id, expires_at, first_player_user_id, kind, match_id, revision,
              second_player_agreed, second_player_user_id, status, theme_id, updated_at
         FROM challenges WHERE kind = 'DIRECT' AND match_id = ?1`,
    ).bind(matchId).first<ChallengeRow>();
    if (row === null) return { challengeId: null, changed: false, participants: null };
    const challenge = { ...record(row), matchId: row.match_id };
    const changed = await this.reconcileDirectMatch(challenge);
    return {
      challengeId: changed ? challenge.id : null,
      changed,
      participants: changed ? [challenge.firstPlayerUserId, challenge.secondPlayerUserId] : null,
    };
  }

  /** Finaliza uma reserva sem sala após a graça autoritativa, usando CAS. */
  async voidOrphanedLive(challenge: ChallengeRecord, beforeMs: number): Promise<boolean> {
    const updated = await this.db.prepare(
      `UPDATE challenges SET status = 'VOID', updated_at = ?1, revision = revision + 1
        WHERE id = ?2 AND revision = ?3 AND status = ?4 AND updated_at <= ?5`,
    ).bind(
      this.clock().toISOString(), challenge.id, challenge.revision, challenge.status,
      new Date(beforeMs).toISOString(),
    ).run();
    const applied = (updated.meta.changes ?? 0) === 1;
    if (applied) await this.cleanupPayload(challenge.id);
    return applied;
  }

  /**
   * Limite técnico de criação, não um cooldown social: protege o servidor de
   * rajadas automatizadas sem virar punição visível entre amigos. A mensagem é
   * neutra e não revela nada sobre o alvo nem sobre o histórico da dupla.
   */
  private async assertCreationRate(actorUserId: string, nowMs: number): Promise<void> {
    const since = new Date(nowMs - CHALLENGE_RATE_WINDOW_MS).toISOString();
    const row = await this.db.prepare(
      `SELECT COUNT(*) AS total FROM challenges
        WHERE first_player_user_id = ?1 AND created_at >= ?2`,
    ).bind(actorUserId, since).first<{ total: number }>();
    if ((row?.total ?? 0) >= CHALLENGE_RATE_LIMIT) {
      throw new ApiError(429, 'CHALLENGE_RATE_LIMITED', 'Muitos desafios em pouco tempo. Tente de novo em instantes.');
    }
  }

  /**
   * Cria o desafio ou reconhece o desafio cruzado como aceite/concordância.
   * O índice único da dupla é a barreira final contra corrida entre A e B.
   */
  async create(input: {
    actorUserId: string;
    kind: ChallengeKind;
    targetPresence: FriendPresence;
    targetUserId: string;
    themeId: string;
  }): Promise<{ challengeId: string; created: boolean; crossAccepted: boolean }> {
    const nowMs = this.clock().getTime();
    if (input.kind === 'DIRECT' && input.targetPresence !== 'ONLINE') {
      throw new ApiError(409, 'FRIEND_UNAVAILABLE', 'Este amigo não está disponível para uma partida agora.');
    }
    await this.assertCreationRate(input.actorUserId, nowMs);
    const existing = await this.activeForPair(input.actorUserId, input.targetUserId, input.kind);
    let decision;
    try {
      decision = decideChallengeCreation({
        existing,
        nowMs,
        requestedKind: input.kind,
        requesterUserId: input.actorUserId,
      });
    } catch (error) {
      ruleError(error);
    }

    if (decision.kind === 'ACCEPT_EXISTING_DIRECT') {
      return { challengeId: decision.challengeId, created: false, crossAccepted: true };
    }
    if (decision.kind === 'AGREE_WITH_EXISTING') {
      await this.db.prepare(
        `UPDATE challenges SET second_player_agreed = 1, updated_at = ?1, revision = revision + 1
          WHERE id = ?2 AND status IN (${LIVE_STATUS_LIST})`,
      ).bind(this.clock().toISOString(), decision.challengeId).run();
      return { challengeId: decision.challengeId, created: false, crossAccepted: false };
    }

    // Um convite direto vencido continua ocupando o índice único: encerra antes de recriar.
    if (existing !== null && !isTerminalChallenge(existing.status)) {
      await this.db.prepare(
        `UPDATE challenges SET status = 'EXPIRED', updated_at = ?1, revision = revision + 1
          WHERE id = ?2 AND status = 'PENDING_DIRECT' AND expires_at <= ?1`,
      ).bind(this.clock().toISOString(), existing.id).run();
    }

    const [low, high] = challengePair(input.actorUserId, input.targetUserId);
    const id = crypto.randomUUID();
    const now = this.clock().toISOString();
    const expiresAt = input.kind === 'DIRECT'
      ? new Date(directChallengeExpiresAt(nowMs)).toISOString()
      : null;
    const status: ChallengeStatus = input.kind === 'DIRECT' ? 'PENDING_DIRECT' : 'FIRST_PLAYER_ACTIVE';
    try {
      // `difficulty` é legado físico do schema (nunca lido de volta); desafio entre amigos é sempre Casual.
      const inserted = await this.db.prepare(
        `INSERT INTO challenges
           (id, pair_low_id, pair_high_id, first_player_user_id, second_player_user_id,
            theme_id, difficulty, kind, status, expires_at, created_at, updated_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, 'MEDIUM', ?7, ?8, ?9, ?10, ?10
          WHERE EXISTS (SELECT 1 FROM themes WHERE id = ?6 AND status = 'ACTIVE')`,
      ).bind(id, low, high, input.actorUserId, input.targetUserId, input.themeId,
        input.kind, status, expiresAt, now).run();
      if ((inserted.meta.changes ?? 0) !== 1) {
        throw new ApiError(404, 'THEME_UNAVAILABLE', 'Este tema não está disponível.');
      }
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof Error && /UNIQUE constraint failed/i.test(error.message)) {
        // Corrida perdida: a reserva persistida primeiro é a autoritativa.
        const winner = await this.activeForPair(input.actorUserId, input.targetUserId, input.kind);
        if (winner !== null) {
          return { challengeId: winner.id, created: false, crossAccepted: false };
        }
      }
      throw error;
    }
    return { challengeId: id, created: true, crossAccepted: false };
  }

  /**
   * Aplica cancelamento, recusa, expiração ou fim de relacionamento com CAS na
   * revisão lida. Retorna false quando outra escrita chegou primeiro.
   */
  async applyAction(challenge: ChallengeRecord, action: ChallengeAction): Promise<boolean> {
    let transition;
    try {
      transition = transitionChallenge(challenge, action, this.clock().getTime());
    } catch (error) {
      ruleError(error);
    }
    const result = await this.db.prepare(
      `UPDATE challenges
          SET status = ?1, updated_at = ?2, revision = revision + 1
        WHERE id = ?3 AND revision = ?4 AND status IN (${LIVE_STATUS_LIST})`,
    ).bind(transition.status, this.clock().toISOString(), challenge.id, challenge.revision).run();
    const applied = (result.meta.changes ?? 0) === 1;
    if (applied && transition.cleanupPayload) await this.cleanupPayload(challenge.id);
    return applied;
  }

  /**
   * Sorteia e sela o conjunto do desafio assíncrono uma única vez.
   *
   * Os dois jogadores recebem exatamente as mesmas perguntas, na mesma ordem e com
   * as mesmas alternativas. A segunda chamada é no-op: o conjunto já selado vence.
   */
  async sealQuestionSet(
    challengeId: string,
    themeId: string,
    questionsDb: D1Database,
  ): Promise<void> {
    const existing = await this.db.prepare(
      'SELECT COUNT(*) AS total FROM challenge_questions WHERE challenge_id = ?1',
    ).bind(challengeId).first<{ total: number }>();
    if ((existing?.total ?? 0) > 0) return;

    // Desafio entre amigos é sempre Casual (CHALLENGE_MODE): 7 perguntas fixas.
    const selected = await new QuestionSelectionService(new QuestionRepository(questionsDb))
      .select(themeId, questionsForMode(CHALLENGE_MODE));
    await this.db.batch(selected.questions.map((question, index) => this.db.prepare(
      `INSERT OR IGNORE INTO challenge_questions
         (challenge_id, round_number, question_id, pool_slot, public_snapshot_json, correct_option)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    ).bind(
      challengeId,
      index + 1,
      question.id,
      question.slot,
      JSON.stringify({ options: question.options, prompt: question.prompt }),
      question.correctOption,
    )));
    await this.db.prepare(
      'UPDATE challenges SET pool_id = ?1, pool_version = ?2, updated_at = ?3 WHERE id = ?4',
    ).bind(selected.poolId, selected.poolVersion, this.clock().toISOString(), challengeId).run();
  }

  /** Conjunto selado, na ordem das rodadas. */
  async questionSet(challengeId: string): Promise<LiveQuestion[]> {
    const result = await this.db.prepare(
      `SELECT round_number, question_id, pool_slot, public_snapshot_json, correct_option
         FROM challenge_questions WHERE challenge_id = ?1 ORDER BY round_number`,
    ).bind(challengeId).all<{
      correct_option: number;
      pool_slot: number;
      public_snapshot_json: string;
      question_id: string;
      round_number: number;
    }>();
    return result.results.map((row) => {
      const snapshot = JSON.parse(row.public_snapshot_json) as {
        options: [string, string, string, string];
        prompt: string;
      };
      return {
        correctOption: row.correct_option,
        id: row.question_id,
        imageUrl: null,
        options: snapshot.options,
        prompt: snapshot.prompt,
        slot: row.pool_slot,
      };
    });
  }

  /** Metade já selada de um jogador, na ordem das rodadas. */
  async sealedHalf(challengeId: string, userId: string): Promise<SealedRoundAnswer[]> {
    const result = await this.db.prepare(
      `SELECT round_number, selected_option, remaining_ms, is_correct, score
         FROM challenge_answers
        WHERE challenge_id = ?1 AND user_id = ?2
        ORDER BY round_number`,
    ).bind(challengeId, userId).all<{
      is_correct: number;
      remaining_ms: number;
      round_number: number;
      score: number;
      selected_option: number | null;
    }>();
    return result.results.map((row) => ({
      correct: row.is_correct === 1,
      remainingMs: row.remaining_ms,
      score: row.score,
      selectedOption: row.selected_option,
    }));
  }

  /**
   * Sela a metade de um jogador e avança o desafio (status + respostas), tudo
   * em um único batch. Idempotente: reexecutar não duplica respostas, porque a
   * inserção ignora conflito e a transição exige o estado de origem exato.
   *
   * XP, estatística e progressão NÃO são aplicados aqui — ver
   * `recordHalfEffects`/`applyCompletionXp`, chamados à parte pelo mesmo
   * chamador a cada retorno `APPLIED`/`ALREADY_APPLIED`, de forma idempotente
   * e retomável mesmo que esta transição e aqueles efeitos não caibam na
   * mesma escrita atômica.
   *
   * Retorna o desfecho em vez de `void`: quem chama (a sala do DO) só pode
   * anunciar um terminal para o jogador quando a resposta é `APPLIED` ou
   * `ALREADY_APPLIED`. Em `NOT_APPLICABLE` — um cancelamento/anulação venceu a
   * corrida entre a persistência e esta selagem — a inserção residual desta
   * chamada é desfeita e nenhum resultado falso chega ao socket.
   */
  async sealHalf(input: {
    answers: readonly SealedRoundAnswer[];
    challengeId: string;
    isSecondPlayer: boolean;
    userId: string;
  }): Promise<ChallengeWriteOutcome> {
    const now = this.clock().toISOString();
    const statements: D1PreparedStatement[] = input.answers.map((answer, index) => this.db.prepare(
      `INSERT OR IGNORE INTO challenge_answers
         (challenge_id, round_number, user_id, selected_option, remaining_ms, is_correct, score, answered_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    ).bind(
      input.challengeId,
      index + 1,
      input.userId,
      answer.selectedOption,
      answer.remainingMs,
      answer.correct ? 1 : 0,
      answer.score,
      now,
    ));

    if (!input.isSecondPlayer) {
      statements.push(this.db.prepare(
        `UPDATE challenges
            SET status = 'WAITING_FOR_SECOND', first_half_sealed_at = ?1,
                updated_at = ?1, revision = revision + 1
          WHERE id = ?2 AND status = 'FIRST_PLAYER_ACTIVE'`,
      ).bind(now, input.challengeId));
      const applied = await this.db.batch(statements);
      if ((applied.at(-1)?.meta.changes ?? 0) === 1) return 'APPLIED';
      const current = await this.byId(input.challengeId);
      if (current?.status === 'WAITING_FOR_SECOND') return 'ALREADY_APPLIED';
      await this.discardResidualHalf(input.challengeId, input.userId);
      return 'NOT_APPLICABLE';
    }

    // Desafio entre amigos é sempre Casual: Conhecimento nunca muda, só XP de vitória —
    // e o XP em si é aplicado à parte por `applyCompletionXp`, de forma idempotente
    // e retomável (ver ali). Esta transição só grava o resultado (status + respostas).
    statements.push(this.db.prepare(
      `UPDATE challenges SET status = 'COMPLETED', updated_at = ?1, revision = revision + 1
        WHERE id = ?2 AND status = 'SECOND_PLAYER_ACTIVE'`,
    ).bind(now, input.challengeId));
    const applied = await this.db.batch(statements);
    if ((applied.at(-1)?.meta.changes ?? 0) !== 1) {
      const current = await this.byId(input.challengeId);
      if (current?.status === 'COMPLETED') return 'ALREADY_APPLIED';
      await this.discardResidualHalf(input.challengeId, input.userId);
      return 'NOT_APPLICABLE';
    }
    return 'APPLIED';
  }

  /** Desfaz a metade que esta chamada acabou de inserir quando a corrida foi perdida. */
  private async discardResidualHalf(challengeId: string, userId: string): Promise<void> {
    await this.db.prepare('DELETE FROM challenge_answers WHERE challenge_id = ?1 AND user_id = ?2')
      .bind(challengeId, userId).run();
  }

  /**
   * Efeitos pós-conclusão de UMA metade selada: estatística de pergunta e
   * progressão (missão "1 partida válida" + streak do tema).
   *
   * Chamado de novo a cada `trySeal` — inclusive quando `sealHalf` já retornou
   * `ALREADY_APPLIED` — para que uma falha entre a transição e estes efeitos
   * seja retomável sem duplicar nada:
   * - estatística já tem seu próprio ledger (`question_statistics_ledger`,
   *   em QUESTIONS_DB) e pode ser chamada quantas vezes for preciso;
   * - progressão não é idempotente por conta própria (chamar duas vezes soma
   *   progresso duas vezes), então `challenge_progression_ledger` é o gatilho:
   *   só a chamada que efetivamente insere a linha nova executa o efeito.
   *
   * Lê de `challenge_answers`/`challenge_questions` (D1, nunca apagados para
   * um desafio COMPLETED) em vez do estado em memória do DO, então funciona
   * igual numa selagem nova ou numa retomada bem depois, mesmo sem o DO.
   */
  async recordHalfEffects(challengeId: string, userId: string, questionsDb: D1Database): Promise<void> {
    const challenge = await this.byId(challengeId);
    if (challenge === null) return;
    const sealed = await this.sealedHalf(challengeId, userId);
    if (sealed.length === 0) return;
    const questions = await this.questionSet(challengeId);
    const statisticsRecorded = await recordQuestionAnswers(questionsDb, sealed.flatMap((answer, index) => {
      const questionId = questions[index]?.id;
      return questionId === undefined ? [] : [{
        contextId: challengeId,
        contextKind: 'CHALLENGE' as const,
        correct: answer.correct,
        questionId,
        remainingMs: answer.remainingMs,
        roundNumber: index + 1,
        selectedOption: answer.selectedOption,
        userId,
      }];
    }));
    if (!statisticsRecorded) throw new Error('Estatísticas de pergunta pendentes.');

    const now = this.clock();
    const dayKey = utcDayKey(now.getTime());
    await this.db.prepare(
      `INSERT OR IGNORE INTO challenge_progression_ledger (challenge_id, user_id, applied)
       VALUES (?1, ?2, 0)`,
    ).bind(challengeId, userId).run();
    const pending = await this.db.prepare(
      'SELECT applied FROM challenge_progression_ledger WHERE challenge_id = ?1 AND user_id = ?2',
    ).bind(challengeId, userId).first<{ applied: number }>();
    if (pending?.applied !== 0) return;

    // Streak é idempotente pelo dia; se a queda ocorrer antes do batch das
    // missões, a retomada preserva o mesmo dia em vez de contar duas vezes.
    await new StreakRepository(this.db).advance(userId, challenge.themeId, dayKey);
    const correctAnswers = sealed.filter((answer) => answer.correct).length;
    const increments: Record<string, number> = {
      ANSWER_QUESTIONS: sealed.length,
      CORRECT_ANSWERS: correctAnswers,
      PLAY_MATCH: 1,
    };
    const nowIso = now.toISOString();
    const statements: D1PreparedStatement[] = [
      ...DAILY_MISSION_DEFINITIONS.map((definition) => this.db.prepare(
        `INSERT OR IGNORE INTO user_daily_missions (user_id, day_key, mission_type, target)
         VALUES (?1, ?2, ?3, ?4)`,
      ).bind(userId, dayKey, definition.type, definition.target)),
      ...DAILY_MISSION_DEFINITIONS.map((definition) => this.db.prepare(
        `UPDATE user_daily_missions
            SET progress = MIN(target, progress + ?1),
                completed_at = CASE
                  WHEN completed_at IS NULL AND MIN(target, progress + ?1) >= target THEN ?2
                  ELSE completed_at
                END
          WHERE user_id = ?3 AND day_key = ?4 AND mission_type = ?5
            AND EXISTS (
              SELECT 1 FROM challenge_progression_ledger
               WHERE challenge_id = ?6 AND user_id = ?3 AND applied = 0
            )`,
      ).bind(increments[definition.type] ?? 0, nowIso, userId, dayKey, definition.type, challengeId)),
      this.db.prepare(
        `UPDATE challenge_progression_ledger SET applied = 1, applied_at = ?1
          WHERE challenge_id = ?2 AND user_id = ?3 AND applied = 0`,
      ).bind(nowIso, challengeId, userId),
    ];
    await this.db.batch(statements);
  }

  /**
   * XP de desafio COMPLETED, para os dois jogadores, recalculado a partir das
   * respostas já persistidas (nunca do estado em memória do DO).
   *
   * Mesmo padrão de `question_statistics_ledger`: um `INSERT OR IGNORE` em
   * `challenge_xp_ledger` é o gatilho — só quem de fato insere a linha nova
   * aplica o XP a `user_profiles`, e a linha final marca `applied = 1`. Uma
   * chamada repetida (retry após falha entre a transição e o XP, ou depois de
   * `sealHalf` já ter devolvido `ALREADY_APPLIED`) sempre converge sem pagar
   * duas vezes; se o desafio ainda não está COMPLETED, é um no-op seguro.
   */
  async applyCompletionXp(challengeId: string): Promise<void> {
    const challenge = await this.byId(challengeId);
    if (challenge === null || challenge.status !== 'COMPLETED') return;
    const scores = await this.db.prepare(
      'SELECT user_id, SUM(score) AS score FROM challenge_answers WHERE challenge_id = ?1 GROUP BY user_id',
    ).bind(challengeId).all<{ score: number; user_id: string }>();
    const scoreByUser = new Map(scores.results.map((row) => [row.user_id, row.score]));
    const firstScore = scoreByUser.get(challenge.firstPlayerUserId) ?? 0;
    const secondScore = scoreByUser.get(challenge.secondPlayerUserId) ?? 0;
    const resultFor = (mine: number, theirs: number): 'DRAW' | 'LOSS' | 'WIN' => (
      mine === theirs ? 'DRAW' : mine > theirs ? 'WIN' : 'LOSS'
    );
    const awards: Array<[string, number]> = [
      [challenge.firstPlayerUserId, xpAward(CHALLENGE_MODE, resultFor(firstScore, secondScore))],
      [challenge.secondPlayerUserId, xpAward(CHALLENGE_MODE, resultFor(secondScore, firstScore))],
    ];
    // Empate paga zero aos dois: sem linha de ledger nenhuma, e sem batch vazio.
    const payable = awards.filter(([, xp]) => xp > 0);
    if (payable.length === 0) return;
    await this.db.batch(payable.map(([userId, xp]) => this.db.prepare(
      'INSERT OR IGNORE INTO challenge_xp_ledger (challenge_id, user_id, xp_delta) VALUES (?1, ?2, ?3)',
    ).bind(challengeId, userId, xp)));
    const pending = await this.db.prepare(
      `SELECT user_id, xp_delta FROM challenge_xp_ledger
        WHERE challenge_id = ?1 AND applied = 0`,
    ).bind(challengeId).all<{ user_id: string; xp_delta: number }>();
    if (pending.results.length === 0) return;
    const now = this.clock().toISOString();
    await this.db.batch(pending.results.flatMap(({ user_id: userId, xp_delta: xp }) => [
      this.db.prepare(
        `UPDATE user_profiles
            SET total_xp = MIN(?1, total_xp + ?2), updated_at = CURRENT_TIMESTAMP
          WHERE user_id = ?3`,
      ).bind(TOTAL_XP_TO_MAX_LEVEL, xp, userId),
      this.db.prepare(
        `UPDATE challenge_xp_ledger SET applied = 1, applied_at = ?1
          WHERE challenge_id = ?2 AND user_id = ?3 AND applied = 0`,
      ).bind(now, challengeId, userId),
    ]));
  }

  /**
   * Cancelamento explícito do primeiro jogador, antes de o segundo começar.
   * Idempotente: só atravessa enquanto o desafio ainda está vivo.
   */
  async cancelChallenge(challengeId: string): Promise<void> {
    await this.db.prepare(
      `UPDATE challenges SET status = 'CANCELLED', updated_at = ?1, revision = revision + 1
        WHERE id = ?2 AND status IN (${LIVE_STATUS_LIST}) AND status <> 'SECOND_PLAYER_ACTIVE'`,
    ).bind(this.clock().toISOString(), challengeId).run();
    await this.cleanupPayload(challengeId);
  }

  /**
   * Marca a metade do segundo jogador como anulada, sem vencedor, XP ou Conhecimento.
   * Retorna o desfecho: `NOT_APPLICABLE` quando o desafio já tinha um resultado
   * diferente (por exemplo COMPLETED venceu a corrida) — nesse caso a sala do DO
   * não deve anunciar VOID por cima de um resultado real já persistido.
   */
  async voidChallenge(challengeId: string): Promise<ChallengeWriteOutcome> {
    const applied = await this.db.prepare(
      `UPDATE challenges SET status = 'VOID', updated_at = ?1, revision = revision + 1
        WHERE id = ?2 AND status IN (${LIVE_STATUS_LIST})`,
    ).bind(this.clock().toISOString(), challengeId).run();
    if ((applied.meta.changes ?? 0) === 1) {
      await this.cleanupPayload(challengeId);
      return 'APPLIED';
    }
    const current = await this.byId(challengeId);
    return current?.status === 'VOID' ? 'ALREADY_APPLIED' : 'NOT_APPLICABLE';
  }

  /** Nenhum payload competitivo sobrevive a um desafio encerrado sem resultado. */
  async cleanupPayload(challengeId: string): Promise<void> {
    await this.db.batch([
      this.db.prepare('DELETE FROM challenge_answers WHERE challenge_id = ?1').bind(challengeId),
      this.db.prepare('DELETE FROM challenge_questions WHERE challenge_id = ?1').bind(challengeId),
    ]);
  }

  /**
   * Encerra os desafios pendentes de uma dupla ao desfazer amizade ou bloquear.
   * Como a dupla pode ter um ASYNC e um DIRECT vivos ao mesmo tempo, os dois são
   * varridos; partida já iniciada nunca é derrubada.
   */
  async endForRelationship(first: string, second: string): Promise<ChallengeRecord[]> {
    const ended: ChallengeRecord[] = [];
    for (const challenge of await this.allActiveForPair(first, second)) {
      try {
        if (await this.applyAction(challenge, { type: 'RELATIONSHIP_ENDED' })) ended.push(challenge);
      } catch (error) {
        if (error instanceof ApiError && error.code === 'CHALLENGE_ALREADY_STARTED') continue;
        throw error;
      }
    }
    return ended;
  }

  /**
   * Encerra convites diretos vencidos sem tratá-los como recusa, liberando a dupla.
   *
   * A varredura é disparada por atividade real do usuário — abrir o Social, listar
   * desafios — e não por um timer: nenhuma escrita periódica no D1. Escopo por
   * participante mantém o custo proporcional a quem está usando o app, e o LIMIT
   * impede que uma varredura cresça sem teto.
   */
  async expireStaleDirect(participantUserId?: string): Promise<Array<{ id: string; participants: [string, string] }>> {
    const now = this.clock().toISOString();
    const scope = participantUserId === undefined
      ? this.db.prepare(
        `SELECT id, first_player_user_id, second_player_user_id FROM challenges
          WHERE status = 'PENDING_DIRECT' AND expires_at IS NOT NULL AND expires_at <= ?1
          LIMIT 50`,
      ).bind(now)
      : this.db.prepare(
        `SELECT id, first_player_user_id, second_player_user_id FROM challenges
          WHERE status = 'PENDING_DIRECT' AND expires_at IS NOT NULL AND expires_at <= ?1
            AND (first_player_user_id = ?2 OR second_player_user_id = ?2)
          LIMIT 50`,
      ).bind(now, participantUserId);
    const stale = await scope.all<{
      first_player_user_id: string;
      id: string;
      second_player_user_id: string;
    }>();
    if (stale.results.length === 0) return [];
    const expired = stale.results.map((row) => ({
      id: row.id,
      participants: [row.first_player_user_id, row.second_player_user_id] as [string, string],
    }));
    await this.db.batch(expired.map(({ id }) => this.db.prepare(
      `UPDATE challenges SET status = 'EXPIRED', updated_at = ?1, revision = revision + 1
        WHERE id = ?2 AND status = 'PENDING_DIRECT'`,
    ).bind(now, id)));
    await Promise.all(expired.map(({ id }) => this.cleanupPayload(id)));
    return expired;
  }

  /**
   * Desafios que o usuário precisa ver no Social, dos dois lados, paginados por
   * cursor opaco (created_at + id). Nunca trunca em 50 sem dizer: quem tem mais
   * de 200 amigos e um ASYNC+DIRECT vivo com cada um pode ultrapassar isso, e
   * `nextCursor` é como o cliente pede o resto em vez de perdê-lo em silêncio.
   */
  async forUser(userId: string, nowMs = this.clock().getTime(), cursor: string | null = null): Promise<ChallengeViewPage> {
    const decoded = cursor === null ? null : decodeChallengeCursor(cursor);
    const pageSize = 50;
    const result = decoded === null
      ? await this.db.prepare(
        `SELECT ${VIEW_COLUMNS}, c.created_at
           FROM challenges c
           JOIN themes t ON t.id = c.theme_id
           JOIN user_profiles p ON p.user_id = c.first_player_user_id
           JOIN user_profiles q ON q.user_id = c.second_player_user_id
           LEFT JOIN user_custom_avatars a ON a.user_id = c.first_player_user_id
           LEFT JOIN user_custom_avatars b ON b.user_id = c.second_player_user_id
          WHERE (c.first_player_user_id = ?1 OR c.second_player_user_id = ?1)
            AND c.status IN (${LIVE_STATUS_LIST})
          ORDER BY c.created_at DESC, c.id DESC
          LIMIT ?2`,
      ).bind(userId, pageSize + 1).all<ChallengeViewRow & { created_at: string }>()
      : await this.db.prepare(
        `SELECT ${VIEW_COLUMNS}, c.created_at
           FROM challenges c
           JOIN themes t ON t.id = c.theme_id
           JOIN user_profiles p ON p.user_id = c.first_player_user_id
           JOIN user_profiles q ON q.user_id = c.second_player_user_id
           LEFT JOIN user_custom_avatars a ON a.user_id = c.first_player_user_id
           LEFT JOIN user_custom_avatars b ON b.user_id = c.second_player_user_id
          WHERE (c.first_player_user_id = ?1 OR c.second_player_user_id = ?1)
            AND c.status IN (${LIVE_STATUS_LIST})
            AND (c.created_at < ?2 OR (c.created_at = ?2 AND c.id < ?3))
          ORDER BY c.created_at DESC, c.id DESC
          LIMIT ?4`,
      ).bind(userId, decoded.createdAt, decoded.id, pageSize + 1).all<ChallengeViewRow & { created_at: string }>();

    const rows = result.results.slice(0, pageSize);
    const challenges = rows.flatMap((row) => {
      const expiresAtMs = row.expires_at === null ? null : Date.parse(row.expires_at);
      // Um convite vencido nunca aparece como pendente, mesmo antes da varredura.
      if (row.status === 'PENDING_DIRECT' && expiresAtMs !== null && nowMs >= expiresAtMs) return [];
      return [{
        challenged: {
          customAvatarUrl: customAvatarUrl(row.challenged_user_id, row.challenged_avatar_version),
          displayName: row.challenged_display_name,
          frameId: row.challenged_frame_id,
          photoUrl: row.challenged_photo_url,
          publicId: row.challenged_public_id,
          userId: row.challenged_user_id,
        },
        challenger: {
          customAvatarUrl: customAvatarUrl(row.challenger_user_id, row.challenger_avatar_version),
          displayName: row.challenger_display_name,
          frameId: row.challenger_frame_id,
          photoUrl: row.challenger_photo_url,
          publicId: row.challenger_public_id,
          userId: row.challenger_user_id,
        },
        expiresAt: row.expires_at,
        id: row.id,
        kind: row.kind,
        role: row.first_player_user_id === userId ? 'CHALLENGER' as const : 'CHALLENGED' as const,
        // Só desafios DIRECT já reservados carregam sala: ASYNC nunca tem match_id.
        roomId: row.kind === 'DIRECT' && (row.status === 'PREPARING' || row.status === 'ACTIVE') ? row.match_id : null,
        status: row.status,
        theme: { name: row.theme_name, slug: row.theme_slug },
      }];
    });
    const last = rows.at(-1);
    const nextCursor = result.results.length > pageSize && last !== undefined
      ? encodeChallengeCursor(last.created_at, last.id)
      : null;
    return { challenges, nextCursor };
  }
}

function encodeChallengeCursor(createdAt: string, id: string): string {
  return btoa(JSON.stringify([createdAt, id]));
}

function decodeChallengeCursor(cursor: string): { createdAt: string; id: string } | null {
  try {
    const [createdAt, id] = JSON.parse(atob(cursor)) as [string, string];
    if (typeof createdAt !== 'string' || typeof id !== 'string') return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}
