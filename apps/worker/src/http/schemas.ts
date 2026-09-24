import { z } from 'zod';
import { isStandardThemeIconKey, REPORT_REASONS, REPORT_STATUSES } from '@quiz-gomes/domain';

export const profileInputSchema = z.object({
  displayName: z.string().trim().min(2, 'Use pelo menos 2 caracteres.').max(32, 'Use no máximo 32 caracteres.'),
}).strict();

export const categoryCreationSchema = z.object({
  name: z.string().trim().min(2).max(60),
  slug: z.string().trim().min(2).max(60).regex(/^[a-z0-9-]+$/, 'Use apenas letras minúsculas, números e hífen.'),
  sortOrder: z.number().int().min(0).max(9_999).default(0),
}).strict();

export const categoryUpdateSchema = z.object({
  expectedRevision: z.number().int().min(1),
  name: z.string().trim().min(2).max(60),
  sortOrder: z.number().int().min(0).max(9_999),
  status: z.enum(['ACTIVE', 'DISABLED']),
}).strict();

export const themeRejectionSchema = z.object({
  expectedRevision: z.number().int().min(1),
  note: z.string().trim().max(280).optional(),
}).strict();

export const themeEditSchema = z.object({
  categoryId: z.string().trim().min(1).max(128),
  description: z.string().trim().min(12).max(240),
  expectedRevision: z.number().int().min(1),
  name: z.string().trim().min(2).max(60),
}).strict();

export const themeModerationCasSchema = z.object({
  expectedRevision: z.number().int().min(1),
}).strict();

export const themeSubmissionSchema = z.object({
  categoryId: z.string().trim().min(1).max(128),
  description: z.string().trim().min(12).max(240),
  name: z.string().trim().min(2).max(60),
}).strict();

const standardThemeIconSchema = z.string().refine(isStandardThemeIconKey, {
  message: 'Escolha um ícone padrão disponível.',
});

export const themeArtworkChoiceSchema = z.discriminatedUnion('kind', [
  z.object({
    expectedVersion: z.number().int().min(0),
    iconKey: standardThemeIconSchema,
    kind: z.literal('ICON'),
  }).strict(),
  z.object({
    expectedVersion: z.number().int().min(0),
    kind: z.literal('NONE'),
  }).strict(),
]);

const sourceSchema = z.object({
  kind: z.enum(['PRIMARY', 'WEB', 'BOOK', 'OTHER']).default('WEB'),
  title: z.string().trim().max(160).optional(),
  url: z.string().trim().min(1).max(2_048),
}).strict();

export const importedQuestionSchema = z.object({
  correctOption: z.number().int().min(0).max(3),
  // Compatibilidade com CSV/JSON antigos que ainda trazem a coluna: aceita
  // qualquer valor e nunca é lido — o pool é único por tema desde 2026-09-24.
  difficulty: z.string().max(16).optional(),
  options: z.tuple([
    z.string().trim().min(1).max(180),
    z.string().trim().min(1).max(180),
    z.string().trim().min(1).max(180),
    z.string().trim().min(1).max(180),
  ]),
  prompt: z.string().trim().min(1).max(360),
  // Fontes podem ser vinculadas para referência editorial, mas não bloqueiam
  // conteúdo confirmado que será revisado pela administração.
  sources: z.array(sourceSchema).max(5).default([]),
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

function assertDistinctOptions(
  question: { options: readonly [string, string, string, string] },
  context: z.RefinementCtx,
): void {
  const normalizedOptions = question.options.map((option) => option.normalize('NFKC').toLocaleLowerCase('pt-BR'));
  if (new Set(normalizedOptions).size !== 4) {
    context.addIssue({ code: 'custom', message: 'As quatro alternativas precisam ser diferentes.', path: ['options'] });
  }
}

const questionOptionsTuple = z.tuple([
  z.string().trim().min(1).max(180),
  z.string().trim().min(1).max(180),
  z.string().trim().min(1).max(180),
  z.string().trim().min(1).max(180),
]);

export const questionEditorialSchema = z.object({
  correctOption: z.number().int().min(0).max(3),
  options: questionOptionsTuple,
  prompt: z.string().trim().min(1).max(360),
  sources: z.array(sourceSchema).max(5).default([]),
}).strict().superRefine(assertDistinctOptions);

export type QuestionEditorialInput = z.infer<typeof questionEditorialSchema>;

export const questionEditSchema = z.object({
  correctOption: z.number().int().min(0).max(3),
  options: questionOptionsTuple,
  prompt: z.string().trim().min(1).max(360),
  sources: z.array(sourceSchema).max(5).default([]),
}).strict().superRefine(assertDistinctOptions);

export const questionRejectionSchema = z.object({
  note: z.string().trim().max(280).optional(),
}).strict();

/** Uma página editorial contém no máximo 50 registros. O limite mantém a
 * aprovação em lote previsível e evita transformar uma ação administrativa
 * em uma varredura do catálogo. */
export const questionBatchApprovalSchema = z.object({
  questionIds: z.array(z.string().uuid()).min(1).max(50)
    .refine((ids) => new Set(ids).size === ids.length, 'Não repita perguntas no mesmo lote.'),
}).strict();

export const reportCreationSchema = z.object({
  contextId: z.string().trim().min(1).max(128),
  contextKind: z.enum(['MATCH', 'CHALLENGE']),
  note: z.string().trim().max(280).optional(),
  questionId: z.string().trim().min(1).max(128),
  reason: z.enum(REPORT_REASONS),
  roundNumber: z.number().int().min(1).max(12),
}).strict();

export const reportResolutionSchema = z.object({
  resolutionNote: z.string().trim().max(280).optional(),
  status: z.enum(REPORT_STATUSES),
}).strict();
