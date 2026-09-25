import { describe, expect, it } from 'vitest';
import { questionExportCsvHeader, questionExportCsvRow } from '../services/question-export.js';

describe('exportação editorial de perguntas', () => {
  it('gera CSV RFC 4180, preservando fontes e campos com vírgula', () => {
    const row = questionExportCsvRow({
      activeSlot: 3,
      correctOption: 1,
      createdAt: '2026-09-25T12:00:00.000Z',
      createdByUserId: 'user-1',
      id: 'question-1',
      imageBytes: null,
      imageKey: null,
      imageLicense: null,
      options: ['A', 'B, com vírgula', 'C', 'D'],
      poolId: 'tema-1:pool',
      prompt: 'Pergunta, com vírgula?',
      replacesQuestionId: null,
      resolutionNote: null,
      resolvedAt: null,
      resolvedByUserId: null,
      sources: [{ id: 'source-1', kind: 'WEB', title: 'Fonte', url: 'https://example.test/a,b' }],
      status: 'ACTIVE',
      themeId: 'tema-1',
    });
    expect(questionExportCsvHeader()).toContain('sourcesJson');
    expect(row).toContain('"Pergunta, com vírgula?"');
    expect(row).toContain('"B, com vírgula"');
    expect(row).toContain('"[{""id"":""source-1""');
    expect(row.endsWith('\r\n')).toBe(true);
  });
});
