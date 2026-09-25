import { ApiError } from '../http/api-error.js';

export interface ThemeSuggestion {
  createdAt: string;
  description: string | null;
  id: string;
  name: string;
  status: 'CLOSED' | 'OPEN';
  voted: boolean;
  voteCount: number;
}

interface SuggestionRow {
  created_at: string;
  description: string | null;
  id: string;
  name: string;
  status: 'CLOSED' | 'OPEN';
  vote_count: number;
  voted: number;
}

const PUBLIC_LIMIT = 20;
const ADMIN_LIMIT = 100;

function map(row: SuggestionRow): ThemeSuggestion {
  return {
    createdAt: row.created_at,
    description: row.description,
    id: row.id,
    name: row.name,
    status: row.status,
    voted: row.voted === 1,
    voteCount: row.vote_count,
  };
}

/**
 * "Qual tema você quer ver?": o ADMIN cadastra candidatos e os jogadores só
 * votam (um voto por candidato). Não cria tema, não mexe em catálogo.
 * `vote_count` é recalculado a partir dos votos no mesmo lote, então votar
 * duas vezes ou desfazer duas vezes nunca desvia a contagem.
 */
export class ThemeSuggestionRepository {
  constructor(private readonly db: D1Database) {}

  async listOpen(viewerUserId: string | null): Promise<ThemeSuggestion[]> {
    const rows = await this.db.prepare(
      `SELECT s.id, s.name, s.description, s.status, s.vote_count, s.created_at,
              EXISTS (SELECT 1 FROM theme_suggestion_votes v WHERE v.suggestion_id = s.id AND v.user_id = ?1) AS voted
         FROM theme_suggestions s
        WHERE s.status = 'OPEN'
        ORDER BY s.vote_count DESC, s.created_at ASC
        LIMIT ${PUBLIC_LIMIT}`,
    ).bind(viewerUserId).all<SuggestionRow>();
    return rows.results.map(map);
  }

  async listForAdmin(): Promise<ThemeSuggestion[]> {
    const rows = await this.db.prepare(
      `SELECT id, name, description, status, vote_count, created_at, 0 AS voted
         FROM theme_suggestions
        ORDER BY status = 'OPEN' DESC, vote_count DESC, created_at DESC
        LIMIT ${ADMIN_LIMIT}`,
    ).all<SuggestionRow>();
    return rows.results.map(map);
  }

  async create(input: { actorUserId: string; description: string | null; name: string }): Promise<ThemeSuggestion> {
    const id = crypto.randomUUID();
    await this.db.prepare(
      'INSERT INTO theme_suggestions (id, name, description, created_by_user_id) VALUES (?1, ?2, ?3, ?4)',
    ).bind(id, input.name, input.description, input.actorUserId).run();
    const row = await this.db.prepare(
      'SELECT id, name, description, status, vote_count, created_at, 0 AS voted FROM theme_suggestions WHERE id = ?1',
    ).bind(id).first<SuggestionRow>();
    if (row === null) throw new ApiError(500, 'SUGGESTION_NOT_CREATED', 'Não foi possível criar o candidato.');
    return map(row);
  }

  async setStatus(id: string, status: 'CLOSED' | 'OPEN'): Promise<void> {
    const result = await this.db.prepare('UPDATE theme_suggestions SET status = ?1 WHERE id = ?2').bind(status, id).run();
    if ((result.meta.changes ?? 0) !== 1) throw new ApiError(404, 'SUGGESTION_NOT_FOUND', 'Candidato não encontrado.');
  }

  /** Vota (ou desfaz) num candidato aberto. Idempotente. */
  async vote(suggestionId: string, userId: string, voted: boolean): Promise<ThemeSuggestion> {
    const results = await this.db.batch([
      voted
        ? this.db.prepare(
          `INSERT OR IGNORE INTO theme_suggestion_votes (suggestion_id, user_id)
           SELECT ?1, ?2 WHERE EXISTS (SELECT 1 FROM theme_suggestions WHERE id = ?1 AND status = 'OPEN')`,
        ).bind(suggestionId, userId)
        : this.db.prepare(
          `DELETE FROM theme_suggestion_votes WHERE suggestion_id = ?1 AND user_id = ?2
             AND EXISTS (SELECT 1 FROM theme_suggestions WHERE id = ?1 AND status = 'OPEN')`,
        ).bind(suggestionId, userId),
      this.db.prepare(
        `UPDATE theme_suggestions
            SET vote_count = (SELECT COUNT(*) FROM theme_suggestion_votes WHERE suggestion_id = ?1)
          WHERE id = ?1 AND status = 'OPEN'`,
      ).bind(suggestionId),
      this.db.prepare(
        `SELECT s.id, s.name, s.description, s.status, s.vote_count, s.created_at,
                EXISTS (SELECT 1 FROM theme_suggestion_votes v WHERE v.suggestion_id = s.id AND v.user_id = ?2) AS voted
           FROM theme_suggestions s WHERE s.id = ?1`,
      ).bind(suggestionId, userId),
    ]);
    const row = (results[2]?.results as SuggestionRow[] | undefined)?.[0];
    if (row === undefined) throw new ApiError(404, 'SUGGESTION_NOT_FOUND', 'Candidato não encontrado.');
    if (row.status !== 'OPEN') throw new ApiError(409, 'SUGGESTION_CLOSED', 'A votação deste tema já foi encerrada.');
    return map(row);
  }
}
