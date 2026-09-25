import type { QuestionExportRecord } from '../repositories/question-editorial-repository.js';

export const QUESTION_EXPORT_CSV_HEADERS = [
  'id',
  'themeId',
  'poolId',
  'status',
  'activeSlot',
  'prompt',
  'optionA',
  'optionB',
  'optionC',
  'optionD',
  'correctOption',
  'correctLetter',
  'imageKey',
  'imageBytes',
  'imageLicense',
  'sourcesJson',
  'createdAt',
  'createdByUserId',
  'replacesQuestionId',
  'resolvedAt',
  'resolvedByUserId',
  'resolutionNote',
] as const;

function escapeCsv(value: string | number | null): string {
  const text = value === null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function questionExportCsvHeader(): string {
  return `${QUESTION_EXPORT_CSV_HEADERS.join(',')}\r\n`;
}

export function questionExportCsvRow(question: QuestionExportRecord): string {
  const values: Array<string | number | null> = [
    question.id,
    question.themeId,
    question.poolId,
    question.status,
    question.activeSlot,
    question.prompt,
    question.options[0],
    question.options[1],
    question.options[2],
    question.options[3],
    question.correctOption,
    'ABCD'[question.correctOption] ?? null,
    question.imageKey,
    question.imageBytes,
    question.imageLicense,
    JSON.stringify(question.sources),
    question.createdAt,
    question.createdByUserId,
    question.replacesQuestionId,
    question.resolvedAt,
    question.resolvedByUserId,
    question.resolutionNote,
  ];
  return `${values.map(escapeCsv).join(',')}\r\n`;
}
