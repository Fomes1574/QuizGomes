/**
 * Fotos na importação de perguntas. O CSV (ou JSON) ganha uma coluna
 * opcional `foto` com o NOME do arquivo; as fotos chegam soltas ou dentro de
 * um .zip e se encontram com as linhas pelo nome, ignorando pastas,
 * maiúsculas e minúsculas. A extensão pode faltar na coluna (`pikachu` acha
 * `pikachu.jpg`) quando só existe uma foto com esse nome.
 *
 * Foto nunca cria pergunta: só entra a foto citada por uma linha, e só depois
 * que a pergunta daquela linha existe no servidor. Foto sem linha aparece no
 * resumo como "não usada" e nunca sai do navegador.
 */
import { splitCsvRecords } from './import-chunks.js';
import { effectiveImageType } from './image-input.js';
import { QUESTION_IMAGE_SOURCE_MAX_BYTES, validateQuestionImageFile } from './question-image-processing.js';
import { listZipEntries, readZipEntry } from './zip-reader.js';

export const PHOTO_COLUMN = 'foto';

export interface PhotoRow {
  /** "linha 12" no CSV, "pergunta 3" no JSON: como o resumo cita a linha. */
  label: string;
  photo: string | null;
}

export interface PhotoSource {
  load: () => Promise<File>;
  /** Nome do arquivo (sem pastas). */
  name: string;
  size: number;
  type: string;
}

export interface PhotoLibrary {
  /** Arquivos escolhidos que não são foto (texto, PDF, vídeo…). */
  ignored: string[];
  /** .zip que não pôde ser lido, com o motivo. */
  problems: string[];
  sources: PhotoSource[];
}

export interface PhotoPlan {
  /** Linha (posição no arquivo, a partir de 0) → foto que ela vai receber. */
  assignments: Map<number, PhotoSource>;
  /** Mesmo nome em duas fotos diferentes: não dá para saber qual é. */
  ambiguous: string[];
  invalid: Array<{ name: string; reason: string }>;
  missing: PhotoRow[];
  /** Linhas que citam alguma foto. */
  referencedRows: number;
  unused: string[];
}

function baseName(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
}

function photoKey(name: string): string {
  return baseName(name).normalize('NFC').trim().toLocaleLowerCase('pt-BR');
}

function stemOf(key: string): string {
  const dot = key.lastIndexOf('.');
  return dot > 0 ? key.slice(0, dot) : key;
}

/** Campos de um registro CSV (RFC 4180, mesmo formato do servidor). */
export function parseCsvFields(raw: string): string[] {
  const fields: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (inQuotes) {
      if (char === '"') {
        if (raw[index + 1] === '"') { field += '"'; index += 1; } else inQuotes = false;
      } else field += char;
    } else if (char === '"') inQuotes = true;
    else if (char === ',') { fields.push(field); field = ''; } else if (char !== '\r') field += char;
  }
  fields.push(field);
  return fields;
}

function cleanPhoto(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** Valor da coluna `foto` de cada linha, na mesma ordem em que as partes são enviadas. */
export function photoRowsFromCsv(text: string): { hasColumn: boolean; rows: PhotoRow[] } {
  const [header, ...records] = splitCsvRecords(text);
  if (header === undefined) return { hasColumn: false, rows: [] };
  const column = parseCsvFields(header.raw).findIndex((name) => name.trim().toLocaleLowerCase('pt-BR') === PHOTO_COLUMN);
  return {
    hasColumn: column >= 0,
    rows: records.map((record) => ({
      label: `linha ${record.line}`,
      photo: column < 0 ? null : cleanPhoto(parseCsvFields(record.raw)[column]),
    })),
  };
}

/**
 * JSON: o campo `foto` de cada pergunta sai do payload (o servidor não o
 * aceita) e vira a lista de fotos por pergunta. O resto fica como veio.
 */
export function photoRowsFromJson(parsed: unknown): { hasColumn: boolean; parsed: unknown; rows: PhotoRow[] } {
  const isList = Array.isArray(parsed);
  const list: unknown = isList ? parsed : (typeof parsed === 'object' && parsed !== null ? (parsed as { questions?: unknown }).questions : null);
  if (!Array.isArray(list)) return { hasColumn: false, parsed, rows: [] };
  let hasColumn = false;
  const rows: PhotoRow[] = [];
  const stripped = list.map((item: unknown, index) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item) || !(PHOTO_COLUMN in item)) {
      rows.push({ label: `pergunta ${index + 1}`, photo: null });
      return item;
    }
    hasColumn = true;
    const { [PHOTO_COLUMN]: photo, ...rest } = item as Record<string, unknown>;
    rows.push({ label: `pergunta ${index + 1}`, photo: cleanPhoto(photo) });
    return rest;
  });
  return { hasColumn, parsed: isList ? stripped : { ...(parsed as object), questions: stripped }, rows };
}

