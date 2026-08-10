const FORMAT_VERSION = 1;
export const RECENT_QUESTION_LIMIT = 200;

export interface PoolState {
  recentSlots: number[];
  seenBitmap: Uint8Array;
}

export function createPoolState(): PoolState {
  return { recentSlots: [], seenBitmap: new Uint8Array() };
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

  const recentSlots = state.recentSlots.filter((recentSlot) => recentSlot !== slot);
  recentSlots.push(slot);
  if (recentSlots.length > RECENT_QUESTION_LIMIT) recentSlots.shift();
  return { recentSlots, seenBitmap };
}

export function unionRecent(...states: readonly PoolState[]): Set<number> {
  return new Set(states.flatMap((state) => state.recentSlots));
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
  if (state.recentSlots.length > RECENT_QUESTION_LIMIT) throw new RangeError('Fila recente excede 200.');
  state.recentSlots.forEach(assertSlot);
  const headerBytes = 3 + (state.recentSlots.length * 4);
  const encoded = new Uint8Array(headerBytes + state.seenBitmap.length);
  const view = new DataView(encoded.buffer);
  view.setUint8(0, FORMAT_VERSION);
  view.setUint16(1, state.recentSlots.length, false);
  state.recentSlots.forEach((slot, index) => view.setUint32(3 + (index * 4), slot, false));
  encoded.set(state.seenBitmap, headerBytes);
  return encoded;
}

export function decodePoolState(encoded: Uint8Array): PoolState {
  if (encoded.length < 3) throw new Error('Estado de pool truncado.');
  const view = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength);
  if (view.getUint8(0) !== FORMAT_VERSION) throw new Error('Versão de estado de pool desconhecida.');
  const recentCount = view.getUint16(1, false);
  if (recentCount > RECENT_QUESTION_LIMIT) throw new Error('Fila recente inválida.');
  const bitmapOffset = 3 + (recentCount * 4);
  if (bitmapOffset > encoded.length) throw new Error('Estado de pool truncado.');
  const recentSlots = Array.from({ length: recentCount }, (_, index) => view.getUint32(3 + (index * 4), false));
  return { recentSlots, seenBitmap: encoded.slice(bitmapOffset) };
}
