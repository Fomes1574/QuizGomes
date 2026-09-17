import {
  assertReportNoteLength,
  canTransitionReportStatus,
  normalizeReportNote,
  type ReportContextKind,
  type ReportReason,
  type ReportStatus,
} from '@quiz-gomes/domain';
import { ApiError } from '../http/api-error.js';

/** Teto técnico de denúncias por usuário numa janela curta: anti-abuso, não punição social. */
export const REPORT_RATE_LIMIT = 20;
export const REPORT_RATE_WINDOW_MS = 10 * 60_000;

export interface ReportRecord {
  contextId: string;
  contextKind: ReportContextKind;
  createdAt: string;
  id: string;
  note: string | null;
  questionId: string;
  reason: ReportReason;
  reporterUserId: string;
  resolutionNote: string | null;
  resolvedAt: string | null;
  resolvedByUserId: string | null;
  roundNumber: number;
  status: ReportStatus;
}

interface ReportRow {
  context_id: string;
  context_kind: ReportContextKind;
  created_at: string;
  id: string;
  note: string | null;
  question_id: string;
  reason: ReportReason;
  reporter_user_id: string;
  resolution_note: string | null;
  resolved_at: string | null;
  resolved_by_user_id: string | null;
  round_number: number;
  status: ReportStatus;
}

function toRecord(row: ReportRow): ReportRecord {
  return {
    contextId: row.context_id,
    contextKind: row.context_kind,
    createdAt: row.created_at,
    id: row.id,
    note: row.note,
    questionId: row.question_id,
    reason: row.reason,
    reporterUserId: row.reporter_user_id,
    resolutionNote: row.resolution_note,
    resolvedAt: row.resolved_at,
    resolvedByUserId: row.resolved_by_user_id,
    roundNumber: row.round_number,
    status: row.status,
  };
}

const SELECT_COLUMNS = `
  id, reporter_user_id, question_id, context_kind, context_id, round_number,
  reason, note, status, resolution_note, resolved_by_user_id, resolved_at, created_at
`;

export interface CreateReportInput {
  contextId: string;
  contextKind: ReportContextKind;
  note: string | null;
  questionId: string;
  reason: ReportReason;
  reporterUserId: string;
  roundNumber: number;
}

export interface ReportListPage {
  nextCursor: string | null;
  reports: ReportRecord[];
}

export interface QuestionSnapshot {
  correctOption: number;
  imageUrl: string | null;
  options: readonly [string, string, string, string];
  prompt: string;
}

function parseSnapshot(json: string): { imageUrl: string | null; options: readonly [string, string, string, string]; prompt: string } {
  const parsed = JSON.parse(json) as { imageUrl?: string | null; options: string[]; prompt: string };
  const options = parsed.options;
  return {
    imageUrl: parsed.imageUrl ?? null,
    options: [options[0] ?? '', options[1] ?? '', options[2] ?? '', options[3] ?? ''],
    prompt: parsed.prompt,
  };
}

/**
 * Denúncias de pergunta.
 *
 * Nunca confia no `questionId`/`roundNumber` enviado pelo cliente: a criação só
 * aceita a denúncia se o recibo autoritativo de entrega da rodada provar que o
 * denunciante realmente recebeu aquela pergunta naquele contexto. Os conjuntos
 * selados de match/challenge sozinhos não bastam: eles contêm também rodadas
 * futuras que ainda não foram projetadas para o cliente.
 */
