export interface AuditLogEntry {
  action: string;
  actorDisplayName: string | null;
  createdAt: string;
  entityId: string | null;
  entityType: string;
  id: string;
  metadata: Record<string, unknown>;
}

export interface AuditLogPage {
  entries: AuditLogEntry[];
  nextCursor: string | null;
}

interface AuditLogRow {
  action: string;
  actor_display_name: string | null;
  created_at: string;
  entity_id: string | null;
  entity_type: string;
  id: string;
  metadata_json: string;
}

function encodeCursor(createdAt: string, id: string): string {
  return btoa(JSON.stringify([createdAt, id]));
}

function decodeCursor(cursor: string): { createdAt: string; id: string } | null {
  try {
    const [createdAt, id] = JSON.parse(atob(cursor)) as [string, string];
    return typeof createdAt === 'string' && typeof id === 'string' ? { createdAt, id } : null;
  } catch {
    return null;
  }
}

function toEntry(row: AuditLogRow): AuditLogEntry {
  let metadata: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(row.metadata_json);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) metadata = parsed as Record<string, unknown>;
  } catch {
    metadata = {};
  }
  return {
    action: row.action, actorDisplayName: row.actor_display_name, createdAt: row.created_at,
    entityId: row.entity_id, entityType: row.entity_type, id: row.id, metadata,
  };
}

/** Trilha de auditoria somente-leitura: quem gravou cada ação ADMIN, quando e sobre qual entidade. */
export class AuditLogRepository {
  constructor(private readonly db: D1Database) {}

  async list(input: { cursor?: string | null } = {}): Promise<AuditLogPage> {
    const pageSize = 50;
    const decoded = input.cursor == null ? null : decodeCursor(input.cursor);
    const binds: unknown[] = [];
    const cursorClause = decoded === null ? '' : (() => {
      binds.push(decoded.createdAt, decoded.id);
      return 'WHERE (a.created_at < ?1 OR (a.created_at = ?1 AND a.id < ?2))';
    })();
    const result = await this.db.prepare(
      `SELECT a.id, a.action, a.entity_type, a.entity_id, a.metadata_json, a.created_at, p.display_name AS actor_display_name
         FROM audit_logs a
         LEFT JOIN user_profiles p ON p.user_id = a.actor_user_id
         ${cursorClause}
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT ${pageSize + 1}`,
    ).bind(...binds).all<AuditLogRow>();
    const rows = result.results.slice(0, pageSize);
    const last = rows.at(-1);
    const nextCursor = result.results.length > pageSize && last !== undefined
      ? encodeCursor(last.created_at, last.id)
      : null;
    return { entries: rows.map(toEntry), nextCursor };
  }
}
