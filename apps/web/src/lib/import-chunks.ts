/**
 * Arquivo grande de perguntas vira partes de até 100, cada uma enviada como
 * um lote normal. O servidor continua recebendo no máximo 100 por vez (e
 * 256 KB por parte); o navegador só divide o texto.
 */
export const IMPORT_CHUNK_SIZE = 100;
export const IMPORT_FILE_MAX_BYTES = 8 * 1024 * 1024;
export const IMPORT_CHUNK_MAX_BYTES = 256 * 1024;

export interface CsvChunk {
  /** Linha do arquivo original onde começa a primeira pergunta desta parte. */
  firstLine: number;
  text: string;
}

/**
 * Separa registros CSV respeitando campos entre aspas (que podem ter vírgula
 * e quebra de linha). Devolve o texto cru de cada registro e a linha física
 * onde ele começa, para os erros apontarem a linha certa do arquivo.
 */
export function splitCsvRecords(text: string): Array<{ line: number; raw: string }> {
  const source = text.replace(/^\uFEFF/, '');
  const records: Array<{ line: number; raw: string }> = [];
  let inQuotes = false;
  let start = 0;
  let line = 1;
  let recordLine = 1;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"') inQuotes = !inQuotes;
    if (char === '\n') {
      if (!inQuotes) {
        const raw = source.slice(start, index).replace(/\r$/, '');
        if (raw.trim() !== '') records.push({ line: recordLine, raw });
        start = index + 1;
        recordLine = line + 1;
      }
      line += 1;
    }
  }
  const tail = source.slice(start).replace(/\r$/, '');
  if (tail.trim() !== '') records.push({ line: recordLine, raw: tail });
  return records;
}

/** Cabeçalho repetido em cada parte, com no máximo `size` perguntas por parte. */
export function chunkCsv(text: string, size = IMPORT_CHUNK_SIZE): CsvChunk[] {
  const [header, ...rows] = splitCsvRecords(text);
  if (header === undefined) return [];
  if (rows.length === 0) return [{ firstLine: header.line + 1, text: header.raw }];
  const chunks: CsvChunk[] = [];
  for (let index = 0; index < rows.length; index += size) {
    const part = rows.slice(index, index + size);
    chunks.push({ firstLine: part[0]!.line, text: [header.raw, ...part.map((row) => row.raw)].join('\n') });
  }
  return chunks;
}

/** JSON aceito: uma lista de perguntas ou `{ questions: [...] }`. */
export function chunkJsonQuestions(parsed: unknown, size = IMPORT_CHUNK_SIZE): unknown[][] | null {
  const list = Array.isArray(parsed)
    ? parsed
    : typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { questions?: unknown }).questions)
      ? (parsed as { questions: unknown[] }).questions
      : null;
  if (list === null) return null;
  const chunks: unknown[][] = [];
  for (let index = 0; index < list.length; index += size) chunks.push(list.slice(index, index + size));
  return chunks.length === 0 ? [[]] : chunks;
}

/**
 * Linha da parte (2 = primeira pergunta, depois do cabeçalho) convertida
 * para a linha do arquivo inteiro. Aproximada quando um campo entre aspas
 * ocupa várias linhas, exata no caso comum de uma pergunta por linha.
 */
export function fileLineForChunkRow(chunk: CsvChunk, chunkRow: number): number {
  return chunkRow <= 1 ? chunkRow : chunk.firstLine + (chunkRow - 2);
}
