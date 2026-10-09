/**
 * Exportação de um tema com as fotos, num .zip pronto para reimportar:
 *
 *   perguntas.csv   → mesmo formato da importação, com a coluna `foto`
 *   fotos/*.webp    → a foto de cada pergunta que tem uma
 *
 * Para voltar: corrija o CSV, escolha-o em "Importar perguntas" e escolha o
 * próprio .zip no campo de fotos. As fotos se encontram com as linhas pelo nome.
 */
import { createZip, type ZipInput } from './zip-writer.js';

export interface ExportedQuestion {
  correctOption: number;
  imageKey: string | null;
  options: string[];
  prompt: string;
  sources: Array<{ kind: string; title: string | null; url: string }>;
  status: string;
}

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Ativa', DISABLED: 'Desativada', IN_REVIEW: 'Em revisão', PENDING: 'Pendente', REJECTED: 'Rejeitada',
};

const BOM = String.fromCharCode(0xfeff);

export const EXPORT_CSV_HEADERS = [
  'prompt', 'optionA', 'optionB', 'optionC', 'optionD', 'correctOption', 'foto', 'sourceUrl', 'sourceTitle', 'sourceKind', 'status',
] as const;

function escapeCsv(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Nome do arquivo de cada foto: a primeira pergunta que a usa dá o número. */
export function photoNames(questions: readonly ExportedQuestion[]): Map<string, string> {
  const names = new Map<string, string>();
  questions.forEach((question, index) => {
    if (question.imageKey !== null && !names.has(question.imageKey)) {
      names.set(question.imageKey, `pergunta-${String(index + 1).padStart(4, '0')}.webp`);
    }
  });
  return names;
}

/**
 * CSV no formato da importação. Começa com a marca UTF-8 para o Excel abrir
 * os acentos certos; a importação ignora essa marca e a coluna `status`.
 */
export function importCsvOf(questions: readonly ExportedQuestion[], names: ReadonlyMap<string, string>): string {
  const lines = [EXPORT_CSV_HEADERS.join(',')];
  for (const question of questions) {
    const source = question.sources[0];
    lines.push([
      question.prompt,
      question.options[0] ?? '',
      question.options[1] ?? '',
      question.options[2] ?? '',
      question.options[3] ?? '',
      question.correctOption,
      question.imageKey === null ? '' : names.get(question.imageKey) ?? '',
      source?.url ?? '',
      source?.title ?? '',
      source?.kind ?? '',
      STATUS_LABEL[question.status] ?? question.status,
    ].map(escapeCsv).join(','));
  }
  return `${BOM}${lines.join('\r\n')}\r\n`;
}

export interface ExportZipResult {
  blob: Blob;
  /** Fotos que o servidor não entregou: a linha sai com a coluna `foto` vazia. */
  missingPhotos: number;
  photos: number;
  questions: number;
}

/** Busca as fotos (algumas por vez) e monta o .zip. */
export async function buildExportZip(
  questions: readonly ExportedQuestion[],
  fetchPhoto: (key: string) => Promise<Blob | null>,
  onProgress?: (done: number, total: number) => void,
): Promise<ExportZipResult> {
  const names = photoNames(questions);
  const keys = [...names.keys()];
  const photos = new Map<string, Blob>();
  let next = 0;
  let done = 0;
  onProgress?.(0, keys.length);
  async function worker() {
    while (next < keys.length) {
      const key = keys[next++];
      if (key === undefined) break;
      const blob = await fetchPhoto(key).catch(() => null);
      if (blob !== null) photos.set(key, blob);
      done += 1;
      onProgress?.(done, keys.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, keys.length) }, worker));

  const available = new Map([...names].filter(([key]) => photos.has(key)));
  const files: ZipInput[] = [{ data: importCsvOf(questions, available), name: 'perguntas.csv' }];
  for (const [key, name] of available) {
    const blob = photos.get(key);
    if (blob !== undefined) files.push({ data: blob, name: `fotos/${name}` });
  }
  return {
    blob: await createZip(files),
    missingPhotos: keys.length - available.size,
    photos: available.size,
    questions: questions.length,
  };
}
