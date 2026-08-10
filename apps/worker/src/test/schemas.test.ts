import { describe, expect, it } from 'vitest';
import { importBatchSchema, profileInputSchema } from '../http/schemas.js';

describe('schemas de entrada', () => {
  it('normaliza nome e rejeita campos extras', () => {
    expect(profileInputSchema.parse({ displayName: '  Matheus  ' })).toEqual({ displayName: 'Matheus' });
    expect(profileInputSchema.safeParse({ displayName: 'M', role: 'ADMIN' }).success).toBe(false);
  });

  it('exige quatro alternativas, uma correta e fontes', () => {
    const valid = {
      questions: [{
        correctOption: 0,
        difficulty: 'EASY',
        options: ['A', 'B', 'C', 'D'],
        prompt: 'Pergunta sintética?',
        sources: [{ kind: 'OTHER', url: 'fixture://local' }],
        themeId: 'theme-test',
      }],
    };
    expect(importBatchSchema.safeParse(valid).success).toBe(true);
    expect(importBatchSchema.safeParse({ questions: [{ ...valid.questions[0], options: ['A', 'B', 'C'] }] }).success).toBe(false);
    expect(importBatchSchema.safeParse({ questions: [{ ...valid.questions[0], sources: [] }] }).success).toBe(false);
    expect(importBatchSchema.safeParse({ questions: [{ ...valid.questions[0], correctOption: 4 }] }).success).toBe(false);
    expect(importBatchSchema.safeParse({ questions: [{ ...valid.questions[0], options: ['A', 'A', 'C', 'D'] }] }).success).toBe(false);
  });

  it('aplica limite rígido menor que 100 KB para imagem', () => {
    const base = {
      correctOption: 0,
      difficulty: 'EASY',
      options: ['A', 'B', 'C', 'D'],
      prompt: 'Pergunta sintética?',
      sources: [{ url: 'fixture://local' }],
      themeId: 'theme-test',
    };
    expect(importBatchSchema.safeParse({ questions: [{ ...base, image: { bytes: 102_399, key: 'x.webp', license: 'fixture' } }] }).success).toBe(true);
    expect(importBatchSchema.safeParse({ questions: [{ ...base, image: { bytes: 102_400, key: 'x.webp', license: 'fixture' } }] }).success).toBe(false);
  });
});
