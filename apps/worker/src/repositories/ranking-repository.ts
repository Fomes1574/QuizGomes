import { PUBLIC_PERSON_COLUMNS, person, type PersonRow, type SocialUser } from './social-repository.js';

/** Quantas linhas o ranking completo mostra. */
export const LEADERBOARD_SIZE = 100;
/** Folga para esconder quem a pessoa bloqueou sem encurtar a lista. */
const BLOCK_SLACK = 40;
/** Acima disso a posição vira "10.000+" em vez de contar a fila inteira. */
const POSITION_COUNT_CAP = 10_000;

export interface RankingEntry extends SocialUser {
  knowledge: number;
  /** Posição real no tema (empate divide a posição). */
  position: number;
  self: boolean;
}

export interface RankingAround {
  /** Até dois acima e dois abaixo, com a própria pessoa no meio. */
  entries: RankingEntry[];
  /** true quando a posição passou do limite de contagem. */
  positionCapped: boolean;
}

type RankingRow = PersonRow & { knowledge: number; position?: number };

const ELIGIBLE = `
  JOIN users u ON u.id = r.user_id AND u.disabled_at IS NULL
  JOIN user_profiles p ON p.user_id = r.user_id
  LEFT JOIN user_custom_avatars a ON a.user_id = r.user_id`;

function entry(row: RankingRow, position: number, viewerUserId: string | null): RankingEntry {
  return { ...person(row), knowledge: row.knowledge, position, self: row.user_id === viewerUserId };
}

/**
 * Ranking por tema. Só entra quem tem Conhecimento acima de zero e conta
 * ativa. Bloqueios valem nos dois sentidos para quem está olhando: a pessoa
 * some da lista, mas a numeração continua a real (pode pular um número).
 * Toda leitura é limitada; nada varre o tema inteiro.
 */
export class RankingRepository {
  constructor(private readonly db: D1Database) {}

  async leaderboard(themeId: string, viewerUserId: string | null, size = LEADERBOARD_SIZE): Promise<RankingEntry[]> {
    // As primeiras linhas pela ordem do índice já trazem a posição certa:
    // ninguém fora delas tem mais Conhecimento.
    const rows = await this.db.prepare(
      `SELECT *, RANK() OVER (ORDER BY knowledge DESC) AS position FROM (
         SELECT ${PUBLIC_PERSON_COLUMNS}, r.knowledge
           FROM theme_rankings r ${ELIGIBLE}
          WHERE r.theme_id = ?1 AND r.knowledge > 0
          ORDER BY r.knowledge DESC, r.user_id
          LIMIT ?2)
        ORDER BY knowledge DESC, user_id`,
    ).bind(themeId, size + (viewerUserId === null ? 0 : BLOCK_SLACK)).all<RankingRow & { position: number }>();
    const hidden = viewerUserId === null ? new Set<string>() : await this.blockedWith(viewerUserId, rows.results.map((row) => row.user_id));
    return rows.results
      .filter((row) => !hidden.has(row.user_id))
      .slice(0, size)
      .map((row) => entry(row, row.position, viewerUserId));
  }

