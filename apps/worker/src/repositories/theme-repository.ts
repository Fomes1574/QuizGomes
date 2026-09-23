import {
  isStandardThemeIconKey,
  type StandardThemeIconKey,
  type ThemeArtwork,
} from '@quiz-gomes/domain';
import { ApiError } from '../http/api-error.js';
import { customAvatarUrl } from '../storage/custom-avatar.js';
import { d1BlobToArrayBuffer } from '../storage/d1-blob.js';

/** Limite técnico contra rajadas automatizadas de propostas de tema, não um cooldown social. */
export const THEME_SUBMISSION_RATE_LIMIT = 5;
export const THEME_SUBMISSION_RATE_WINDOW_MS = 60 * 60_000;

export interface CategoryRecord {
  id: string;
  name: string;
  slug: string;
}

export interface CategoryAdminRecord extends CategoryRecord {
  revision: number;
  sortOrder: number;
  status: 'ACTIVE' | 'DISABLED';
}

export interface ThemeSummaryRecord {
  activeQuestionCount: number;
  artwork: ThemeArtwork;
  categoryId: string;
  categoryName: string;
  coverImageKey: string | null;
  description: string;
  id: string;
  name: string;
  slug: string;
}

export interface AdminThemeSummaryRecord extends ThemeSummaryRecord {
  createdByUserId: string | null;
  origin: 'OFFICIAL' | 'USER';
  rejectionNote: string | null;
  revision: number;
  status: 'ACTIVE' | 'DISABLED' | 'PENDING' | 'REJECTED';
}

export interface ThemeArtworkBlobRecord {
  byteLength: number;
  contentType: 'image/webp';
  data: ArrayBuffer;
  height: number;
  version: number;
  width: number;
}

interface CategoryRow { id: string; name: string; slug: string }
interface CategoryAdminRow extends CategoryRow { revision: number; sort_order: number; status: 'ACTIVE' | 'DISABLED' }
interface ThemeRow {
  active_question_count: number;
  artwork_icon_key: string | null;
  artwork_kind: 'CUSTOM' | 'ICON' | 'NONE';
  artwork_version: number;
  category_id: string;
  category_name: string;
  cover_image_key: string | null;
  created_by_user_id?: string | null;
  description: string;
  id: string;
  name: string;
  origin?: 'OFFICIAL' | 'USER';
  rejection_note?: string | null;
  revision?: number;
  slug: string;
  status?: 'ACTIVE' | 'DISABLED' | 'PENDING' | 'REJECTED';
}

const THEME_COLUMNS = `t.id, t.slug, t.name, t.description, t.cover_image_key,
  t.artwork_kind, t.artwork_icon_key, t.artwork_version, t.active_question_count,
  c.id AS category_id, c.name AS category_name`;

const ADMIN_THEME_COLUMNS = `${THEME_COLUMNS}, t.status, t.revision, t.origin, t.created_by_user_id, t.rejection_note`;

function artworkUrl(themeId: string, version: number): string {
  return `/api/theme-artwork/${encodeURIComponent(themeId)}/v${version}.webp`;
}

function mapArtwork(row: ThemeRow): ThemeArtwork {
  if (row.artwork_kind === 'CUSTOM' && row.artwork_version > 0) {
    return { kind: 'CUSTOM', url: artworkUrl(row.id, row.artwork_version), version: row.artwork_version };
  }
  if (row.artwork_kind === 'ICON' && row.artwork_icon_key !== null && isStandardThemeIconKey(row.artwork_icon_key)) {
    return { iconKey: row.artwork_icon_key, kind: 'ICON', version: row.artwork_version };
  }
  return { kind: 'NONE', version: row.artwork_version };
}

function mapTheme(row: ThemeRow): ThemeSummaryRecord {
  return {
    activeQuestionCount: row.active_question_count,
    artwork: mapArtwork(row),
    categoryId: row.category_id,
    categoryName: row.category_name,
    coverImageKey: row.cover_image_key,
    description: row.description,
    id: row.id,
    name: row.name,
    slug: row.slug,
  };
}

function mapAdminTheme(row: ThemeRow): AdminThemeSummaryRecord {
  if (row.status === undefined || row.revision === undefined || row.origin === undefined) {
    throw new Error('THEME_STATUS_MISSING');
  }
  return {
    ...mapTheme(row),
    createdByUserId: row.created_by_user_id ?? null,
    origin: row.origin,
    rejectionNote: row.rejection_note ?? null,
    revision: row.revision,
    status: row.status,
  };
}

