import { importedQuestionSchema, type ImportedQuestion } from '../http/schemas.js';

const REQUIRED_CSV_COLUMNS = [
  'difficulty', 'prompt', 'optionA', 'optionB', 'optionC', 'optionD', 'correctOption',
] as const;
type CsvColumn = (typeof REQUIRED_CSV_COLUMNS)[number] | 'themeId' | 'sourceUrl' | 'sourceTitle' | 'sourceKind';

const MAX_CSV_ROWS = 100;

export interface CsvRowDiagnostic {
  messages: string[];
  row: number;
}

/**
 * Parser RFC 4180 mínimo: campos entre aspas podem conter vírgula, quebra de
 * linha e aspas escapadas (`""`). Sem dependência externa.
 */
function parseCsvTable(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let index = 0;
  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };
  while (index < text.length) {
    const char = text[index];
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') { field += '"'; index += 2; continue; }
        inQuotes = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }
    if (char === '"') { inQuotes = true; index += 1; continue; }
    if (char === ',') { pushField(); index += 1; continue; }
    if (char === '\r') { index += 1; continue; }
    if (char === '\n') { pushRow(); index += 1; continue; }
    field += char;
    index += 1;
  }
  if (field.length > 0 || row.length > 0) pushRow();
  return rows.filter((line) => !(line.length === 1 && line[0] === ''));
}

/**
 * Converte um CSV de uma linha por pergunta (uma fonte por linha) em
 * `ImportedQuestion[]`, com diagnóstico por linha. Nunca lança para um erro
 * de conteúdo — a chamada decide que uma lista de diagnósticos não-vazia
 * significa "não importar nada" (sem importação parcial).
 */
export function parseQuestionsCsv(
  text: string,
  defaultThemeId?: string,
): { diagnostics: CsvRowDiagnostic[]; questions: ImportedQuestion[] } {
  const table = parseCsvTable(text.trim());
  if (table.length === 0) return { diagnostics: [{ messages: ['O arquivo CSV está vazio.'], row: 0 }], questions: [] };
  const [header, ...dataRows] = table;
  if (header === undefined) return { diagnostics: [{ messages: ['O arquivo CSV está vazio.'], row: 0 }], questions: [] };
  const normalizedHeader = header.map((column) => column.trim());
  const requiredColumns = defaultThemeId === undefined
    ? [...REQUIRED_CSV_COLUMNS, 'themeId']
    : REQUIRED_CSV_COLUMNS;
  const missingColumns = requiredColumns.filter((column) => !normalizedHeader.includes(column));
  if (missingColumns.length > 0) {
    return {
      diagnostics: [{ messages: [`Colunas ausentes no cabeçalho: ${missingColumns.join(', ')}.`], row: 1 }],
      questions: [],
    };
  }
  if (dataRows.length === 0) return { diagnostics: [{ messages: ['O CSV não tem nenhuma linha de dados.'], row: 1 }], questions: [] };
  if (dataRows.length > MAX_CSV_ROWS) {
    return {
      diagnostics: [{ messages: [`Envie no máximo ${MAX_CSV_ROWS} linhas por lote.`], row: 0 }],
      questions: [],
    };
  }

  const columnIndex = (column: CsvColumn) => normalizedHeader.indexOf(column);
  const diagnostics: CsvRowDiagnostic[] = [];
  const questions: ImportedQuestion[] = [];

  dataRows.forEach((cells, dataRowIndex) => {
    const lineNumber = dataRowIndex + 2; // linha 1 é o cabeçalho.
    if (cells.length === 1 && cells[0] === '') return;
    if (cells.length !== normalizedHeader.length) {
      diagnostics.push({
        messages: [`Esperava ${normalizedHeader.length} colunas e encontrou ${cells.length}.`],
        row: lineNumber,
      });
      return;
    }
    const correctOptionRaw = (cells[columnIndex('correctOption')] ?? '').trim();
    const sourceUrl = (cells[columnIndex('sourceUrl')] ?? '').trim();
    const sourceTitle = (cells[columnIndex('sourceTitle')] ?? '').trim();
    const sourceKindRaw = (cells[columnIndex('sourceKind')] ?? '').trim();
    const sourceKind = sourceKindRaw.toUpperCase() || 'WEB';
    const candidate = {
      correctOption: Number(correctOptionRaw),
      difficulty: (cells[columnIndex('difficulty')] ?? '').trim().toUpperCase(),
      options: [
        cells[columnIndex('optionA')] ?? '',
        cells[columnIndex('optionB')] ?? '',
        cells[columnIndex('optionC')] ?? '',
        cells[columnIndex('optionD')] ?? '',
      ],
      prompt: (cells[columnIndex('prompt')] ?? '').trim(),
      sources: sourceUrl === '' && sourceTitle === '' && sourceKindRaw === ''
        ? []
        : [{
          kind: sourceKind,
          ...(sourceTitle === '' ? {} : { title: sourceTitle }),
          url: sourceUrl,
        }],
      themeId: defaultThemeId ?? (cells[columnIndex('themeId')] ?? '').trim(),
    };
    const parsed = importedQuestionSchema.safeParse(candidate);
    if (!parsed.success) {
      diagnostics.push({
        messages: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
        row: lineNumber,
      });
      return;
    }
    questions.push(parsed.data);
  });

  if (diagnostics.length > 0) return { diagnostics, questions: [] };

  const hashes = questions.map((question) => JSON.stringify([question.themeId, question.difficulty, question.prompt]));
  if (new Set(hashes).size !== hashes.length) {
    return { diagnostics: [{ messages: ['O lote contém perguntas duplicadas entre si.'], row: 0 }], questions: [] };
  }
  return { diagnostics: [], questions };
}
