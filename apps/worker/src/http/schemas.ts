import { z } from 'zod';

export const profileInputSchema = z.object({
  displayName: z.string().trim().min(2, 'Use pelo menos 2 caracteres.').max(32, 'Use no máximo 32 caracteres.'),
}).strict();

export const themeSubmissionSchema = z.object({
  categoryId: z.string().trim().min(1).max(128),
  description: z.string().trim().min(12).max(240),
  name: z.string().trim().min(2).max(60),
}).strict();

const sourceSchema = z.object({
  kind: z.enum(['PRIMARY', 'WEB', 'BOOK', 'OTHER']).default('WEB'),
  title: z.string().trim().max(160).optional(),
  url: z.string().trim().min(1).max(2_048),
}).strict();

export const importedQuestionSchema = z.object({
  correctOption: z.number().int().min(0).max(3),
  difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']),
  image: z.object({
    bytes: z.number().int().positive().max(102_399),
    key: z.string().trim().min(1).max(256),
    license: z.string().trim().min(1).max(256),
  }).strict().optional(),
  options: z.tuple([
    z.string().trim().min(1).max(180),
    z.string().trim().min(1).max(180),
    z.string().trim().min(1).max(180),
    z.string().trim().min(1).max(180),
  ]),
  prompt: z.string().trim().min(1).max(360),
  sources: z.array(sourceSchema).min(1).max(5),
  themeId: z.string().trim().min(1).max(128),
}).strict().superRefine((question, context) => {
  const normalizedOptions = question.options.map((option) => option.normalize('NFKC').toLocaleLowerCase('pt-BR'));
  if (new Set(normalizedOptions).size !== 4) {
    context.addIssue({ code: 'custom', message: 'As quatro alternativas precisam ser diferentes.', path: ['options'] });
  }
});

export const importBatchSchema = z.object({
  questions: z.array(importedQuestionSchema).min(1).max(100),
}).strict();

export type ImportedQuestion = z.infer<typeof importedQuestionSchema>;