function escapedLike(search: string): string {
  return `%${search.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
}

export class ThemeRepository {
  constructor(private readonly db: D1Database) {}

  async listCategories(): Promise<CategoryRecord[]> {
    const result = await this.db.prepare(
      "SELECT id, slug, name FROM categories WHERE status = 'ACTIVE' ORDER BY sort_order, name LIMIT 100",
    ).all<CategoryRow>();
    return result.results;
  }

  async listCategoriesForAdmin(): Promise<CategoryAdminRecord[]> {
    const result = await this.db.prepare(
      'SELECT id, slug, name, sort_order, status, revision FROM categories ORDER BY sort_order, name LIMIT 200',
    ).all<CategoryAdminRow>();
    return result.results.map((row) => ({
      id: row.id, name: row.name, revision: row.revision, slug: row.slug,
      sortOrder: row.sort_order, status: row.status,
    }));
  }

  async createCategory(input: { name: string; slug: string; sortOrder: number }): Promise<CategoryAdminRecord> {
    const id = crypto.randomUUID();
    try {
      await this.db.prepare(
        'INSERT INTO categories (id, slug, name, sort_order) VALUES (?1, ?2, ?3, ?4)',
      ).bind(id, input.slug, input.name, input.sortOrder).run();
    } catch (error) {
      if (error instanceof Error && /UNIQUE constraint failed: categories\.(slug|name)/i.test(error.message)) {
        throw new ApiError(409, 'CATEGORY_ALREADY_EXISTS', 'Já existe uma categoria com esse nome ou slug.');
      }
      throw error;
    }
    return { id, name: input.name, revision: 1, slug: input.slug, sortOrder: input.sortOrder, status: 'ACTIVE' };
  }

  async updateCategory(input: {
    expectedRevision: number;
    id: string;
    name: string;
    sortOrder: number;
    status: 'ACTIVE' | 'DISABLED';
  }): Promise<CategoryAdminRecord> {
    let result;
    try {
      result = await this.db.prepare(
        `UPDATE categories SET name = ?1, sort_order = ?2, status = ?3, revision = revision + 1, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?4 AND revision = ?5`,
      ).bind(input.name, input.sortOrder, input.status, input.id, input.expectedRevision).run();
    } catch (error) {
      if (error instanceof Error && /UNIQUE constraint failed: categories\.name/i.test(error.message)) {
        throw new ApiError(409, 'CATEGORY_ALREADY_EXISTS', 'Já existe uma categoria com esse nome.');
      }
      throw error;
    }
    if ((result.meta.changes ?? 0) !== 1) {
      const exists = await this.db.prepare('SELECT 1 FROM categories WHERE id = ?1').bind(input.id).first();
      if (exists === null) throw new ApiError(404, 'CATEGORY_NOT_FOUND', 'Categoria não encontrada.');
      throw new ApiError(409, 'CATEGORY_CONFLICT', 'Esta categoria mudou de estado. Atualize a tela.');
    }
    const updated = await this.db.prepare('SELECT id, slug, name, sort_order, status, revision FROM categories WHERE id = ?1')
      .bind(input.id).first<CategoryAdminRow>();
    if (updated === null) throw new ApiError(404, 'CATEGORY_NOT_FOUND', 'Categoria não encontrada.');
    return {
      id: updated.id, name: updated.name, revision: updated.revision, slug: updated.slug,
      sortOrder: updated.sort_order, status: updated.status,
    };
  }

  async listThemes(search = '', categoryId: string | null = null, limit = 60): Promise<ThemeSummaryRecord[]> {
    const query = `SELECT ${THEME_COLUMNS}
                     FROM themes t
                     JOIN categories c ON c.id = t.category_id
                    WHERE t.status = 'ACTIVE' AND c.status = 'ACTIVE'
                      AND (?1 = '' OR t.name LIKE ?2 ESCAPE '\\' COLLATE NOCASE)
                      AND (?3 IS NULL OR t.category_id = ?3)
                    ORDER BY c.sort_order, t.name
                    LIMIT ?4`;
    const result = await this.db.prepare(query)
      .bind(search, escapedLike(search), categoryId, Math.min(100, Math.max(1, limit)))
      .all<ThemeRow>();
    return result.results.map(mapTheme);
  }

  /**
   * PENDING sempre ordena antes de ACTIVE/DISABLED/REJECTED, então nenhuma
   * proposta pendente some enquanto o total de PENDING ficar abaixo do limite.
   * Sem cursor: uma fila de moderação com centenas de propostas simultâneas
   * pede paginação de verdade, não coberta aqui — ver auditoria de M12.
   */
  async listThemesForAdmin(search = '', limit = 500): Promise<AdminThemeSummaryRecord[]> {
    const result = await this.db.prepare(
      `SELECT ${ADMIN_THEME_COLUMNS}
         FROM themes t
         JOIN categories c ON c.id = t.category_id
        WHERE (?1 = '' OR t.name LIKE ?2 ESCAPE '\\' COLLATE NOCASE)
        ORDER BY CASE t.status WHEN 'PENDING' THEN 0 WHEN 'ACTIVE' THEN 1 ELSE 2 END,
                 t.updated_at DESC, t.name
        LIMIT ?3`,
    ).bind(search, escapedLike(search), Math.min(500, Math.max(1, limit))).all<ThemeRow>();
    return result.results.map(mapAdminTheme);
  }

  async findTheme(idOrSlug: string): Promise<ThemeSummaryRecord | null> {
    const row = await this.db.prepare(
      `SELECT ${THEME_COLUMNS}
         FROM themes t
         JOIN categories c ON c.id = t.category_id
        WHERE (t.id = ?1 OR t.slug = ?1) AND t.status = 'ACTIVE' AND c.status = 'ACTIVE'
        LIMIT 1`,
    ).bind(idOrSlug).first<ThemeRow>();
    return row === null ? null : mapTheme(row);
  }

  async findThemeForAdmin(id: string): Promise<AdminThemeSummaryRecord | null> {
    const row = await this.db.prepare(
      `SELECT ${ADMIN_THEME_COLUMNS}
         FROM themes t
         JOIN categories c ON c.id = t.category_id
        WHERE t.id = ?1
        LIMIT 1`,
    ).bind(id).first<ThemeRow>();
    return row === null ? null : mapAdminTheme(row);
  }

  /** Papel editorial do usuário sobre este tema, para autorizar CRUD de pergunta. */
  async themeEditAccess(themeId: string, userId: string): Promise<{
    origin: 'OFFICIAL' | 'USER';
    owned: boolean;
  } | null> {
    const theme = await this.db.prepare('SELECT origin FROM themes WHERE id = ?1')
      .bind(themeId).first<{ origin: 'OFFICIAL' | 'USER' }>();
    if (theme === null) return null;
    const ownership = await this.db.prepare(
      'SELECT 1 AS owned FROM theme_ownership WHERE theme_id = ?1 AND user_id = ?2',
    ).bind(themeId, userId).first<{ owned: number }>();
    return { origin: theme.origin, owned: ownership !== null };
  }

  async readArtwork(themeId: string, version: number): Promise<ThemeArtworkBlobRecord | null> {
    const row = await this.db.prepare(
      `SELECT b.version, b.content_type, b.width, b.height, b.byte_length, b.image_data
         FROM theme_artwork_blobs b
         JOIN themes t ON t.id = b.theme_id
        WHERE b.theme_id = ?1 AND b.version = ?2
          AND t.artwork_kind = 'CUSTOM' AND t.artwork_version = b.version
        LIMIT 1`,
    ).bind(themeId, version).first<{
      byte_length: number;
      content_type: 'image/webp';
      height: number;
      image_data: unknown;
      version: number;
      width: number;
    }>();
    if (row === null) return null;
    const data = d1BlobToArrayBuffer(row.image_data, row.byte_length);
    if (data === null) return null;
    return {
      byteLength: row.byte_length,
      contentType: row.content_type,
      data,
      height: row.height,
      version: row.version,
      width: row.width,
    };
  }

  async setArtworkChoice(input: {
    expectedVersion: number;
    iconKey?: StandardThemeIconKey;
    kind: 'ICON' | 'NONE';
    themeId: string;
  }): Promise<AdminThemeSummaryRecord> {
    const iconKey = input.kind === 'ICON' ? input.iconKey ?? null : null;
    if (input.kind === 'ICON' && (iconKey === null || !isStandardThemeIconKey(iconKey))) {
      throw new Error('INVALID_ARTWORK_ICON');
    }
    const nextVersion = input.expectedVersion + 1;
    const results = await this.db.batch([
      this.db.prepare(
        `DELETE FROM theme_artwork_blobs
          WHERE theme_id = ?1
            AND EXISTS (
              SELECT 1 FROM themes
               WHERE id = ?1 AND artwork_version = ?2
            )`,
      ).bind(input.themeId, input.expectedVersion),
      this.db.prepare(
        `UPDATE themes
            SET artwork_kind = ?1, artwork_icon_key = ?2, artwork_version = ?3,
                cover_image_key = NULL, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?4 AND artwork_version = ?5`,
      ).bind(input.kind, iconKey, nextVersion, input.themeId, input.expectedVersion),
    ]);
    await this.assertArtworkUpdated(input.themeId, results[1]?.meta.changes ?? 0);
    const theme = await this.findThemeForAdmin(input.themeId);
    if (theme === null) throw new Error('THEME_NOT_FOUND');
    return theme;
  }

  async setCustomArtwork(input: {
    data: ArrayBuffer;
    expectedVersion: number;
    height: number;
    themeId: string;
    width: number;
  }): Promise<AdminThemeSummaryRecord> {
    const nextVersion = input.expectedVersion + 1;
    const writeToken = crypto.randomUUID();
    const coverImageKey = `theme-artwork:${input.themeId}:v${nextVersion}:${writeToken}`;
    const results = await this.db.batch([
      this.db.prepare(
        `UPDATE themes
            SET artwork_kind = 'CUSTOM', artwork_icon_key = NULL, artwork_version = ?1,
                cover_image_key = ?2, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?3 AND artwork_version = ?4`,
      ).bind(nextVersion, coverImageKey, input.themeId, input.expectedVersion),
      this.db.prepare(
        `INSERT INTO theme_artwork_blobs (
           theme_id, version, content_type, width, height, byte_length, image_data, updated_at
         )
         SELECT id, artwork_version, 'image/webp', ?1, ?2, ?3, ?4, CURRENT_TIMESTAMP
           FROM themes
          WHERE id = ?5 AND artwork_kind = 'CUSTOM' AND artwork_version = ?6
            AND cover_image_key = ?7
         ON CONFLICT(theme_id) DO UPDATE SET
           version = excluded.version,
           content_type = excluded.content_type,
           width = excluded.width,
           height = excluded.height,
           byte_length = excluded.byte_length,
           image_data = excluded.image_data,
           updated_at = CURRENT_TIMESTAMP`,
      ).bind(
        input.width,
        input.height,
        input.data.byteLength,
        input.data,
        input.themeId,
        nextVersion,
        coverImageKey,
      ),
    ]);
    await this.assertArtworkUpdated(input.themeId, results[0]?.meta.changes ?? 0);
    const theme = await this.findThemeForAdmin(input.themeId);
    if (theme === null) throw new Error('THEME_NOT_FOUND');
    return theme;
  }

  async topFive(themeId: string): Promise<Array<{
    customAvatarUrl: string | null;
    displayName: string;
    frameId: string | null;
    knowledge: number;
    photoUrl: string | null;
    position: number;
    publicId: string;
  }>> {
    const result = await this.db.prepare(
      `SELECT p.user_id, p.display_name, p.public_id, p.photo_url, p.equipped_frame_id,
              CASE WHEN a.active = 1 THEN a.version ELSE NULL END AS custom_avatar_version,
              r.knowledge, RANK() OVER (ORDER BY r.knowledge DESC) AS position
         FROM theme_rankings r
         JOIN user_profiles p ON p.user_id = r.user_id
         LEFT JOIN user_custom_avatars a ON a.user_id = r.user_id
        WHERE r.theme_id = ?1
        ORDER BY r.knowledge DESC
        LIMIT 5`,
    ).bind(themeId).all<{
      custom_avatar_version: number | null;
      display_name: string;
      equipped_frame_id: string | null;
      knowledge: number;
      photo_url: string | null;
      position: number;
      public_id: string;
      user_id: string;
    }>();
    return result.results.map((row) => ({
      customAvatarUrl: customAvatarUrl(row.user_id, row.custom_avatar_version),
      displayName: row.display_name,
      frameId: row.equipped_frame_id,
      knowledge: row.knowledge,
      photoUrl: row.photo_url,
      position: row.position,
      publicId: row.public_id,
    }));
  }

  async submitTheme(input: {
    categoryId: string;
    description: string;
    name: string;
    userId: string;
  }): Promise<ThemeSummaryRecord> {
    await this.assertSubmissionRate(input.userId);
    const category = await this.db.prepare(
      "SELECT id, name FROM categories WHERE id = ?1 AND status = 'ACTIVE'",
    ).bind(input.categoryId).first<{ id: string; name: string }>();
    if (category === null) throw new Error('CATEGORY_NOT_FOUND');
    const baseSlug = input.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'tema';
    const id = crypto.randomUUID();
    const slug = `${baseSlug}-${id.slice(0, 6)}`;
    await this.db.prepare(
      `INSERT INTO themes (
         id, category_id, slug, name, description, status, origin, created_by_user_id, question_shard_id
       ) VALUES (?1, ?2, ?3, ?4, ?5, 'PENDING', 'USER', ?6, 'questions-01')`,
    ).bind(id, input.categoryId, slug, input.name, input.description, input.userId).run();
    return {
      activeQuestionCount: 0,
      artwork: { kind: 'NONE', version: 0 },
      categoryId: category.id,
      categoryName: category.name,
      coverImageKey: null,
      description: input.description,
      id,
      name: input.name,
      slug,
    };
  }

  private async assertSubmissionRate(userId: string): Promise<void> {
    // themes.created_at nasce de CURRENT_TIMESTAMP (formato "YYYY-MM-DD HH:MM:SS" do
    // próprio SQLite); comparar contra um ISO string gerado em JS ("...T...Z") compara
    // formatos diferentes e nunca bate. datetime('now', ...) usa o mesmo formato da coluna.
    const row = await this.db.prepare(
      `SELECT COUNT(*) AS total FROM themes
        WHERE created_by_user_id = ?1 AND origin = 'USER'
          AND created_at >= datetime('now', ?2)`,
    ).bind(userId, `-${Math.ceil(THEME_SUBMISSION_RATE_WINDOW_MS / 1_000)} seconds`).first<{ total: number }>();
    if ((row?.total ?? 0) >= THEME_SUBMISSION_RATE_LIMIT) {
      throw new ApiError(429, 'THEME_SUBMISSION_RATE_LIMITED', 'Muitas propostas de tema em pouco tempo. Tente de novo em instantes.');
    }
  }

  /** Aprovar um tema PENDING publica-o e concede OWNER a quem propôs. */
  async approveTheme(input: { expectedRevision: number; themeId: string }): Promise<AdminThemeSummaryRecord> {
    const theme = await this.db.prepare('SELECT status, created_by_user_id FROM themes WHERE id = ?1')
      .bind(input.themeId).first<{ created_by_user_id: string | null; status: string }>();
    if (theme === null) throw new ApiError(404, 'THEME_NOT_FOUND', 'Tema não encontrado.');
    const statements: D1PreparedStatement[] = [
      this.db.prepare(
        `UPDATE themes SET status = 'ACTIVE', revision = revision + 1, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?1 AND revision = ?2 AND status = 'PENDING'`,
      ).bind(input.themeId, input.expectedRevision),
    ];
    if (theme.created_by_user_id !== null) {
      statements.push(this.db.prepare(
        'INSERT OR IGNORE INTO theme_ownership (theme_id, user_id) VALUES (?1, ?2)',
      ).bind(input.themeId, theme.created_by_user_id));
    }
    const results = await this.db.batch(statements);
    if ((results[0]?.meta.changes ?? 0) !== 1) {
      throw new ApiError(409, 'THEME_CONFLICT', 'Este tema mudou de estado. Atualize a tela.');
    }
    const updated = await this.findThemeForAdmin(input.themeId);
    if (updated === null) throw new ApiError(404, 'THEME_NOT_FOUND', 'Tema não encontrado.');
    return updated;
  }

  async rejectTheme(input: {
    expectedRevision: number;
    note: string | null;
    themeId: string;
  }): Promise<AdminThemeSummaryRecord> {
    const result = await this.db.prepare(
      `UPDATE themes SET status = 'REJECTED', rejection_note = ?1, revision = revision + 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?2 AND revision = ?3 AND status = 'PENDING'`,
    ).bind(input.note, input.themeId, input.expectedRevision).run();
    if ((result.meta.changes ?? 0) !== 1) await this.assertThemeConflictOrMissing(input.themeId);
    const updated = await this.findThemeForAdmin(input.themeId);
    if (updated === null) throw new ApiError(404, 'THEME_NOT_FOUND', 'Tema não encontrado.');
    return updated;
  }

  /** Edita nome/descrição/categoria. A permissão (ADMIN ou OWNER do tema USER) é checada por quem chama. */
  async editTheme(input: {
    categoryId: string;
    description: string;
    expectedRevision: number;
    name: string;
    themeId: string;
  }): Promise<AdminThemeSummaryRecord> {
    const category = await this.db.prepare("SELECT id FROM categories WHERE id = ?1 AND status = 'ACTIVE'")
      .bind(input.categoryId).first<{ id: string }>();
    if (category === null) throw new ApiError(400, 'CATEGORY_NOT_FOUND', 'Categoria inválida.');
    let result;
    try {
      result = await this.db.prepare(
        `UPDATE themes SET name = ?1, description = ?2, category_id = ?3, revision = revision + 1, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?4 AND revision = ?5`,
      ).bind(input.name, input.description, input.categoryId, input.themeId, input.expectedRevision).run();
    } catch (error) {
      if (error instanceof Error && /UNIQUE constraint failed: themes\.name/i.test(error.message)) {
        throw new ApiError(409, 'THEME_ALREADY_EXISTS', 'Já existe um tema com esse nome.');
      }
      throw error;
    }
    if ((result.meta.changes ?? 0) !== 1) await this.assertThemeConflictOrMissing(input.themeId);
    const updated = await this.findThemeForAdmin(input.themeId);
    if (updated === null) throw new ApiError(404, 'THEME_NOT_FOUND', 'Tema não encontrado.');
    return updated;
  }

  async deactivateTheme(input: { expectedRevision: number; themeId: string }): Promise<AdminThemeSummaryRecord> {
    const result = await this.db.prepare(
      `UPDATE themes SET status = 'DISABLED', revision = revision + 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?1 AND revision = ?2 AND status = 'ACTIVE'`,
    ).bind(input.themeId, input.expectedRevision).run();
    if ((result.meta.changes ?? 0) !== 1) await this.assertThemeConflictOrMissing(input.themeId);
    const updated = await this.findThemeForAdmin(input.themeId);
    if (updated === null) throw new ApiError(404, 'THEME_NOT_FOUND', 'Tema não encontrado.');
    return updated;
  }

  private async assertThemeConflictOrMissing(themeId: string): Promise<never> {
    const exists = await this.db.prepare('SELECT 1 AS found FROM themes WHERE id = ?1')
      .bind(themeId).first<{ found: number }>();
    if (exists === null) throw new ApiError(404, 'THEME_NOT_FOUND', 'Tema não encontrado.');
    throw new ApiError(409, 'THEME_CONFLICT', 'Este tema mudou de estado. Atualize a tela.');
  }

  async personalRanking(themeId: string, userId: string): Promise<{
    knowledge: number;
    position: number | null;
    rankedMatches: number;
  }> {
    const row = await this.db.prepare(
      `SELECT r.knowledge, r.ranked_matches,
              1 + (SELECT COUNT(*) FROM theme_rankings higher
                    WHERE higher.theme_id = r.theme_id AND higher.knowledge > r.knowledge) AS position
         FROM theme_rankings r
        WHERE r.theme_id = ?1 AND r.user_id = ?2`,
    ).bind(themeId, userId).first<{ knowledge: number; position: number; ranked_matches: number }>();
    return row === null
      ? { knowledge: 0, position: null, rankedMatches: 0 }
      : { knowledge: row.knowledge, position: row.position, rankedMatches: row.ranked_matches };
  }

  private async assertArtworkUpdated(themeId: string, changes: number): Promise<void> {
    if (changes > 0) return;
    const exists = await this.db.prepare('SELECT 1 AS found FROM themes WHERE id = ?1')
      .bind(themeId).first<{ found: number }>();
    throw new Error(exists === null ? 'THEME_NOT_FOUND' : 'ARTWORK_VERSION_CONFLICT');
  }
}
