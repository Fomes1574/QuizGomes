/**
 * Denúncia de pergunta.
 *
 * Este módulo é puro: só descreve motivos, status e os limites de uma nota
 * curta opcional. Quem valida que o denunciante realmente recebeu aquela
 * pergunta naquele contexto — e quem aplica idempotência e rate limit — é o
 * Worker, contra o snapshot selado da rodada (`match_questions`/
 * `challenge_questions`). O domínio nunca recalcula score, XP ou Conhecimento
 * a partir de uma denúncia.
 */

export const REPORT_REASONS = [
  'INCORRECT',
  'AMBIGUOUS',
  'OUTDATED',
  'TEXT',
  'SOURCE',
  'IMAGE',
  'OTHER',
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_STATUSES = ['OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED'] as const;

export type ReportStatus = (typeof REPORT_STATUSES)[number];

/** Status que ainda ocupam a fila de moderação. */
export const OPEN_REPORT_STATUSES: readonly ReportStatus[] = ['OPEN', 'IN_REVIEW'];

export type ReportContextKind = 'CHALLENGE' | 'MATCH';

export const REPORT_NOTE_MAX_LENGTH = 280;

export function isReportReason(value: string): value is ReportReason {
  return (REPORT_REASONS as readonly string[]).includes(value);
}

export function isReportStatus(value: string): value is ReportStatus {
  return (REPORT_STATUSES as readonly string[]).includes(value);
}

/**
 * Normaliza a nota opcional: string vazia vira ausência, e o limite é
 * verificado depois de aparar espaços — o mesmo texto que o servidor grava.
 */
export function normalizeReportNote(note: string | null | undefined): string | null {
  if (note === null || note === undefined) return null;
  const trimmed = note.trim();
  return trimmed === '' ? null : trimmed;
}

export class ReportRuleError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'ReportRuleError';
  }
}

/** Lança se a nota, já normalizada, exceder o limite. Não valida o motivo. */
export function assertReportNoteLength(note: string | null): void {
  if (note !== null && note.length > REPORT_NOTE_MAX_LENGTH) {
    throw new ReportRuleError('REPORT_NOTE_TOO_LONG', `A nota aceita no máximo ${REPORT_NOTE_MAX_LENGTH} caracteres.`);
  }
}

/** Uma transição de status é válida somente a partir de OPEN/IN_REVIEW. */
export function canTransitionReportStatus(from: ReportStatus, to: ReportStatus): boolean {
  if (from === to) return false;
  if (!OPEN_REPORT_STATUSES.includes(from)) return false;
  return isReportStatus(to);
}
