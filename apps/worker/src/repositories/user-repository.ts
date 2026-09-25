import { categoryAverage, type CategoryAverage } from '@quiz-gomes/domain';
import type { AuthenticatedUser } from '../env.js';
import { customAvatarUrl } from '../storage/custom-avatar.js';
import { d1BlobToArrayBuffer } from '../storage/d1-blob.js';

const PUBLIC_ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export interface UserProfileRecord {
  avatarKey: string;
  customAvatarUrl: string | null;
  displayName: string;
  equippedFrameId: string | null;
  equippedTitleId: string | null;
  photoUrl: string | null;
  publicId: string;
  totalXp: number;
  userId: string;
}

export interface BestThemeRecord {
  knowledge: number;
  name: string;
  rankedMatches: number;
  slug: string;
}

export interface MatchSummaryRecord {
  draws: number;
  losses: number;
  matches: number;
  wins: number;
}

export interface CategoryAverageRecord {
  average: CategoryAverage;
  categoryId: string;
  categoryName: string;
}

export interface AdminUserRecord {
  createdAt: string;
  displayName: string;
  publicId: string;
  role: 'ADMIN' | 'PLAYER';
  userId: string;
}

export interface AdminUserPage {
  nextCursor: string | null;
  users: AdminUserRecord[];
}

interface UserProfileRow {
  avatar_key: string;
  custom_avatar_version: number | null;
  display_name: string;
  equipped_frame_id: string | null;
  equipped_title_id: string | null;
  photo_url: string | null;
  public_id: string;
  total_xp: number;
  user_id: string;
}

function toProfile(row: UserProfileRow): UserProfileRecord {
  return {
    avatarKey: row.avatar_key,
    customAvatarUrl: customAvatarUrl(row.user_id, row.custom_avatar_version),
    displayName: row.display_name,
    equippedFrameId: row.equipped_frame_id,
    equippedTitleId: row.equipped_title_id,
    photoUrl: row.photo_url,
    publicId: row.public_id,
    totalXp: row.total_xp,
    userId: row.user_id,
  };
}

function publicId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const suffix = [...bytes].map((value) => PUBLIC_ID_ALPHABET[value % PUBLIC_ID_ALPHABET.length]).join('');
  return `#QG${suffix}`;
}

