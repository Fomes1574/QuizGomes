/**
 * Estado do jogador por pool de perguntas.
 *
 * Guarda apenas a descoberta histórica (bitmap de slots já respondidos), usada pela
 * porcentagem de descoberta do tema. O sorteio NÃO consulta este estado: perguntas
 * podem repetir entre partidas diferentes e nunca repetem dentro da mesma partida.
 */
const FORMAT_VERSION = 2;
const LEGACY_FORMAT_VERSION = 1;

export interface PoolState {
  seenBitmap: Uint8Array;
}

export function createPoolState(): PoolState {
  return { seenBitmap: new Uint8Array() };
}

function assertSlot(slot: number): void {
  if (!Number.isInteger(slot) || slot < 1 || slot > 0xffff_ffff) {
    throw new RangeError('Slot deve ser um inteiro positivo de 32 bits.');
  }
}

function expandedBitmap(bitmap: Uint8Array, slot: number): Uint8Array {
  const requiredBytes = Math.ceil(slot / 8);
  if (bitmap.length >= requiredBytes) return bitmap.slice();
  const next = new Uint8Array(requiredBytes);
  next.set(bitmap);
  return next;
}

export function hasSeen(state: PoolState, slot: number): boolean {
  assertSlot(slot);
  const byte = state.seenBitmap[Math.floor((slot - 1) / 8)] ?? 0;
  return (byte & (1 << ((slot - 1) % 8))) !== 0;
}

export function markAnswered(state: PoolState, slot: number): PoolState {
  assertSlot(slot);
  const seenBitmap = expandedBitmap(state.seenBitmap, slot);
  const byteIndex = Math.floor((slot - 1) / 8);
  seenBitmap[byteIndex] = (seenBitmap[byteIndex] ?? 0) | (1 << ((slot - 1) % 8));
  return { seenBitmap };
}

function popcountByte(value: number): number {
  let current = value;
  let count = 0;
  while (current !== 0) {
    current &= current - 1;
    count += 1;
  }
  return count;
}

export function discoveredCount(state: PoolState, activeCount: number): number {
  if (!Number.isInteger(activeCount) || activeCount < 0) throw new RangeError('Pool inválido.');
  if (activeCount === 0) return 0;
  const fullBytes = Math.floor(activeCount / 8);
  let count = 0;
  for (let index = 0; index < fullBytes; index += 1) count += popcountByte(state.seenBitmap[index] ?? 0);
  const remainingBits = activeCount % 8;
  if (remainingBits > 0) {
    const mask = (1 << remainingBits) - 1;
    count += popcountByte((state.seenBitmap[fullBytes] ?? 0) & mask);
  }
  return count;
}

export function discoveredPercentage(state: PoolState, activeCount: number): number {
  return activeCount === 0 ? 0 : (discoveredCount(state, activeCount) / activeCount) * 100;
}

export function encodePoolState(state: PoolState): Uint8Array {
  const encoded = new Uint8Array(1 + state.seenBitmap.length);
  encoded[0] = FORMAT_VERSION;
  encoded.set(state.seenBitmap, 1);
  return encoded;
}

export function decodePoolState(encoded: Uint8Array): PoolState {
  if (encoded.length < 1) throw new Error('Estado de pool truncado.');
  const version = encoded[0];
  if (version === FORMAT_VERSION) return { seenBitmap: encoded.slice(1) };
  if (version !== LEGACY_FORMAT_VERSION) throw new Error('Versão de estado de pool desconhecida.');
  // Formato 1 carregava a fila das últimas 200 exibidas antes do bitmap; a fila foi
  // descontinuada e é descartada na leitura, sem migration de dados.
  if (encoded.length < 3) throw new Error('Estado de pool truncado.');
  const view = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength);
  const recentCount = view.getUint16(1, false);
  const bitmapOffset = 3 + (recentCount * 4);
  if (bitmapOffset > encoded.length) throw new Error('Estado de pool truncado.');
  return { seenBitmap: encoded.slice(bitmapOffset) };
}
