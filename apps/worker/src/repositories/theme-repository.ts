import {
  isStandardThemeIconKey,
  type StandardThemeIconKey,
  type ThemeArtwork,
} from '@quiz-gomes/domain';

export interface CategoryRecord {
  id: string;
  name: string;
  slug: string;
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
interface ThemeRow {
  active_question_count: number;
  artwork_icon_key: string | null;
  artwork_kind: 'CUSTOM' | 'ICON' | 'NONE';
  artwork_version: number;
  category_id: string;
  category_name: string;
  cover_image_key: string | null;
  description: string;
  id: string;
  name: string;
  slug: string;
  status?: 'ACTIVE' | 'DISABLED' | 'PENDING' | 'REJECTED';
}

const THEME_COLUMNS = `t.id, t.slug, t.name, t.description, t.cover_image_key,
  t.artwork_kind, t.artwork_icon_key, t.artwork_version, t.active_question_count,
  c.id AS category_id, c.name AS category_name`;

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
  if (row.status === undefined) throw new Error('THEME_STATUS_MISSING');
  return { ...mapTheme(row), status: row.status };
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

  async listThemesForAdmin(search = '', limit = 100): Promise<AdminThemeSummaryRecord[]> {
    const result = await this.db.prepare(
      `SELECT ${THEME_COLUMNS}, t.status
         FROM themes t
         JOIN categories c ON c.id = t.category_id
        WHERE (?1 = '' OR t.name LIKE ?2 ESCAPE '\\' COLLATE NOCASE)
        ORDER BY CASE t.status WHEN 'PENDING' THEN 0 WHEN 'ACTIVE' THEN 1 ELSE 2 END,
                 t.updated_at DESC, t.name
        LIMIT ?3`,
    ).bind(search, escapedLike(search), Math.min(200, Math.max(1, limit))).all<ThemeRow>();
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
      `SELECT ${THEME_COLUMNS}, t.status
         FROM themes t
         JOIN categories c ON c.id = t.category_id
        WHERE t.id = ?1
        LIMIT 1`,
    ).bind(id).first<ThemeRow>();
    return row === null ? null : mapAdminTheme(row);
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
      image_data: ArrayBuffer;
      version: number;
      width: number;
    }>();
    return row === null ? null : {
      byteLength: row.byte_length,
      contentType: row.content_type,
      data: row.image_data,
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
    displayName: string;
    frameId: string | null;
    knowledge: number;
    photoUrl: string | null;
    position: number;
    publicId: string;
  }>> {
    const result = await this.db.prepare(
      `SELECT p.display_name, p.public_id, p.photo_url, p.equipped_frame_id,
              r.knowledge, RANK() OVER (ORDER BY r.knowledge DESC) AS position
         FROM theme_rankings r
         JOIN user_profiles p ON p.user_id = r.user_id
        WHERE r.theme_id = ?1
        ORDER BY r.knowledge DESC
        LIMIT 5`,
    ).bind(themeId).all<{
      display_name: string;
      equipped_frame_id: string | null;
      knowledge: number;
      photo_url: string | null;
      position: number;
      public_id: string;
    }>();
    return result.results.map((row) => ({
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
