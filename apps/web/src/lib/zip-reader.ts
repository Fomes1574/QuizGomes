/**
 * Leitor mínimo de .zip para a importação de fotos, sem biblioteca: o
 * navegador já descompacta "deflate" nativamente (DecompressionStream).
 *
 * O arquivo nunca é carregado inteiro na memória: lemos só o diretório
 * central no fim do .zip e, depois, uma foto por vez pelo `slice` do arquivo.
 * Um .zip de centenas de MB custa, portanto, o mesmo que a maior foto dele.
 */

export interface ZipEntry {
  compressedSize: number;
  /** 0 = guardado sem compressão; 8 = deflate. */
  method: number;
  /** Caminho dentro do .zip, com pastas (`fotos/pikachu.jpg`). */
  name: string;
  uncompressedSize: number;
  localHeaderOffset: number;
}

export class ZipReadError extends Error {}

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
/** Registro final (22 bytes) + comentário máximo (65535). */
const END_SEARCH_WINDOW = 22 + 0xffff;

async function bytesOf(blob: Blob): Promise<DataView> {
  return new DataView(await blob.arrayBuffer());
}

function decodeName(bytes: Uint8Array, utf8Flag: boolean): string {
  try {
    return new TextDecoder('utf-8', { fatal: !utf8Flag }).decode(bytes);
  } catch {
    // .zip antigo sem a marca UTF-8: melhor aproximação disponível no navegador.
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** Lista os arquivos do .zip (pastas ficam de fora). */
export async function listZipEntries(file: Blob): Promise<ZipEntry[]> {
  const tailStart = Math.max(0, file.size - END_SEARCH_WINDOW);
  const tail = await bytesOf(file.slice(tailStart));
  let end = -1;
  for (let offset = tail.byteLength - 22; offset >= 0; offset -= 1) {
    if (tail.getUint32(offset, true) === END_OF_CENTRAL_DIRECTORY) { end = offset; break; }
  }
  if (end < 0) throw new ZipReadError('Este arquivo não parece um .zip válido.');
  const entryCount = tail.getUint16(end + 10, true);
  const directorySize = tail.getUint32(end + 12, true);
  const directoryOffset = tail.getUint32(end + 16, true);
  if (entryCount === 0xffff || directoryOffset === 0xffffffff || directorySize === 0xffffffff) {
    throw new ZipReadError('Este .zip é grande demais (ZIP64). Divida as fotos em arquivos .zip menores.');
  }
  if (directoryOffset + directorySize > file.size) throw new ZipReadError('Este .zip está incompleto ou corrompido.');

  const directory = await bytesOf(file.slice(directoryOffset, directoryOffset + directorySize));
  const entries: ZipEntry[] = [];
  let cursor = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > directory.byteLength || directory.getUint32(cursor, true) !== CENTRAL_DIRECTORY_HEADER) {
      throw new ZipReadError('Este .zip está incompleto ou corrompido.');
    }
    const flags = directory.getUint16(cursor + 8, true);
    const method = directory.getUint16(cursor + 10, true);
    const compressedSize = directory.getUint32(cursor + 20, true);
    const uncompressedSize = directory.getUint32(cursor + 24, true);
    const nameLength = directory.getUint16(cursor + 28, true);
    const extraLength = directory.getUint16(cursor + 30, true);
    const commentLength = directory.getUint16(cursor + 32, true);
    const localHeaderOffset = directory.getUint32(cursor + 42, true);
    const nameBytes = new Uint8Array(directory.buffer, directory.byteOffset + cursor + 46, nameLength);
    const name = decodeName(nameBytes, (flags & 0x0800) !== 0);
    cursor += 46 + nameLength + extraLength + commentLength;
    // Pastas e arquivos com senha ficam de fora.
    if (name.endsWith('/') || (flags & 0x0001) !== 0) continue;
    entries.push({ compressedSize, localHeaderOffset, method, name, uncompressedSize });
  }
  return entries;
}

/**
 * Extrai um arquivo. `maxBytes` corta a leitura assim que o conteúdo
 * descompactado passa do limite, mesmo que o cabeçalho minta o tamanho.
 */
export async function readZipEntry(file: Blob, entry: ZipEntry, maxBytes: number): Promise<Blob> {
  if (entry.method !== 0 && entry.method !== 8) {
    throw new ZipReadError('Compressão não suportada dentro do .zip. Gere o .zip pelo sistema (Windows, macOS ou celular).');
  }
  const header = await bytesOf(file.slice(entry.localHeaderOffset, entry.localHeaderOffset + 30));
  if (header.byteLength < 30 || header.getUint32(0, true) !== LOCAL_FILE_HEADER) {
    throw new ZipReadError('Este .zip está incompleto ou corrompido.');
  }
  const dataStart = entry.localHeaderOffset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
  const compressed = file.slice(dataStart, dataStart + entry.compressedSize);
  if (entry.method === 0) {
    if (compressed.size > maxBytes) throw new ZipReadError('Foto grande demais dentro do .zip.');
    return compressed;
  }
  const reader = compressed.stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new ZipReadError('Foto grande demais dentro do .zip.');
    }
    parts.push(value);
  }
  return new Blob(parts as BlobPart[]);
}
