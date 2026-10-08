import { levelProgress, type PlayerTitle } from '@quiz-gomes/domain';
import type { Env } from '../env.js';
import { ApiError } from '../http/api-error.js';
import { SocialRepository, person, type SocialCandidate } from '../repositories/social-repository.js';
import { PLAYABLE_THEME_SQL } from '../repositories/theme-repository.js';
import { resolvePlayerTitle } from './player-title-service.js';
import { pinnedHighlights, type ShowcaseTitle } from './title-showcase-service.js';

export interface PlayerThemeStanding {
  knowledge: number;
  name: string;
  slug: string;
}

export interface PlayerProfileView {
  /** Temas que os dois jogam, lado a lado (só quando não é o próprio perfil). */
  comparison: Array<{ mine: number; name: string; slug: string; theirs: number }>;
  highlights: ShowcaseTitle[];
  player: Omit<SocialCandidate, 'relationship'> & { level: number; title: PlayerTitle | null };
  ranked: { draws: number; losses: number; matches: number; wins: number };
  relationship: SocialCandidate['relationship'] | 'SELF';
  themes: PlayerThemeStanding[];
}

const PUBLIC_ID = /^#QG[A-Z0-9]{4,32}$/;

/**
 * Perfil de outra pessoa. Só para quem entrou; bloqueio em qualquer
 * sentido, conta desativada ou ID inexistente respondem igual ("não
 * encontrado"), sem revelar qual foi o caso.
 */
export async function playerProfile(
  env: Pick<Env, 'CORE_DB' | 'TOP_TITLE_MIN_PLAYERS'>,
  viewer: { publicId: string; userId: string },
  rawPublicId: string,
): Promise<PlayerProfileView> {
  const publicId = rawPublicId.trim().toUpperCase();
  const notFound = new ApiError(404, 'PLAYER_NOT_FOUND', 'Não encontramos esse jogador.');
  if (!PUBLIC_ID.test(publicId)) throw notFound;
  const self = publicId === viewer.publicId.toUpperCase();
  let candidate: Omit<SocialCandidate, 'relationship'> & { relationship: PlayerProfileView['relationship'] };
  if (self) {
    candidate = { ...(await selfCard(env.CORE_DB, viewer.userId)), availableAt: null, relationship: 'SELF', requestId: null };
  } else {
    const found = (await new SocialRepository(env.CORE_DB).search(viewer.userId, publicId))[0];
    if (found === undefined) throw notFound;
    candidate = found;
  }
  const target = await env.CORE_DB.prepare(
    `SELECT p.user_id, p.total_xp FROM user_profiles p JOIN users u ON u.id = p.user_id AND u.disabled_at IS NULL
      WHERE p.public_id = ?1 COLLATE NOCASE`,
  ).bind(publicId).first<{ total_xp: number; user_id: string }>();
  if (target === null) throw notFound;

  const [title, highlights, themes, ranked, comparison] = await Promise.all([
    resolvePlayerTitle(env, target.user_id, null),
    pinnedHighlights(env, target.user_id),
    env.CORE_DB.prepare(
      `SELECT t.name, t.slug, r.knowledge
         FROM theme_rankings r
         JOIN themes t ON t.id = r.theme_id
         JOIN categories c ON c.id = t.category_id AND ${PLAYABLE_THEME_SQL}
        WHERE r.user_id = ?1 AND r.knowledge > 0
        ORDER BY r.knowledge DESC, t.name COLLATE NOCASE
        LIMIT 5`,
    ).bind(target.user_id).all<PlayerThemeStanding>(),
    env.CORE_DB.prepare(
      `SELECT COALESCE(SUM(ranked_matches), 0) AS matches, COALESCE(SUM(wins), 0) AS wins,
              COALESCE(SUM(losses), 0) AS losses, COALESCE(SUM(draws), 0) AS draws
         FROM theme_rankings WHERE user_id = ?1`,
    ).bind(target.user_id).first<PlayerProfileView['ranked']>(),
    self ? Promise.resolve({ results: [] }) : env.CORE_DB.prepare(
      `SELECT t.name, t.slug, mine.knowledge AS mine, theirs.knowledge AS theirs
         FROM theme_rankings theirs
         JOIN theme_rankings mine ON mine.theme_id = theirs.theme_id AND mine.user_id = ?2
         JOIN themes t ON t.id = theirs.theme_id
         JOIN categories c ON c.id = t.category_id AND ${PLAYABLE_THEME_SQL}
        WHERE theirs.user_id = ?1 AND (theirs.knowledge > 0 OR mine.knowledge > 0)
        ORDER BY MAX(theirs.knowledge, mine.knowledge) DESC, t.name COLLATE NOCASE
        LIMIT 8`,
    ).bind(target.user_id, viewer.userId).all<PlayerProfileView['comparison'][number]>(),
  ]);
  const { relationship, ...card } = candidate;
  return {
    comparison: comparison.results,
    highlights,
    player: { ...card, level: levelProgress(target.total_xp).level, title },
    ranked: ranked ?? { draws: 0, losses: 0, matches: 0, wins: 0 },
    relationship,
    themes: themes.results,
  };
}

async function selfCard(db: D1Database, userId: string): Promise<Omit<SocialCandidate, 'availableAt' | 'relationship' | 'requestId'>> {
  const row = await db.prepare(
    `SELECT p.public_id, p.display_name, p.photo_url, p.equipped_frame_id, p.user_id,
            CASE WHEN a.active = 1 THEN a.version ELSE NULL END AS custom_avatar_version
       FROM user_profiles p LEFT JOIN user_custom_avatars a ON a.user_id = p.user_id
      WHERE p.user_id = ?1`,
  ).bind(userId).first<{
    custom_avatar_version: number | null; display_name: string; equipped_frame_id: string | null;
    photo_url: string | null; public_id: string; user_id: string;
  }>();
  if (row === null) throw new ApiError(404, 'PLAYER_NOT_FOUND', 'Não encontramos esse jogador.');
  return person(row);
}