function safeGooglePhoto(url: string | null): string | null {
  if (url === null) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname.endsWith('googleusercontent.com') ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/** Mesmo formato exigido pelo CHECK da migration 0019. */
export function customAvatarObjectKey(userId: string, version: number): string {
  return `avatars/${userId}/v${version}.webp`;
}

export class UserRepository {
  constructor(private readonly db: D1Database) {}

  async findByFirebaseUid(uid: string): Promise<UserProfileRecord | null> {
    const row = await this.db.prepare(
      `SELECT u.id AS user_id, p.public_id, p.display_name, p.photo_url, p.avatar_key,
              p.equipped_frame_id, p.equipped_title_id, p.total_xp,
              CASE WHEN a.active = 1 THEN a.version ELSE NULL END AS custom_avatar_version
         FROM users u
         JOIN user_profiles p ON p.user_id = u.id
         LEFT JOIN user_custom_avatars a ON a.user_id = u.id
        WHERE u.firebase_uid = ?1 AND u.disabled_at IS NULL`,
    ).bind(uid).first<UserProfileRow>();
    return row === null ? null : toProfile(row);
  }

  /** Melhor tema real do jogador: só rankings que já tiveram Ranqueada contam. */
  async bestTheme(userId: string): Promise<BestThemeRecord | null> {
    const row = await this.db.prepare(
      `SELECT t.name, t.slug, r.knowledge, r.ranked_matches
         FROM theme_rankings r
         JOIN themes t ON t.id = r.theme_id
        WHERE r.user_id = ?1 AND r.ranked_matches > 0
        ORDER BY r.knowledge DESC, r.ranked_matches DESC, t.name COLLATE NOCASE
        LIMIT 1`,
    ).bind(userId).first<{
      knowledge: number;
      name: string;
      ranked_matches: number;
      slug: string;
    }>();
    return row === null ? null : {
      knowledge: row.knowledge,
      name: row.name,
      rankedMatches: row.ranked_matches,
      slug: row.slug,
    };
  }

  /** Totais de partidas Ranqueadas somados de todos os temas: exibição no Perfil, sem efeito competitivo. */
  async matchSummary(userId: string): Promise<MatchSummaryRecord> {
    const row = await this.db.prepare(
      `SELECT COALESCE(SUM(ranked_matches), 0) AS matches, COALESCE(SUM(wins), 0) AS wins,
              COALESCE(SUM(losses), 0) AS losses, COALESCE(SUM(draws), 0) AS draws
         FROM theme_rankings WHERE user_id = ?1`,
    ).bind(userId).first<{ draws: number; losses: number; matches: number; wins: number }>();
    return row ?? { draws: 0, losses: 0, matches: 0, wins: 0 };
  }

  /**
   * Média ordinal fracionária por categoria (apenas temas com Ranqueada,
   * cap em Desafiante I): puramente exibicional, nunca influencia matchmaking
   * ou resultado. Categorias sem nenhum tema jogado não aparecem.
   */
  async categoryAverages(userId: string): Promise<CategoryAverageRecord[]> {
    const result = await this.db.prepare(
      `SELECT c.id AS category_id, c.name AS category_name, r.knowledge, r.ranked_matches
         FROM theme_rankings r
         JOIN themes t ON t.id = r.theme_id
         JOIN categories c ON c.id = t.category_id
        WHERE r.user_id = ?1`,
    ).bind(userId).all<{ category_id: string; category_name: string; knowledge: number; ranked_matches: number }>();
    const byCategory = new Map<string, { name: string; samples: { knowledge: number; rankedMatches: number }[] }>();
    for (const row of result.results) {
      const entry = byCategory.get(row.category_id) ?? { name: row.category_name, samples: [] };
      entry.samples.push({ knowledge: row.knowledge, rankedMatches: row.ranked_matches });
      byCategory.set(row.category_id, entry);
    }
    const records: CategoryAverageRecord[] = [];
    for (const [categoryId, entry] of byCategory) {
      const average = categoryAverage(entry.samples);
      if (average !== null) records.push({ average, categoryId, categoryName: entry.name });
    }
    return records.sort((a, b) => a.categoryName.localeCompare(b.categoryName, 'pt-BR'));
  }

  /** Firebase UID de cada usuário, para reservas de presença e salas. */
  async firebaseUidsFor(userIds: readonly string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();
    const placeholders = userIds.map((_, index) => `?${index + 1}`).join(', ');
    const result = await this.db.prepare(
      `SELECT id, firebase_uid FROM users WHERE id IN (${placeholders}) AND disabled_at IS NULL`,
    ).bind(...userIds).all<{ firebase_uid: string; id: string }>();
    return new Map(result.results.map((row) => [row.id, row.firebase_uid]));
  }

  async ensureProfile(
    identity: AuthenticatedUser,
    displayName: string,
    shouldBootstrapAdmin: boolean,
  ): Promise<UserProfileRecord> {
    const existing = await this.findByFirebaseUid(identity.uid);
    if (existing !== null) {
      await this.db.prepare('UPDATE users SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?1').bind(existing.userId).run();
      if (shouldBootstrapAdmin) await this.grantBootstrapAdmin(existing.userId);
      return existing;
    }

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const userId = crypto.randomUUID();
      const candidatePublicId = publicId();
      try {
        const statements = [
          this.db.prepare('INSERT INTO users (id, firebase_uid) VALUES (?1, ?2)').bind(userId, identity.uid),
          this.db.prepare(
            `INSERT INTO user_profiles (user_id, public_id, display_name, photo_url)
             VALUES (?1, ?2, ?3, ?4)`,
          ).bind(userId, candidatePublicId, displayName, safeGooglePhoto(identity.picture)),
        ];
        if (shouldBootstrapAdmin) {
          statements.push(
            this.db.prepare("INSERT INTO user_roles (user_id, role) VALUES (?1, 'ADMIN')").bind(userId),
          );
        }
        await this.db.batch(statements);
        const created = await this.findByFirebaseUid(identity.uid);
        if (created !== null) return created;
      } catch (error) {
        const wonRace = await this.findByFirebaseUid(identity.uid);
        if (wonRace !== null) return wonRace;
        if (attempt === 7) throw error;
      }
    }
    throw new Error('Não foi possível gerar um ID público único.');
  }

  async updateDisplayName(uid: string, displayName: string): Promise<UserProfileRecord | null> {
    await this.db.prepare(
      `UPDATE user_profiles
          SET display_name = ?1, profile_version = profile_version + 1, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = (SELECT id FROM users WHERE firebase_uid = ?2 AND disabled_at IS NULL)`,
    ).bind(displayName, uid).run();
    return this.findByFirebaseUid(uid);
  }

  /**
   * Novo avatar vai para o R2 (bucket privado, prefixo "avatars/") com chave
   * nova por versão; o D1 guarda só o ponteiro. CAS pela versão anterior:
   * duas trocas simultâneas nunca se sobrescrevem em silêncio. Se o D1
   * recusar, o objeto recém-gravado é apagado. O objeto anterior sai do
   * bucket depois que o ponteiro já mudou.
   */
  async replaceCustomAvatar(uid: string, data: ArrayBuffer, bucket: R2Bucket): Promise<UserProfileRecord | null> {
    const current = await this.db.prepare(
      `SELECT u.id AS user_id, a.version, a.object_key
         FROM users u
         LEFT JOIN user_custom_avatars a ON a.user_id = u.id
        WHERE u.firebase_uid = ?1 AND u.disabled_at IS NULL`,
    ).bind(uid).first<{ object_key: string | null; user_id: string; version: number | null }>();
    if (current === null) return null;
    const nextVersion = (current.version ?? 0) + 1;
    const key = customAvatarObjectKey(current.user_id, nextVersion);
    await bucket.put(key, data, { httpMetadata: { contentType: 'image/webp' } });
    const statement = current.version === null
      ? this.db.prepare(
        `INSERT OR IGNORE INTO user_custom_avatars (
           user_id, version, active, content_type, width, height, byte_length, image_data, object_key
         ) VALUES (?1, ?2, 1, 'image/webp', 256, 256, ?3, NULL, ?4)`,
      ).bind(current.user_id, nextVersion, data.byteLength, key)
      : this.db.prepare(
        `UPDATE user_custom_avatars
            SET version = ?2, active = 1, content_type = 'image/webp', width = 256, height = 256,
                byte_length = ?3, image_data = NULL, object_key = ?4, updated_at = CURRENT_TIMESTAMP
          WHERE user_id = ?1 AND version = ?5`,
      ).bind(current.user_id, nextVersion, data.byteLength, key, current.version);
    let changes = 0;
    try {
      changes = (await statement.run()).meta.changes ?? 0;
    } finally {
      if (changes !== 1) await bucket.delete(key).catch(() => undefined);
    }
    if (changes !== 1) throw new Error('AVATAR_VERSION_CONFLICT');
    if (current.object_key !== null) await bucket.delete(current.object_key).catch(() => undefined);
    return this.findByFirebaseUid(uid);
  }

  async removeCustomAvatar(uid: string, bucket: R2Bucket): Promise<UserProfileRecord | null> {
    const current = await this.db.prepare(
      `SELECT a.object_key FROM user_custom_avatars a
         JOIN users u ON u.id = a.user_id
        WHERE u.firebase_uid = ?1 AND u.disabled_at IS NULL AND a.active = 1`,
    ).bind(uid).first<{ object_key: string | null }>();
    await this.db.prepare(
      `UPDATE user_custom_avatars
          SET version = version + 1,
              active = 0,
              content_type = NULL,
              width = NULL,
              height = NULL,
              byte_length = NULL,
              image_data = NULL,
              object_key = NULL,
              updated_at = CURRENT_TIMESTAMP
        WHERE user_id = (
          SELECT id FROM users WHERE firebase_uid = ?1 AND disabled_at IS NULL
        ) AND active = 1`,
    ).bind(uid).run();
    if (current?.object_key != null) await bucket.delete(current.object_key).catch(() => undefined);
    return this.findByFirebaseUid(uid);
  }

  /** Avatar ativo nesta versão: BLOB antigo no D1 ou ponteiro para o R2. */
  async readCustomAvatar(userId: string, version: number): Promise<
    | { byteLength: number; contentType: 'image/webp'; data: ArrayBuffer; kind: 'blob' }
    | { byteLength: number; contentType: 'image/webp'; kind: 'object'; objectKey: string }
    | null
  > {
    const row = await this.db.prepare(
      `SELECT content_type, byte_length, image_data, object_key
         FROM user_custom_avatars
        WHERE user_id = ?1 AND version = ?2 AND active = 1`,
    ).bind(userId, version).first<{
      byte_length: number;
      content_type: 'image/webp';
      image_data: unknown;
      object_key: string | null;
    }>();
    if (row === null) return null;
    if (row.object_key !== null) {
      return { byteLength: row.byte_length, contentType: row.content_type, kind: 'object', objectKey: row.object_key };
    }
    const data = d1BlobToArrayBuffer(row.image_data, row.byte_length);
    if (data === null) return null;
    return {
      byteLength: row.byte_length,
      contentType: row.content_type,
      data,
      kind: 'blob',
    };
  }

  private async grantBootstrapAdmin(userId: string): Promise<void> {
    await this.db.prepare(
      "INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (?1, 'ADMIN')",
    ).bind(userId).run();
  }

  /** Busca por ID público/nome, paginada por (created_at, id): nunca trunca silenciosamente além da página. */
  async listForAdmin(input: { cursor?: string | null; search?: string }): Promise<AdminUserPage> {
    const search = (input.search ?? '').trim();
    const pageSize = 50;
    const decoded = input.cursor == null ? null : decodeUserCursor(input.cursor);
    const binds: unknown[] = [search, escapedLike(search)];
    let cursorClause = '';
    if (decoded !== null) {
      cursorClause = 'AND (u.created_at < ?3 OR (u.created_at = ?3 AND u.id < ?4))';
      binds.push(decoded.createdAt, decoded.id);
    }
    const result = await this.db.prepare(
      `SELECT u.id AS user_id, u.created_at, p.public_id, p.display_name,
              EXISTS(SELECT 1 FROM user_roles r WHERE r.user_id = u.id AND r.role = 'ADMIN') AS is_admin
         FROM users u
         JOIN user_profiles p ON p.user_id = u.id
        WHERE u.disabled_at IS NULL
          AND (?1 = '' OR p.public_id LIKE ?2 ESCAPE '\\' COLLATE NOCASE OR p.display_name LIKE ?2 ESCAPE '\\' COLLATE NOCASE)
          ${cursorClause}
        ORDER BY u.created_at DESC, u.id DESC
        LIMIT ${pageSize + 1}`,
    ).bind(...binds).all<{
      created_at: string; display_name: string; is_admin: number; public_id: string; user_id: string;
    }>();
    const rows = result.results.slice(0, pageSize);
    const last = rows.at(-1);
    const nextCursor = result.results.length > pageSize && last !== undefined
      ? encodeUserCursor(last.created_at, last.user_id)
      : null;
    return {
      nextCursor,
      users: rows.map((row) => ({
        createdAt: row.created_at, displayName: row.display_name, publicId: row.public_id,
        role: row.is_admin === 1 ? 'ADMIN' : 'PLAYER', userId: row.user_id,
      })),
    };
  }

  /**
   * Concede ou revoga ADMIN. A revogação nunca esvazia `user_roles` de ADMIN:
   * a checagem de que sobra pelo menos um outro ADMIN vive na própria
   * cláusula `WHERE` do `DELETE`, então corre atomicamente com a escrita —
   * duas revogações concorrentes nunca zeram a tabela juntas.
   */
  async setAdminRole(userId: string, granted: boolean, actorUserId: string): Promise<'GRANTED' | 'LAST_ADMIN' | 'REVOKED'> {
    if (granted) {
      await this.db.prepare(
        'INSERT OR IGNORE INTO user_roles (user_id, role, granted_by_user_id) VALUES (?1, \'ADMIN\', ?2)',
      ).bind(userId, actorUserId).run();
      return 'GRANTED';
    }
    const result = await this.db.prepare(
      `DELETE FROM user_roles
        WHERE user_id = ?1 AND role = 'ADMIN'
          AND (SELECT COUNT(*) FROM user_roles WHERE role = 'ADMIN') > 1`,
    ).bind(userId).run();
    if ((result.meta.changes ?? 0) === 1) return 'REVOKED';
    // Nada mudou: ou o alvo já não era ADMIN (revogação idempotente, sem erro),
    // ou ele é o único ADMIN restante — só o segundo caso é bloqueado.
    const stillAdmin = await this.db.prepare(
      "SELECT 1 FROM user_roles WHERE user_id = ?1 AND role = 'ADMIN'",
    ).bind(userId).first();
    return stillAdmin === null ? 'REVOKED' : 'LAST_ADMIN';
  }
}

function escapedLike(search: string): string {
  return `%${search.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
}

function encodeUserCursor(createdAt: string, id: string): string {
  return btoa(JSON.stringify([createdAt, id]));
}

function decodeUserCursor(cursor: string): { createdAt: string; id: string } | null {
  try {
    const [createdAt, id] = JSON.parse(atob(cursor)) as [string, string];
    return typeof createdAt === 'string' && typeof id === 'string' ? { createdAt, id } : null;
  } catch {
    return null;
  }
}
