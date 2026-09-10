import {
  challengePair,
  decideChallengeCreation,
  directChallengeExpiresAt,
  isTerminalChallenge,
  transitionChallenge,
  ChallengeRuleError,
  LIVE_CHALLENGE_STATUSES,
  type ChallengeAction,
  type ChallengeKind,
  type ChallengeRecord,
  type ChallengeStatus,
  type Difficulty,
  type FriendPresence,
} from '@quiz-gomes/domain';
import { ApiError } from '../http/api-error.js';
import { customAvatarUrl } from '../storage/custom-avatar.js';

const LIVE_STATUS_LIST = LIVE_CHALLENGE_STATUSES.map((status) => `'${status}'`).join(', ');

export interface ChallengeParticipant {
  customAvatarUrl: string | null;
  displayName: string;
  frameId: string | null;
  photoUrl: string | null;
  publicId: string;
  userId: string;
}

export interface ChallengeView {
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
  revision: number;
  second_player_agreed: number;
  second_player_user_id: string;
  status: ChallengeStatus;
  theme_id: string;
}

interface ChallengeViewRow extends ChallengeRow {
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
  CASE WHEN a.active = 1 THEN a.version ELSE NULL END AS challenger_avatar_version
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

  async activeForPair(first: string, second: string): Promise<ChallengeRecord | null> {
    const [low, high] = challengePair(first, second);
    const row = await this.db.prepare(
      `SELECT id, difficulty, expires_at, first_player_user_id, kind, revision,
              second_player_agreed, second_player_user_id, status, theme_id
         FROM challenges
        WHERE pair_low_id = ?1 AND pair_high_id = ?2 AND status IN (${LIVE_STATUS_LIST})`,
    ).bind(low, high).first<ChallengeRow>();
    return row === null ? null : record(row);
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
    const existing = await this.activeForPair(input.actorUserId, input.targetUserId);
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
        const winner = await this.activeForPair(input.actorUserId, input.targetUserId);
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

  /** Nenhum payload competitivo sobrevive a um desafio encerrado sem resultado. */
  async cleanupPayload(challengeId: string): Promise<void> {
    await this.db.batch([
      this.db.prepare('DELETE FROM challenge_answers WHERE challenge_id = ?1').bind(challengeId),
      this.db.prepare('DELETE FROM challenge_questions WHERE challenge_id = ?1').bind(challengeId),
    ]);
  }

  /** Encerra o desafio pendente de uma dupla ao desfazer amizade ou bloquear. */
  async endForRelationship(first: string, second: string): Promise<void> {
    const challenge = await this.activeForPair(first, second);
    if (challenge === null) return;
    try {
      await this.applyAction(challenge, { type: 'RELATIONSHIP_ENDED' });
    } catch (error) {
      // Partida já iniciada nunca é derrubada por unfriend ou bloqueio.
      if (error instanceof ApiError && error.code === 'CHALLENGE_ALREADY_STARTED') return;
      throw error;
    }
  }

  /** Convites diretos vencidos, encerrados sem virar recusa. */
  async expireStaleDirect(): Promise<string[]> {
    const now = this.clock().toISOString();
    const stale = await this.db.prepare(
      `SELECT id FROM challenges
        WHERE status = 'PENDING_DIRECT' AND expires_at IS NOT NULL AND expires_at <= ?1
        LIMIT 50`,
    ).bind(now).all<{ id: string }>();
    if (stale.results.length === 0) return [];
    const ids = stale.results.map((row) => row.id);
    await this.db.batch(ids.map((id) => this.db.prepare(
      `UPDATE challenges SET status = 'EXPIRED', updated_at = ?1, revision = revision + 1
        WHERE id = ?2 AND status = 'PENDING_DIRECT'`,
    ).bind(now, id)));
    await Promise.all(ids.map((id) => this.cleanupPayload(id)));
    return ids;
  }

  /** Desafios que o usuário precisa ver no Social, dos dois lados. */
  async forUser(userId: string, nowMs = this.clock().getTime()): Promise<ChallengeView[]> {
    const result = await this.db.prepare(
      `SELECT ${VIEW_COLUMNS}
         FROM challenges c
         JOIN themes t ON t.id = c.theme_id
         JOIN user_profiles p ON p.user_id = c.first_player_user_id
         LEFT JOIN user_custom_avatars a ON a.user_id = c.first_player_user_id
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
