export interface CategoryRecord {
  id: string;
  name: string;
  slug: string;
}

export interface ThemeSummaryRecord {
  activeQuestionCount: number;
  categoryId: string;
  categoryName: string;
  coverImageKey: string | null;
  description: string;
  id: string;
  name: string;
  slug: string;
}

interface CategoryRow { id: string; name: string; slug: string }
interface ThemeRow {
  active_question_count: number;
  category_id: string;
  category_name: string;
  cover_image_key: string | null;
  description: string;
  id: string;
  name: string;
  slug: string;
}

function mapTheme(row: ThemeRow): ThemeSummaryRecord {
  return {
    activeQuestionCount: row.active_question_count,
    categoryId: row.category_id,
    categoryName: row.category_name,
    coverImageKey: row.cover_image_key,
    description: row.description,
    id: row.id,
    name: row.name,
    slug: row.slug,
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

  async listThemes(search = '', categoryId: string | null = null, limit = 60): Promise<ThemeSummaryRecord[]> {
    const query = `SELECT t.id, t.slug, t.name, t.description, t.cover_image_key, t.active_question_count,
                          c.id AS category_id, c.name AS category_name
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

  async findTheme(idOrSlug: string): Promise<ThemeSummaryRecord | null> {
    const row = await this.db.prepare(
      `SELECT t.id, t.slug, t.name, t.description, t.cover_image_key, t.active_question_count,
              c.id AS category_id, c.name AS category_name
         FROM themes t
         JOIN categories c ON c.id = t.category_id
        WHERE (t.id = ?1 OR t.slug = ?1) AND t.status = 'ACTIVE' AND c.status = 'ACTIVE'
        LIMIT 1`,
    ).bind(idOrSlug).first<ThemeRow>();
    return row === null ? null : mapTheme(row);
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
}
