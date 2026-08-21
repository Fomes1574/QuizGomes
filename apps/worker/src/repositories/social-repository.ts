import { ApiError } from '../http/api-error.js';
import { customAvatarUrl } from '../storage/custom-avatar.js';

export const FRIEND_REQUEST_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1_000;
const SEARCH_LIMIT = 20;

export interface SocialUser {
  customAvatarUrl: string | null;
  displayName: string;
  frameId: string | null;
  photoUrl: string | null;
  publicId: string;
}

export interface SocialCandidate extends SocialUser {
  availableAt: string | null;
  relationship: 'FRIEND' | 'INCOMING' | 'NONE' | 'OUTGOING';
  requestId: string | null;
}

export interface SocialRequest {
  createdAt: string;
  id: string;
  user: SocialUser;
}

export interface FriendPresenceTarget {
  publicId: string;
  userId: string;
}

interface PersonRow {
  custom_avatar_version: number | null;
  display_name: string;
  equipped_frame_id: string | null;
  photo_url: string | null;
  public_id: string;
  user_id: string;
}

interface CandidateRow extends PersonRow {
  cooldown_until: string | null;
  friendship_exists: number;
  request_id: string | null;
  request_sender_user_id: string | null;
}

interface RequestRow extends PersonRow {
  created_at: string;
  request_id: string;
}

interface PendingRow {
  id: string;
  recipient_user_id: string;
  sender_user_id: string;
  status: 'ACCEPTED' | 'CANCELLED' | 'PENDING' | 'REJECTED';
}

const PUBLIC_PERSON_COLUMNS = `
  p.user_id, p.public_id, p.display_name, p.photo_url, p.equipped_frame_id,
  CASE WHEN a.active = 1 THEN a.version ELSE NULL END AS custom_avatar_version
`;

function person(row: PersonRow): SocialUser {
  return {
    customAvatarUrl: customAvatarUrl(row.user_id, row.custom_avatar_version),
    displayName: row.display_name,
    frameId: row.equipped_frame_id,
    photoUrl: row.photo_url,
    publicId: row.public_id,
  };
}

function unavailable(): ApiError {
  return new ApiError(404, 'USER_UNAVAILABLE', 'Este usuário não está disponível.');
}

function normalizedPair(first: string, second: string): [string, string] {
  return first < second ? [first, second] : [second, first];
}

