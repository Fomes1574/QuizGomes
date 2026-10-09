/**
 * Gerador mínimo de .zip, sem biblioteca, para a exportação com fotos.
 *
 * Os arquivos entram "guardados" (sem compressão): as fotos já são WebP
 * comprimido e o CSV é pequeno, então comprimir de novo só gastaria tempo.
 * Nomes em UTF-8 (marca 0x0800), abre no Windows, macOS e celular, e o
 * próprio leitor do painel (`zip-reader.ts`) lê de volta na importação.
 */

export interface ZipInput {
  data: Blob | Uint8Array | string;
  /** Caminho dentro do .zip (`fotos/pergunta-0001.webp`). */
  name: string;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function bytesOf(data: ZipInput['data']): Promise<Uint8Array> {
  if (typeof data === 'string') return new TextEncoder().encode(data);
  if (data instanceof Uint8Array) return data;
  return new Uint8Array(await data.arrayBuffer());
}

/** Data e hora no formato do MS-DOS que o .zip usa. */
function dosDateTime(date: Date): { date: number; time: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
  };
}

export class ZipWriteError extends Error {}

/** Monta o .zip inteiro. Limite do formato simples: 4 GB e 65 535 arquivos. */
export async function createZip(files: readonly ZipInput[], now = new Date()): Promise<Blob> {
  if (files.length > 0xfffe) throw new ZipWriteError('Arquivos demais para um único .zip.');
  const encoder = new TextEncoder();
  const stamp = dosDateTime(now);
  const parts: BlobPart[] = [];
  const directory: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = await bytesOf(file.data);
    const crc = crc32(data);
    if (offset + data.byteLength > 0xfffffff0) throw new ZipWriteError('O .zip passaria de 4 GB.');

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(8, 0, true);
    local.setUint16(10, stamp.time, true);
    local.setUint16(12, stamp.date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.byteLength, true);
    local.setUint32(22, data.byteLength, true);
    local.setUint16(26, name.byteLength, true);
    local.setUint16(28, 0, true);
    parts.push(local.buffer, name, data as BlobPart);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true);
    central.setUint16(10, 0, true);
    central.setUint16(12, stamp.time, true);
    central.setUint16(14, stamp.date, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, data.byteLength, true);
    central.setUint32(24, data.byteLength, true);
    central.setUint16(28, name.byteLength, true);
    central.setUint32(42, offset, true);
    directory.push(new Uint8Array(central.buffer), name);

    offset += 30 + name.byteLength + data.byteLength;
  }

  const directorySize = directory.reduce((total, part) => total + part.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, directorySize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...(directory as BlobPart[]), end.buffer], { type: 'application/zip' });
}