  /** A própria posição com os vizinhos, para quem está fora do Top 100. */
  async around(themeId: string, userId: string): Promise<RankingAround | null> {
    const me = await this.db.prepare(
      `SELECT ${PUBLIC_PERSON_COLUMNS}, r.knowledge
         FROM theme_rankings r ${ELIGIBLE}
        WHERE r.theme_id = ?1 AND r.user_id = ?2 AND r.knowledge > 0`,
    ).bind(themeId, userId).first<RankingRow>();
    if (me === null) return null;
    const [above, below] = await this.db.batch<RankingRow>([
      this.db.prepare(
        `SELECT ${PUBLIC_PERSON_COLUMNS}, r.knowledge
           FROM theme_rankings r ${ELIGIBLE}
          WHERE r.theme_id = ?1 AND r.user_id <> ?2
            AND (r.knowledge > ?3 OR (r.knowledge = ?3 AND r.user_id < ?2))
          ORDER BY r.knowledge ASC, r.user_id DESC
          LIMIT 4`,
      ).bind(themeId, userId, me.knowledge),
      this.db.prepare(
        `SELECT ${PUBLIC_PERSON_COLUMNS}, r.knowledge
           FROM theme_rankings r ${ELIGIBLE}
          WHERE r.theme_id = ?1 AND r.user_id <> ?2 AND r.knowledge > 0
            AND (r.knowledge < ?3 OR (r.knowledge = ?3 AND r.user_id > ?2))
          ORDER BY r.knowledge DESC, r.user_id ASC
          LIMIT 4`,
      ).bind(themeId, userId, me.knowledge),
    ]);
    const neighbours = [...(above?.results ?? []), ...(below?.results ?? [])];
    const hidden = await this.blockedWith(userId, neighbours.map((row) => row.user_id));
    const visibleAbove = (above?.results ?? []).filter((row) => !hidden.has(row.user_id)).slice(0, 2).reverse();
    const visibleBelow = (below?.results ?? []).filter((row) => !hidden.has(row.user_id)).slice(0, 2);
    const people = [...visibleAbove, me, ...visibleBelow];
    const distinct = [...new Set(people.map((row) => row.knowledge))];
    const counts = await this.db.batch<{ total: number }>(distinct.map((knowledge) => this.db.prepare(
      `SELECT COUNT(*) AS total FROM (
         SELECT 1 FROM theme_rankings r JOIN users u ON u.id = r.user_id AND u.disabled_at IS NULL
          WHERE r.theme_id = ?1 AND r.knowledge > ?2
          LIMIT ?3)`,
    ).bind(themeId, knowledge, POSITION_COUNT_CAP)));
    const positionOf = new Map(distinct.map((knowledge, index) => [knowledge, 1 + (counts[index]?.results[0]?.total ?? 0)]));
    const myAbove = positionOf.get(me.knowledge) ?? 1;
    return {
      entries: people.map((row) => entry(row, positionOf.get(row.knowledge) ?? myAbove, userId)),
      positionCapped: myAbove > POSITION_COUNT_CAP,
    };
  }

  /** Amigos (até 200) e a própria pessoa no ranking do tema. */
  async friends(themeId: string, userId: string): Promise<RankingEntry[]> {
    const rows = await this.db.prepare(
      `SELECT ${PUBLIC_PERSON_COLUMNS}, r.knowledge
         FROM theme_rankings r ${ELIGIBLE}
        WHERE r.theme_id = ?1 AND r.knowledge > 0
          AND (r.user_id = ?2 OR EXISTS (
            SELECT 1 FROM friendships f
             WHERE f.user_low_id = MIN(?2, r.user_id) AND f.user_high_id = MAX(?2, r.user_id)))
        ORDER BY r.knowledge DESC, r.user_id
        LIMIT 201`,
    ).bind(themeId, userId).all<RankingRow>();
    let position = 0;
    let previous: number | null = null;
    return rows.results.map((row, index) => {
      if (row.knowledge !== previous) position = index + 1;
      previous = row.knowledge;
      return entry(row, position, userId);
    });
  }

  private async blockedWith(viewerUserId: string, userIds: readonly string[]): Promise<Set<string>> {
    if (userIds.every((id) => id === viewerUserId)) return new Set();
    // Os bloqueios da própria pessoa, nos dois sentidos (D1 limita parâmetros por consulta).
    const rows = await this.db.prepare(
      `SELECT blocked_user_id AS other FROM user_blocks WHERE blocker_user_id = ?1
       UNION
       SELECT blocker_user_id AS other FROM user_blocks WHERE blocked_user_id = ?1
       LIMIT 5000`,
    ).bind(viewerUserId).all<{ other: string }>();
    const wanted = new Set(userIds);
    return new Set(rows.results.map((row) => row.other).filter((id) => wanted.has(id)));
  }
}