export class ReportRepository {
  constructor(
    private readonly db: D1Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async existingOpen(input: Pick<CreateReportInput,
    'contextId' | 'contextKind' | 'reporterUserId' | 'roundNumber'>,
  ): Promise<ReportRecord | null> {
    const existing = await this.db.prepare(
      `SELECT ${SELECT_COLUMNS} FROM question_reports
        WHERE reporter_user_id = ?1 AND context_kind = ?2 AND context_id = ?3 AND round_number = ?4
          AND status IN ('OPEN', 'IN_REVIEW')
        LIMIT 1`,
    ).bind(input.reporterUserId, input.contextKind, input.contextId, input.roundNumber).first<ReportRow>();
    return existing === null ? null : toRecord(existing);
  }

  /**
   * Prova que a projeção pública desta rodada foi entregue ao usuário. Uma
   * combinação que não bate — contexto errado, rodada futura, pergunta errada
   * ou usuário fora do contexto — nunca revela qual parte falhou.
   */
  private async assertSeen(input: {
    contextId: string;
    contextKind: ReportContextKind;
    questionId: string;
    reporterUserId: string;
    roundNumber: number;
  }): Promise<void> {
    const proof = await this.db.prepare(
      `SELECT 1 FROM question_report_views
        WHERE context_kind = ?1 AND context_id = ?2 AND user_id = ?3
          AND round_number = ?4 AND question_id = ?5
        LIMIT 1`,
    ).bind(
      input.contextKind,
      input.contextId,
      input.reporterUserId,
      input.roundNumber,
      input.questionId,
    ).first();
    if (proof === null) {
      throw new ApiError(403, 'REPORT_CONTEXT_MISMATCH', 'Não foi possível confirmar que você viu esta pergunta.');
    }
  }

  /**
   * Cria a denúncia ou reconhece a que já está OPEN/IN_REVIEW para o mesmo
   * usuário, contexto e rodada como o mesmo pedido — idempotência real, não
   * um segundo registro escondido.
   */
  async create(input: CreateReportInput): Promise<{ created: boolean; report: ReportRecord }> {
    const note = normalizeReportNote(input.note);
    assertReportNoteLength(note);
    await this.assertSeen(input);
    // Retry idempotente sempre vence o rate limit: um duplo toque não pode virar
    // 429 só porque o usuário atingiu o teto depois do primeiro envio.
    const known = await this.existingOpen(input);
    if (known !== null) return { created: false, report: known };
    const id = crypto.randomUUID();
    const since = new Date(this.now().getTime() - REPORT_RATE_WINDOW_MS).toISOString();
    try {
      const inserted = await this.db.prepare(
        `INSERT INTO question_reports
          (id, reporter_user_id, question_id, context_kind, context_id, round_number, reason, note, created_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9
          WHERE (SELECT COUNT(*) FROM question_reports
                  WHERE reporter_user_id = ?2 AND created_at >= ?10) < ?11`,
      ).bind(
        id, input.reporterUserId, input.questionId, input.contextKind,
        input.contextId, input.roundNumber, input.reason, note, this.now().toISOString(), since, REPORT_RATE_LIMIT,
      ).run();
      if ((inserted.meta.changes ?? 0) === 0) {
        const raced = await this.existingOpen(input);
        if (raced !== null) return { created: false, report: raced };
        throw new ApiError(429, 'REPORT_RATE_LIMITED', 'Muitas denúncias em pouco tempo. Tente de novo em instantes.');
      }
    } catch (error) {
      if (error instanceof Error && /UNIQUE constraint failed/i.test(error.message)) {
        const raced = await this.existingOpen(input);
        if (raced !== null) return { created: false, report: raced };
      }
      throw error;
    }
    const created = await this.db.prepare(`SELECT ${SELECT_COLUMNS} FROM question_reports WHERE id = ?1`)
      .bind(id).first<ReportRow>();
    if (created === null) throw new Error('Denúncia não persistida.');
    return { created: true, report: toRecord(created) };
  }

  async byId(id: string): Promise<ReportRecord | null> {
    const row = await this.db.prepare(`SELECT ${SELECT_COLUMNS} FROM question_reports WHERE id = ?1`)
      .bind(id).first<ReportRow>();
    return row === null ? null : toRecord(row);
  }

  /**
   * O mesmo snapshot selado que provou a denúncia serve para o admin revisar a
   * pergunta — sem depender do shard QUESTIONS_DB, que pode ter girado o slot.
   */
  async questionSnapshot(report: ReportRecord): Promise<QuestionSnapshot | null> {
    if (report.contextKind === 'MATCH') {
      const row = await this.db.prepare(
        `SELECT public_snapshot_json, correct_option_sealed
           FROM match_questions WHERE match_id = ?1 AND round_number = ?2`,
      ).bind(report.contextId, report.roundNumber).first<{ correct_option_sealed: string; public_snapshot_json: string }>();
      if (row === null) return null;
      return { ...parseSnapshot(row.public_snapshot_json), correctOption: Number(row.correct_option_sealed) };
    }
    const row = await this.db.prepare(
      `SELECT public_snapshot_json, correct_option
         FROM challenge_questions WHERE challenge_id = ?1 AND round_number = ?2`,
    ).bind(report.contextId, report.roundNumber).first<{ correct_option: number; public_snapshot_json: string }>();
    if (row === null) return null;
    return { ...parseSnapshot(row.public_snapshot_json), correctOption: row.correct_option };
  }

  /** Fila de moderação por status, mais recentes primeiro, paginada por cursor opaco. */
  async listForAdmin(status: ReportStatus, limit: number, cursor: string | null): Promise<ReportListPage> {
    const decoded = cursor === null ? null : decodeCursor(cursor);
    const rows = decoded === null
      ? await this.db.prepare(
        `SELECT ${SELECT_COLUMNS} FROM question_reports
          WHERE status = ?1
          ORDER BY created_at DESC, id DESC
          LIMIT ?2`,
      ).bind(status, limit + 1).all<ReportRow>()
      : await this.db.prepare(
        `SELECT ${SELECT_COLUMNS} FROM question_reports
          WHERE status = ?1 AND (created_at < ?2 OR (created_at = ?2 AND id < ?3))
          ORDER BY created_at DESC, id DESC
          LIMIT ?4`,
      ).bind(status, decoded.createdAt, decoded.id, limit + 1).all<ReportRow>();
    const page = rows.results.slice(0, limit).map(toRecord);
    const last = page.at(-1);
    const nextCursor = rows.results.length > limit && last !== undefined
      ? encodeCursor(last.createdAt, last.id)
      : null;
    return { nextCursor, reports: page };
  }

  /**
   * Move a denúncia para um novo status com CAS otimista sobre o status lido:
   * uma segunda tentativa concorrente (dois admins, duas abas) recusa sem
   * reaplicar, em vez de sobrescrever silenciosamente.
   */
  async resolve(input: {
    fromStatus: ReportStatus;
    id: string;
    resolutionNote: string | null;
    resolvedByUserId: string;
    toStatus: ReportStatus;
  }): Promise<boolean> {
    if (!canTransitionReportStatus(input.fromStatus, input.toStatus)) {
      throw new ApiError(409, 'REPORT_NOT_OPEN', 'Esta denúncia já foi resolvida.');
    }
    const note = normalizeReportNote(input.resolutionNote);
    assertReportNoteLength(note);
    const terminal = input.toStatus === 'RESOLVED' || input.toStatus === 'DISMISSED';
    const result = await this.db.prepare(
      `UPDATE question_reports
          SET status = ?1, resolution_note = ?2,
              resolved_by_user_id = CASE WHEN ?5 THEN ?3 ELSE resolved_by_user_id END,
              resolved_at = CASE WHEN ?5 THEN CURRENT_TIMESTAMP ELSE resolved_at END
        WHERE id = ?4 AND status = ?6`,
    ).bind(input.toStatus, note, input.resolvedByUserId, input.id, terminal ? 1 : 0, input.fromStatus).run();
    return (result.meta.changes ?? 0) > 0;
  }
}

function encodeCursor(createdAt: string, id: string): string {
  return btoa(JSON.stringify([createdAt, id]));
}

function decodeCursor(cursor: string): { createdAt: string; id: string } | null {
  try {
    const [createdAt, id] = JSON.parse(atob(cursor)) as [string, string];
    if (typeof createdAt !== 'string' || typeof id !== 'string') return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}
