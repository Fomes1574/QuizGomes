import {
  challengePair,
  decideChallengeCreation,
  directChallengeExpiresAt,
  isTerminalChallenge,
  questionsForDifficulty,
  transitionChallenge,
  xpAward,
  ChallengeRuleError,
  LIVE_CHALLENGE_STATUSES,
  TOTAL_XP_TO_MAX_LEVEL,
  type ChallengeAction,
  type ChallengeKind,
  type ChallengeRecord,
  type ChallengeStatus,
  type Difficulty,
  type FriendPresence,
  type LiveQuestion,
  type SealedRoundAnswer,
} from '@quiz-gomes/domain';
import { ApiError } from '../http/api-error.js';
import { QuestionRepository } from './question-repository.js';
import { QuestionSelectionService } from '../services/question-selection-service.js';
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
  difficulty: Difficulty;
  expiresAt: string | null;
  id: string;
  kind: ChallengeKind;
  /** Papel de quem consulta: quem desafiou ou quem foi desafiado. */
  role: 'CHALLENGED' | 'CHALLENGER';
  status: ChallengeStatus;
  theme: { name: string; slug: string };
}

interface ChallengeRow {
  difficulty: Difficulty;
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
    difficulty: row.difficulty,
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
  c.id, c.difficulty, c.expires_at, c.first_player_user_id, c.kind, c.revision,
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
      `SELECT id, difficulty, expires_at, first_player_user_id, kind, revision,
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
      `SELECT id, difficulty, expires_at, first_player_user_id, kind, revision,
              second_player_agreed, second_player_user_id, status, theme_id
         FROM challenges
        WHERE pair_low_id = ?1 AND pair_high_id = ?2 AND status IN (${LIVE_STATUS_LIST})`,
    ).bind(low, high).all<ChallengeRow>();
    return result.results.map(record);
  }

  async byId(challengeId: string): Promise<ChallengeRecord | null> {
    const row = await this.db.prepare(
      `SELECT id, difficulty, expires_at, first_player_user_id, kind, revision,
              second_player_agreed, second_player_user_id, status, theme_id
         FROM challenges WHERE id = ?1`,
    ).bind(challengeId).first<ChallengeRow>();
    return row === null ? null : record(row);
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
    const result = await this.db.prepare(
      `SELECT id, difficulty, expires_at, first_player_user_id, kind, match_id, revision,
              second_player_agreed, second_player_user_id, status, theme_id, updated_at
         FROM challenges
        WHERE (first_player_user_id = ?1 OR second_player_user_id = ?1)
          AND status IN (${LIVE_STATUS_LIST})
        ORDER BY updated_at DESC LIMIT 50`,
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
    const match = await this.directMatchStatus(challenge.matchId);
    if (match !== 'FINISHED' && match !== 'VOID') return false;
    const terminal = match === 'FINISHED' ? 'COMPLETED' : 'VOID';
    const applied = await this.db.prepare(
      `UPDATE challenges SET status = ?1, updated_at = ?2, revision = revision + 1
        WHERE id = ?3 AND revision = ?4 AND kind = 'DIRECT' AND status IN ('PREPARING', 'ACTIVE')`,
    ).bind(terminal, this.clock().toISOString(), challenge.id, challenge.revision).run();
    if ((applied.meta.changes ?? 0) === 1 && terminal === 'VOID') await this.cleanupPayload(challenge.id);
    return (applied.meta.changes ?? 0) === 1;
  }

  /** Estado mínimo usado exclusivamente pela reconciliação de reservas DIRECT. */
  async directMatchStatus(matchId: string): Promise<string | null> {
    return (await this.db.prepare('SELECT status FROM matches WHERE id = ?1')
      .bind(matchId).first<{ status: string }>())?.status ?? null;
  }

  async reconcileDirectMatchId(matchId: string): Promise<{
    challengeId: string | null; changed: boolean; participants: [string, string] | null;
  }> {
    const row = await this.db.prepare(
      `SELECT id, difficulty, expires_at, first_player_user_id, kind, match_id, revision,
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
    difficulty: Difficulty;
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
      const inserted = await this.db.prepare(
        `INSERT INTO challenges
           (id, pair_low_id, pair_high_id, first_player_user_id, second_player_user_id,
            theme_id, difficulty, kind, status, expires_at, created_at, updated_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11
          WHERE EXISTS (SELECT 1 FROM themes WHERE id = ?6 AND status = 'ACTIVE')`,
      ).bind(id, low, high, input.actorUserId, input.targetUserId, input.themeId,
        input.difficulty, input.kind, status, expiresAt, now).run();
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
    difficulty: Difficulty,
    questionsDb: D1Database,
  ): Promise<void> {
    const existing = await this.db.prepare(
      'SELECT COUNT(*) AS total FROM challenge_questions WHERE challenge_id = ?1',
    ).bind(challengeId).first<{ total: number }>();
    if ((existing?.total ?? 0) > 0) return;

    const selected = await new QuestionSelectionService(new QuestionRepository(questionsDb))
      .select(themeId, difficulty, questionsForDifficulty(difficulty));
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
   * Sela a metade de um jogador e avança o desafio, tudo em um único batch.
   *
   * Idempotente: reexecutar não duplica respostas nem aplica XP duas vezes, porque
   * a inserção ignora conflito e a transição exige o estado de origem exato.
   */
  async sealHalf(input: {
    answers: readonly SealedRoundAnswer[];
    challengeId: string;
    difficulty: Difficulty;
    isSecondPlayer: boolean;
    opponentScore: number;
    userId: string;
  }): Promise<void> {
    const now = this.clock().toISOString();
    const score = input.answers.reduce((total, answer) => total + answer.score, 0);
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
      await this.db.batch(statements);
      return;
    }

    // Desafio entre amigos é sempre Casual: Conhecimento nunca muda, só XP de vitória.
    const result = score === input.opponentScore ? 'DRAW' : score > input.opponentScore ? 'WIN' : 'LOSS';
    const xpDelta = xpAward(input.difficulty, result);
    statements.push(this.db.prepare(
      `UPDATE challenges SET status = 'COMPLETED', updated_at = ?1, revision = revision + 1
        WHERE id = ?2 AND status = 'SECOND_PLAYER_ACTIVE'`,
    ).bind(now, input.challengeId));
    const applied = await this.db.batch(statements);
    if ((applied.at(-1)?.meta.changes ?? 0) !== 1) return;
    await this.awardChallengeXp(input.challengeId, input.difficulty, score, input.opponentScore, input.userId, xpDelta);
  }

  /**
   * XP de desafio concluído, para os dois jogadores. O ledger por partida garante
   * que uma reexecução não pague duas vezes.
   */
  private async awardChallengeXp(
    challengeId: string,
    difficulty: Difficulty,
    secondScore: number,
    firstScore: number,
    secondUserId: string,
    secondXp: number,
  ): Promise<void> {
    const challenge = await this.byId(challengeId);
    if (challenge === null) return;
    const firstResult = firstScore === secondScore ? 'DRAW' : firstScore > secondScore ? 'WIN' : 'LOSS';
    const awards: Array<[string, number]> = [
      [challenge.firstPlayerUserId, xpAward(difficulty, firstResult)],
      [secondUserId, secondXp],
    ];
    // Empate paga zero aos dois: sem escrita nenhuma, e sem batch vazio.
    const payable = awards.filter(([, xp]) => xp > 0);
    if (payable.length === 0) return;
    await this.db.batch(payable.map(([userId, xp]) => this.db.prepare(
      `UPDATE user_profiles
          SET total_xp = MIN(?1, total_xp + ?2), updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?3`,
    ).bind(TOTAL_XP_TO_MAX_LEVEL, xp, userId)));
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

  /** Marca a metade do segundo jogador como anulada, sem vencedor, XP ou Conhecimento. */
  async voidChallenge(challengeId: string): Promise<void> {
    await this.db.prepare(
      `UPDATE challenges SET status = 'VOID', updated_at = ?1, revision = revision + 1
        WHERE id = ?2 AND status IN (${LIVE_STATUS_LIST})`,
    ).bind(this.clock().toISOString(), challengeId).run();
    await this.cleanupPayload(challengeId);
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

  /** Desafios que o usuário precisa ver no Social, dos dois lados. */
  async forUser(userId: string, nowMs = this.clock().getTime()): Promise<ChallengeView[]> {
    const result = await this.db.prepare(
      `SELECT ${VIEW_COLUMNS}
         FROM challenges c
         JOIN themes t ON t.id = c.theme_id
         JOIN user_profiles p ON p.user_id = c.first_player_user_id
         JOIN user_profiles q ON q.user_id = c.second_player_user_id
         LEFT JOIN user_custom_avatars a ON a.user_id = c.first_player_user_id
         LEFT JOIN user_custom_avatars b ON b.user_id = c.second_player_user_id
        WHERE (c.first_player_user_id = ?1 OR c.second_player_user_id = ?1)
          AND c.status IN (${LIVE_STATUS_LIST})
        ORDER BY c.created_at DESC
        LIMIT 50`,
    ).bind(userId).all<ChallengeViewRow>();
    return result.results.flatMap((row) => {
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
        difficulty: row.difficulty,
        expiresAt: row.expires_at,
        id: row.id,
        kind: row.kind,
        role: row.first_player_user_id === userId ? 'CHALLENGER' as const : 'CHALLENGED' as const,
        status: row.status,
        theme: { name: row.theme_name, slug: row.theme_slug },
      }];
    });
  }
}
