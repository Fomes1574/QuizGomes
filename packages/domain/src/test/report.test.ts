import { describe, expect, it } from 'vitest';
import {
  assertReportNoteLength,
  canTransitionReportStatus,
  isReportReason,
  isReportStatus,
  normalizeReportNote,
  REPORT_NOTE_MAX_LENGTH,
  ReportRuleError,
} from '../reports/report.js';

describe('denúncia de pergunta — regras puras', () => {
  it('reconhece só os motivos do catálogo', () => {
    expect(isReportReason('INCORRECT')).toBe(true);
    expect(isReportReason('IMAGE')).toBe(true);
    expect(isReportReason('SPAM')).toBe(false);
  });

  it('reconhece só os status válidos', () => {
    expect(isReportStatus('OPEN')).toBe(true);
    expect(isReportStatus('CLOSED')).toBe(false);
  });

  it('normaliza nota vazia ou só espaços para ausência', () => {
    expect(normalizeReportNote(null)).toBeNull();
    expect(normalizeReportNote(undefined)).toBeNull();
    expect(normalizeReportNote('   ')).toBeNull();
    expect(normalizeReportNote('  texto  ')).toBe('texto');
  });

  it('aceita nota até o limite e recusa acima dele', () => {
    const note = 'x'.repeat(REPORT_NOTE_MAX_LENGTH);
    expect(() => assertReportNoteLength(note)).not.toThrow();
    expect(() => assertReportNoteLength(null)).not.toThrow();
    const tooLong = 'x'.repeat(REPORT_NOTE_MAX_LENGTH + 1);
    expect(() => assertReportNoteLength(tooLong)).toThrow(ReportRuleError);
  });

  it('só transiciona a partir de OPEN/IN_REVIEW, nunca de um status já terminal', () => {
    expect(canTransitionReportStatus('OPEN', 'IN_REVIEW')).toBe(true);
    expect(canTransitionReportStatus('OPEN', 'RESOLVED')).toBe(true);
    expect(canTransitionReportStatus('IN_REVIEW', 'DISMISSED')).toBe(true);
    expect(canTransitionReportStatus('RESOLVED', 'OPEN')).toBe(false);
    expect(canTransitionReportStatus('DISMISSED', 'IN_REVIEW')).toBe(false);
    expect(canTransitionReportStatus('OPEN', 'OPEN')).toBe(false);
  });
});
