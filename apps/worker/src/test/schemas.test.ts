import { describe, expect, it } from 'vitest';
import { importBatchSchema, profileInputSchema, themeArtworkChoiceSchema } from '../http/schemas.js';

describe('schemas de entrada', () => {
  it('normaliza nome e rejeita campos extras', () => {
    expect(profileInputSchema.parse({ displayName: '  Matheus  ' })).toEqual({ displayName: 'Matheus' });
    expect(profileInputSchema.safeParse({ displayName: 'M', role: 'ADMIN' }).success).toBe(false);
  });

  it('exige quatro alternativas e uma correta; fontes são opcionais', () => {
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
    expect(importBatchSchema.safeParse({ questions: [{ ...valid.questions[0], sources: [] }] }).success).toBe(true);
    expect(importBatchSchema.safeParse({ questions: [{ ...valid.questions[0], sources: undefined }] }).success).toBe(true);
    expect(importBatchSchema.safeParse({ questions: [{ ...valid.questions[0], correctOption: 4 }] }).success).toBe(false);
    expect(importBatchSchema.safeParse({ questions: [{ ...valid.questions[0], options: ['A', 'A', 'C', 'D'] }] }).success).toBe(false);
  });

  it('recusa image_key enquanto não existe backend de imagens de pergunta servível', () => {
    const base = {
      correctOption: 0,
      difficulty: 'EASY',
      options: ['A', 'B', 'C', 'D'],
      prompt: 'Pergunta sintética?',
      sources: [{ url: 'fixture://local' }],
      themeId: 'theme-test',
    };
    expect(importBatchSchema.safeParse({ questions: [{ ...base, image: { bytes: 10, key: 'x.webp', license: 'fixture' } }] }).success).toBe(false);
  });

  it('aceita somente as escolhas exclusivas e ícones internos da arte do tema', () => {
    expect(themeArtworkChoiceSchema.parse({ expectedVersion: 2, iconKey: 'games', kind: 'ICON' }))
      .toEqual({ expectedVersion: 2, iconKey: 'games', kind: 'ICON' });
    expect(themeArtworkChoiceSchema.parse({ expectedVersion: 0, kind: 'NONE' }))
      .toEqual({ expectedVersion: 0, kind: 'NONE' });
    expect(themeArtworkChoiceSchema.safeParse({ expectedVersion: 2, iconKey: 'emoji', kind: 'ICON' }).success).toBe(false);
    expect(themeArtworkChoiceSchema.safeParse({ expectedVersion: 2, iconKey: 'games', kind: 'NONE' }).success).toBe(false);
    expect(themeArtworkChoiceSchema.safeParse({ expectedVersion: -1, kind: 'NONE' }).success).toBe(false);
  });
});

describe('nome de exibição', () => {
  it('normaliza espaços e recusa nomes invisíveis, de controle ou sem letra/número', () => {
    expect(profileInputSchema.parse({ displayName: '  Ana   Luiza  ' })).toEqual({ displayName: 'Ana Luiza' });
    expect(profileInputSchema.parse({ displayName: 'Zé 🔥' })).toEqual({ displayName: 'Zé 🔥' });
    for (const displayName of ['​​', 'Ana‮ziuL', 'a\u0007b', '🔥🔥', '--', 'x']) {
      expect(profileInputSchema.safeParse({ displayName }).success).toBe(false);
    }
  });
});