function isZip(file: File): boolean {
  return file.name.toLocaleLowerCase('pt-BR').endsWith('.zip')
    || file.type === 'application/zip' || file.type === 'application/x-zip-compressed';
}

function isJunk(path: string): boolean {
  return path.startsWith('__MACOSX/') || path.includes('/__MACOSX/') || baseName(path).startsWith('.');
}

/** Lê os arquivos escolhidos (fotos soltas e/ou .zip) sem descompactar nada ainda. */
export async function buildPhotoLibrary(files: readonly File[]): Promise<PhotoLibrary> {
  const library: PhotoLibrary = { ignored: [], problems: [], sources: [] };
  for (const file of files) {
    if (isZip(file)) {
      try {
        for (const entry of await listZipEntries(file)) {
          if (isJunk(entry.name)) continue;
          const name = baseName(entry.name);
          if (effectiveImageType({ name, type: '' }) === null) { library.ignored.push(name); continue; }
          library.sources.push({
            load: async () => new File([await readZipEntry(file, entry, QUESTION_IMAGE_SOURCE_MAX_BYTES)], name),
            name, size: entry.uncompressedSize, type: '',
          });
        }
      } catch (error) {
        library.problems.push(`${file.name}: ${error instanceof Error ? error.message : 'não foi possível ler.'}`);
      }
      continue;
    }
    if (isJunk(file.name)) continue;
    if (effectiveImageType(file) === null) { library.ignored.push(file.name); continue; }
    library.sources.push({ load: () => Promise.resolve(file), name: file.name, size: file.size, type: file.type });
  }
  return library;
}

/** Casa cada linha com a sua foto e separa o que falta, sobra ou não serve. */
export function planPhotos(rows: readonly PhotoRow[], library: PhotoLibrary): PhotoPlan {
  const byKey = new Map<string, PhotoSource[]>();
  const byStem = new Map<string, PhotoSource[]>();
  for (const source of library.sources) {
    const key = photoKey(source.name);
    byKey.set(key, [...(byKey.get(key) ?? []), source]);
    byStem.set(stemOf(key), [...(byStem.get(stemOf(key)) ?? []), source]);
  }
  const plan: PhotoPlan = { ambiguous: [], assignments: new Map(), invalid: [], missing: [], referencedRows: 0, unused: [] };
  const used = new Set<PhotoSource>();
  const ambiguous = new Set<string>();
  const invalid = new Map<PhotoSource, string>();
  rows.forEach((row, index) => {
    if (row.photo === null) return;
    plan.referencedRows += 1;
    const key = photoKey(row.photo);
    const candidates = byKey.get(key) ?? (key.includes('.') ? undefined : byStem.get(key)) ?? [];
    // A mesma foto escolhida duas vezes (solta e no .zip) não é ambiguidade.
    const distinct = candidates.filter((source, position) => candidates.findIndex((other) => other.size === source.size) === position);
    const source = candidates[0];
    if (source === undefined) { plan.missing.push(row); return; }
    candidates.forEach((candidate) => used.add(candidate));
    if (distinct.length > 1) { ambiguous.add(baseName(row.photo)); return; }
    const reason = invalid.get(source) ?? validateQuestionImageFile(source);
    if (reason !== null) { invalid.set(source, reason); return; }
    plan.assignments.set(index, source);
  });
  plan.ambiguous = [...ambiguous];
  plan.invalid = [...invalid].map(([source, reason]) => ({ name: source.name, reason }));
  plan.unused = library.sources.filter((source) => !used.has(source)).map((source) => source.name);
  return plan;
}

/** "a, b, c e mais 4" — listas longas não podem tomar a tela. */
export function shortList(items: readonly string[], max = 4): string {
  if (items.length <= max) return items.join(', ');
  return `${items.slice(0, max).join(', ')} e mais ${items.length - max}`;
}