export class SocialRepository {
  constructor(
    private readonly db: D1Database,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async search(actorUserId: string, rawSearch: string): Promise<SocialCandidate[]> {
    const value = rawSearch.trim().slice(0, 80);
    if (value.length < 2) return [];
    const byPublicId = value.startsWith('#');
    if (byPublicId && !/^#QG[A-Z0-9]{4,32}$/i.test(value)) return [];
    const term = byPublicId
      ? value.toUpperCase()
      : `${value.replaceAll(/[%_\\]/g, '\\$&')}%`;
    const where = byPublicId ? 'p.public_id = ?2 COLLATE NOCASE' : "p.display_name LIKE ?2 ESCAPE '\\' COLLATE NOCASE";
    const result = await this.db.prepare(
      `SELECT ${PUBLIC_PERSON_COLUMNS},
              CASE WHEN f.user_low_id IS NULL THEN 0 ELSE 1 END AS friendship_exists,
              r.id AS request_id, r.sender_user_id AS request_sender_user_id,
              CASE WHEN ps.cooldown_until > ?3 THEN ps.cooldown_until ELSE NULL END AS cooldown_until
         FROM user_profiles p
         JOIN users u ON u.id = p.user_id AND u.disabled_at IS NULL
         LEFT JOIN user_custom_avatars a ON a.user_id = p.user_id
         LEFT JOIN friendships f ON f.user_low_id = MIN(?1, p.user_id)
                                AND f.user_high_id = MAX(?1, p.user_id)
         LEFT JOIN friend_requests r ON r.status = 'PENDING'
           AND ((r.sender_user_id = ?1 AND r.recipient_user_id = p.user_id)
             OR (r.sender_user_id = p.user_id AND r.recipient_user_id = ?1))
         LEFT JOIN friend_request_pair_state ps
           ON ps.requester_user_id = ?1 AND ps.target_user_id = p.user_id
        WHERE p.user_id <> ?1 AND ${where}
          AND NOT EXISTS (
            SELECT 1 FROM user_blocks b
             WHERE (b.blocker_user_id = ?1 AND b.blocked_user_id = p.user_id)
                OR (b.blocker_user_id = p.user_id AND b.blocked_user_id = ?1)
          )
        ORDER BY p.display_name COLLATE NOCASE, p.public_id
        LIMIT ?4`,
    ).bind(actorUserId, term, this.clock().toISOString(), byPublicId ? 1 : SEARCH_LIMIT).all<CandidateRow>();
    return result.results.map((row) => ({
      ...person(row),
      availableAt: row.cooldown_until,
      relationship: row.friendship_exists === 1
        ? 'FRIEND'
        : row.request_id === null
          ? 'NONE'
          : row.request_sender_user_id === actorUserId ? 'OUTGOING' : 'INCOMING',
      requestId: row.request_id,
    }));
  }

  async snapshot(actorUserId: string): Promise<{
    friends: SocialUser[];
    incoming: SocialRequest[];
    outgoing: SocialRequest[];
  }> {
    const [friends, incoming, outgoing] = await Promise.all([
      this.db.prepare(
        `SELECT ${PUBLIC_PERSON_COLUMNS}
           FROM friendships f
           JOIN user_profiles p ON p.user_id =
             CASE WHEN f.user_low_id = ?1 THEN f.user_high_id ELSE f.user_low_id END
           JOIN users u ON u.id = p.user_id AND u.disabled_at IS NULL
           LEFT JOIN user_custom_avatars a ON a.user_id = p.user_id
          WHERE (f.user_low_id = ?1 OR f.user_high_id = ?1)
            AND NOT EXISTS (
              SELECT 1 FROM user_blocks b
               WHERE (b.blocker_user_id = ?1 AND b.blocked_user_id = p.user_id)
                  OR (b.blocker_user_id = p.user_id AND b.blocked_user_id = ?1)
            )
          ORDER BY p.display_name COLLATE NOCASE LIMIT 100`,
      ).bind(actorUserId).all<PersonRow>(),
      this.requests(actorUserId, 'incoming'),
      this.requests(actorUserId, 'outgoing'),
    ]);
    return { friends: friends.results.map(person), incoming, outgoing };
  }

  async pendingCount(actorUserId: string): Promise<number> {
    const row = await this.db.prepare(
      `SELECT COUNT(*) AS total FROM friend_requests r
        WHERE r.recipient_user_id = ?1 AND r.status = 'PENDING'
          AND NOT EXISTS (
            SELECT 1 FROM user_blocks b
             WHERE (b.blocker_user_id = ?1 AND b.blocked_user_id = r.sender_user_id)
                OR (b.blocker_user_id = r.sender_user_id AND b.blocked_user_id = ?1)
          )`,
    ).bind(actorUserId).first<{ total: number }>();
    return row?.total ?? 0;
  }

  async friendPresenceTargets(actorUserId: string): Promise<FriendPresenceTarget[]> {
    const result = await this.db.prepare(
      `SELECT p.public_id, p.user_id
         FROM friendships f
         JOIN user_profiles p ON p.user_id =
           CASE WHEN f.user_low_id = ?1 THEN f.user_high_id ELSE f.user_low_id END
         JOIN users u ON u.id = p.user_id AND u.disabled_at IS NULL
        WHERE (f.user_low_id = ?1 OR f.user_high_id = ?1)
          AND NOT EXISTS (
            SELECT 1 FROM user_blocks b
             WHERE (b.blocker_user_id = ?1 AND b.blocked_user_id = p.user_id)
                OR (b.blocker_user_id = p.user_id AND b.blocked_user_id = ?1)
          )
        ORDER BY p.public_id LIMIT 100`,
    ).bind(actorUserId).all<{ public_id: string; user_id: string }>();
    return result.results.map((row) => ({ publicId: row.public_id, userId: row.user_id }));
  }

  async sendRequest(actorUserId: string, targetPublicId: string): Promise<{
    created: boolean;
    requestId: string;
    targetUserId: string;
  }> {
    const target = await this.visibleTarget(actorUserId, targetPublicId);
    const now = this.clock().toISOString();
    await this.db.prepare(
      `DELETE FROM friend_request_pair_state
        WHERE requester_user_id = ?1 AND target_user_id = ?2
          AND cooldown_until IS NOT NULL AND cooldown_until <= ?3`,
    ).bind(actorUserId, target.user_id, now).run();
    const requestId = crypto.randomUUID();
    try {
      const inserted = await this.db.prepare(
        `INSERT INTO friend_requests (id, sender_user_id, recipient_user_id, created_at)
         SELECT ?1, ?2, ?3, ?4
          WHERE ?2 <> ?3
            AND NOT EXISTS (
              SELECT 1 FROM user_blocks b
               WHERE (b.blocker_user_id = ?2 AND b.blocked_user_id = ?3)
                  OR (b.blocker_user_id = ?3 AND b.blocked_user_id = ?2)
            )
            AND NOT EXISTS (
              SELECT 1 FROM friendships
               WHERE user_low_id = MIN(?2, ?3) AND user_high_id = MAX(?2, ?3)
            )
            AND NOT EXISTS (
              SELECT 1 FROM friend_request_pair_state
               WHERE requester_user_id = ?2 AND target_user_id = ?3 AND cooldown_until > ?4
            )
            AND NOT EXISTS (
              SELECT 1 FROM friend_requests
               WHERE status = 'PENDING'
                 AND ((sender_user_id = ?2 AND recipient_user_id = ?3)
                   OR (sender_user_id = ?3 AND recipient_user_id = ?2))
            )`,
      ).bind(requestId, actorUserId, target.user_id, now).run();
      if ((inserted.meta.changes ?? 0) === 1) {
        return { created: true, requestId, targetUserId: target.user_id };
      }
    } catch (error) {
      if (!(error instanceof Error) || !/UNIQUE constraint failed/i.test(error.message)) throw error;
    }
    if (await this.blocked(actorUserId, target.user_id)) throw unavailable();
    const pending = await this.pendingPair(actorUserId, target.user_id);
    if (pending !== null) {
      if (pending.sender_user_id === actorUserId) {
        return { created: false, requestId: pending.id, targetUserId: target.user_id };
      }
      throw new ApiError(409, 'INCOMING_REQUEST_EXISTS', 'Este usuário já enviou uma solicitação para você.', {
        requestId: pending.id,
      });
    }
    const state = await this.db.prepare(
      `SELECT cooldown_until FROM friend_request_pair_state
        WHERE requester_user_id = ?1 AND target_user_id = ?2 AND cooldown_until > ?3`,
    ).bind(actorUserId, target.user_id, now).first<{ cooldown_until: string }>();
    if (state !== null) {
      const date = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(state.cooldown_until));
      throw new ApiError(409, 'FRIEND_REQUEST_COOLDOWN',
        `Você poderá enviar uma nova solicitação para este usuário em ${date}.`,
        { availableAt: state.cooldown_until });
    }
    const [low, high] = normalizedPair(actorUserId, target.user_id);
    const friendship = await this.db.prepare(
      'SELECT 1 AS exists_flag FROM friendships WHERE user_low_id = ?1 AND user_high_id = ?2',
    ).bind(low, high).first();
    if (friendship !== null) throw new ApiError(409, 'ALREADY_FRIENDS', 'Vocês já são amigos.');
    throw unavailable();
  }

  async acceptRequest(actorUserId: string, requestId: string): Promise<void> {
    const row = await this.ownedIncoming(actorUserId, requestId);
    if (row.status === 'ACCEPTED') return;
    if (row.status !== 'PENDING') {
      throw new ApiError(409, 'REQUEST_ALREADY_RESOLVED', 'Esta solicitação já foi resolvida.');
    }
    if (await this.blocked(actorUserId, row.sender_user_id)) throw unavailable();
    const [low, high] = normalizedPair(actorUserId, row.sender_user_id);
    const resolutionKey = crypto.randomUUID();
    const now = this.clock().toISOString();
    const results = await this.db.batch([
      this.db.prepare(
        `UPDATE friend_requests SET status = 'ACCEPTED', resolved_at = ?1, resolution_key = ?2
          WHERE id = ?3 AND recipient_user_id = ?4 AND status = 'PENDING'
            AND NOT EXISTS (
              SELECT 1 FROM user_blocks b
               WHERE (b.blocker_user_id = recipient_user_id AND b.blocked_user_id = sender_user_id)
                  OR (b.blocker_user_id = sender_user_id AND b.blocked_user_id = recipient_user_id)
            )`,
      ).bind(now, resolutionKey, requestId, actorUserId),
      this.db.prepare(
        `INSERT OR IGNORE INTO friendships (user_low_id, user_high_id, created_at)
         SELECT ?1, ?2, ?3 FROM friend_requests
          WHERE id = ?4 AND status = 'ACCEPTED' AND resolution_key = ?5`,
      ).bind(low, high, now, requestId, resolutionKey),
      this.db.prepare(
        `DELETE FROM friend_request_pair_state
          WHERE requester_user_id = ?1 AND target_user_id = ?2
            AND EXISTS (
              SELECT 1 FROM friend_requests
               WHERE id = ?3 AND status = 'ACCEPTED' AND resolution_key = ?4
            )`,
      ).bind(row.sender_user_id, actorUserId, requestId, resolutionKey),
    ]);
    if ((results[0]?.meta.changes ?? 0) !== 1) {
      const current = await this.ownedIncoming(actorUserId, requestId);
      if (current.status !== 'ACCEPTED') {
        if (await this.blocked(actorUserId, row.sender_user_id)) throw unavailable();
        throw new ApiError(409, 'REQUEST_ALREADY_RESOLVED', 'Esta solicitação já foi resolvida.');
      }
    }
  }

  async rejectRequest(actorUserId: string, requestId: string): Promise<void> {
    const row = await this.ownedIncoming(actorUserId, requestId);
    if (row.status === 'REJECTED') return;
    if (row.status !== 'PENDING') {
      throw new ApiError(409, 'REQUEST_ALREADY_RESOLVED', 'Esta solicitação já foi resolvida.');
    }
    const now = this.clock();
    const nowIso = now.toISOString();
    const cooldownUntil = new Date(now.getTime() + FRIEND_REQUEST_COOLDOWN_MS).toISOString();
    const resolutionKey = crypto.randomUUID();
    const results = await this.db.batch([
      this.db.prepare(
        `UPDATE friend_requests SET status = 'REJECTED', resolved_at = ?1, resolution_key = ?2
          WHERE id = ?3 AND recipient_user_id = ?4 AND status = 'PENDING'`,
      ).bind(nowIso, resolutionKey, requestId, actorUserId),
      this.db.prepare(
        `INSERT INTO friend_request_pair_state
           (requester_user_id, target_user_id, rejection_count, cooldown_until, updated_at)
         SELECT sender_user_id, recipient_user_id, 1, NULL, ?1
           FROM friend_requests
          WHERE id = ?2 AND status = 'REJECTED' AND resolution_key = ?3
         ON CONFLICT(requester_user_id, target_user_id) DO UPDATE SET
           rejection_count = CASE
             WHEN friend_request_pair_state.cooldown_until IS NOT NULL
                  AND friend_request_pair_state.cooldown_until <= ?1 THEN 1
             WHEN friend_request_pair_state.rejection_count >= 2 THEN 3
             ELSE friend_request_pair_state.rejection_count + 1
           END,
           cooldown_until = CASE
             WHEN friend_request_pair_state.cooldown_until IS NOT NULL
                  AND friend_request_pair_state.cooldown_until <= ?1 THEN NULL
             WHEN friend_request_pair_state.rejection_count >= 2 THEN ?4
             ELSE NULL
           END,
           updated_at = ?1`,
      ).bind(nowIso, requestId, resolutionKey, cooldownUntil),
    ]);
    if ((results[0]?.meta.changes ?? 0) !== 1) {
      const current = await this.ownedIncoming(actorUserId, requestId);
      if (current.status !== 'REJECTED') {
        throw new ApiError(409, 'REQUEST_ALREADY_RESOLVED', 'Esta solicitação já foi resolvida.');
      }
    }
  }

  async cancelRequest(actorUserId: string, requestId: string): Promise<void> {
    const existing = await this.db.prepare(
      'SELECT sender_user_id, status FROM friend_requests WHERE id = ?1',
    ).bind(requestId).first<Pick<PendingRow, 'sender_user_id' | 'status'>>();
    if (existing === null || existing.sender_user_id !== actorUserId) throw unavailable();
    if (existing.status === 'CANCELLED') return;
    if (existing.status !== 'PENDING') {
      throw new ApiError(409, 'REQUEST_ALREADY_RESOLVED', 'Esta solicitação já foi resolvida.');
    }
    await this.db.prepare(
      `UPDATE friend_requests SET status = 'CANCELLED', resolved_at = ?1
        WHERE id = ?2 AND sender_user_id = ?3 AND status = 'PENDING'`,
    ).bind(this.clock().toISOString(), requestId, actorUserId).run();
  }

  async removeFriend(actorUserId: string, targetPublicId: string): Promise<void> {
    const target = await this.visibleTarget(actorUserId, targetPublicId);
    const [low, high] = normalizedPair(actorUserId, target.user_id);
    await this.db.prepare(
      'DELETE FROM friendships WHERE user_low_id = ?1 AND user_high_id = ?2',
    ).bind(low, high).run();
  }

  async block(actorUserId: string, targetPublicId: string): Promise<void> {
    const target = await this.target(actorUserId, targetPublicId);
    const reverse = await this.db.prepare(
      'SELECT 1 AS exists_flag FROM user_blocks WHERE blocker_user_id = ?1 AND blocked_user_id = ?2',
    ).bind(target.user_id, actorUserId).first();
    if (reverse !== null) throw unavailable();
    const [low, high] = normalizedPair(actorUserId, target.user_id);
    const now = this.clock().toISOString();
    await this.db.batch([
      this.db.prepare(
        'INSERT OR IGNORE INTO user_blocks (blocker_user_id, blocked_user_id, created_at) VALUES (?1, ?2, ?3)',
      ).bind(actorUserId, target.user_id, now),
      this.db.prepare('DELETE FROM friendships WHERE user_low_id = ?1 AND user_high_id = ?2').bind(low, high),
      this.db.prepare(
        `UPDATE friend_requests SET status = 'CANCELLED', resolved_at = ?1
          WHERE status = 'PENDING'
            AND ((sender_user_id = ?2 AND recipient_user_id = ?3)
              OR (sender_user_id = ?3 AND recipient_user_id = ?2))`,
      ).bind(now, actorUserId, target.user_id),
    ]);
  }

  async unblock(actorUserId: string, targetPublicId: string): Promise<void> {
    const result = await this.db.prepare(
      `DELETE FROM user_blocks
        WHERE blocker_user_id = ?1
          AND blocked_user_id = (
            SELECT user_id FROM user_profiles WHERE public_id = ?2 COLLATE NOCASE
          )`,
    ).bind(actorUserId, targetPublicId).run();
    if ((result.meta.changes ?? 0) === 0) throw unavailable();
  }

  async blockedUsers(actorUserId: string): Promise<SocialUser[]> {
    const rows = await this.db.prepare(
      `SELECT ${PUBLIC_PERSON_COLUMNS}
         FROM user_blocks b
         JOIN user_profiles p ON p.user_id = b.blocked_user_id
         JOIN users u ON u.id = p.user_id AND u.disabled_at IS NULL
         LEFT JOIN user_custom_avatars a ON a.user_id = p.user_id
        WHERE b.blocker_user_id = ?1
        ORDER BY p.display_name COLLATE NOCASE LIMIT 100`,
    ).bind(actorUserId).all<PersonRow>();
    return rows.results.map(person);
  }

  async registerInstallation(actorUserId: string, installationId: string): Promise<void> {
    const result = await this.db.prepare(
      `INSERT INTO push_installations (installation_id, user_id, enabled, updated_at)
       VALUES (?1, ?2, 1, ?3)
       ON CONFLICT(installation_id) DO UPDATE SET enabled = 1, updated_at = excluded.updated_at
       WHERE push_installations.user_id = excluded.user_id`,
    ).bind(installationId, actorUserId, this.clock().toISOString()).run();
    if ((result.meta.changes ?? 0) === 0) {
      throw new ApiError(409, 'INSTALLATION_UNAVAILABLE', 'Não foi possível registrar este dispositivo.');
    }
  }

  async unregisterInstallation(actorUserId: string, installationId: string): Promise<void> {
    const result = await this.db.prepare(
      'DELETE FROM push_installations WHERE installation_id = ?1 AND user_id = ?2',
    ).bind(installationId, actorUserId).run();
    if ((result.meta.changes ?? 0) === 0) throw unavailable();
  }

  async enabledInstallations(userId: string): Promise<string[]> {
    const rows = await this.db.prepare(
      'SELECT installation_id FROM push_installations WHERE user_id = ?1 AND enabled = 1 LIMIT 20',
    ).bind(userId).all<{ installation_id: string }>();
    return rows.results.map((row) => row.installation_id);
  }

  async markInstallationSuccess(installationId: string): Promise<void> {
    await this.db.prepare(
      'UPDATE push_installations SET last_success_at = ?1 WHERE installation_id = ?2',
    ).bind(this.clock().toISOString(), installationId).run();
  }

  async disableInstallation(installationId: string): Promise<void> {
    await this.db.prepare(
      'UPDATE push_installations SET enabled = 0, updated_at = ?1 WHERE installation_id = ?2',
    ).bind(this.clock().toISOString(), installationId).run();
  }

  async blocked(firstUserId: string, secondUserId: string): Promise<boolean> {
    const row = await this.db.prepare(
      `SELECT 1 AS exists_flag FROM user_blocks
        WHERE (blocker_user_id = ?1 AND blocked_user_id = ?2)
           OR (blocker_user_id = ?2 AND blocked_user_id = ?1)
        LIMIT 1`,
    ).bind(firstUserId, secondUserId).first();
    return row !== null;
  }

  private async requests(actorUserId: string, direction: 'incoming' | 'outgoing'): Promise<SocialRequest[]> {
    const actorColumn = direction === 'incoming' ? 'recipient_user_id' : 'sender_user_id';
    const personColumn = direction === 'incoming' ? 'sender_user_id' : 'recipient_user_id';
    const rows = await this.db.prepare(
      `SELECT ${PUBLIC_PERSON_COLUMNS}, r.id AS request_id, r.created_at
         FROM friend_requests r
         JOIN user_profiles p ON p.user_id = r.${personColumn}
         JOIN users u ON u.id = p.user_id AND u.disabled_at IS NULL
         LEFT JOIN user_custom_avatars a ON a.user_id = p.user_id
        WHERE r.${actorColumn} = ?1 AND r.status = 'PENDING'
          AND NOT EXISTS (
            SELECT 1 FROM user_blocks b
             WHERE (b.blocker_user_id = ?1 AND b.blocked_user_id = p.user_id)
                OR (b.blocker_user_id = p.user_id AND b.blocked_user_id = ?1)
          )
        ORDER BY r.created_at DESC LIMIT 100`,
    ).bind(actorUserId).all<RequestRow>();
    return rows.results.map((row) => ({ createdAt: row.created_at, id: row.request_id, user: person(row) }));
  }

  private async pendingPair(first: string, second: string): Promise<PendingRow | null> {
    return this.db.prepare(
      `SELECT id, sender_user_id, recipient_user_id, status FROM friend_requests
        WHERE status = 'PENDING'
          AND ((sender_user_id = ?1 AND recipient_user_id = ?2)
            OR (sender_user_id = ?2 AND recipient_user_id = ?1)) LIMIT 1`,
    ).bind(first, second).first<PendingRow>();
  }

  private async ownedIncoming(actorUserId: string, requestId: string): Promise<PendingRow> {
    const row = await this.db.prepare(
      'SELECT id, sender_user_id, recipient_user_id, status FROM friend_requests WHERE id = ?1',
    ).bind(requestId).first<PendingRow>();
    if (row === null || row.recipient_user_id !== actorUserId) throw unavailable();
    return row;
  }

  private async target(actorUserId: string, publicId: string): Promise<PersonRow> {
    const row = await this.db.prepare(
      `SELECT ${PUBLIC_PERSON_COLUMNS}
         FROM user_profiles p
         JOIN users u ON u.id = p.user_id AND u.disabled_at IS NULL
         LEFT JOIN user_custom_avatars a ON a.user_id = p.user_id
        WHERE p.public_id = ?1 COLLATE NOCASE AND p.user_id <> ?2`,
    ).bind(publicId, actorUserId).first<PersonRow>();
    if (row === null) throw unavailable();
    return row;
  }

  private async visibleTarget(actorUserId: string, publicId: string): Promise<PersonRow> {
    const row = await this.target(actorUserId, publicId);
    if (await this.blocked(actorUserId, row.user_id)) throw unavailable();
    return row;
  }
}
