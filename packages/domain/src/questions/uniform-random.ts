export class InsufficientQuestionPoolError extends Error {
  readonly code = 'QUESTION_POOL_INSUFFICIENT';

  constructor(available: number, requested: number) {
    super(`Pool possui ${available} perguntas elegíveis, mas ${requested} foram solicitadas.`);
    this.name = 'InsufficientQuestionPoolError';
  }
}

export type RandomOrdinal = (upperExclusive: number) => number;

export function cryptoRandomOrdinal(upperExclusive: number): number {
  if (!Number.isInteger(upperExclusive) || upperExclusive <= 0 || upperExclusive > 0x1_0000_0000) {
    throw new RangeError('Limite aleatório inválido.');
  }
  const range = 0x1_0000_0000;
  const cutoff = range - (range % upperExclusive);
  const buffer = new Uint32Array(1);
  do {
    (globalThis as unknown as { crypto: { getRandomValues: (target: Uint32Array) => Uint32Array } })
      .crypto.getRandomValues(buffer);
  } while ((buffer[0] ?? range) >= cutoff);
  return (buffer[0] ?? 0) % upperExclusive;
}

function validUnavailable(poolSize: number, unavailable: ReadonlySet<number>): number[] {
  return [...unavailable]
    .filter((slot) => Number.isInteger(slot) && slot >= 1 && slot <= poolSize)
    .sort((a, b) => a - b);
}

function slotAtEligibleOrdinal(poolSize: number, ordinal: number, unavailable: readonly number[]): number {
  let low = 1;
  let high = poolSize;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    let blockedThroughMiddle = 0;
    for (const slot of unavailable) {
      if (slot > middle) break;
      blockedThroughMiddle += 1;
    }
    const eligibleThroughMiddle = middle - blockedThroughMiddle;
    if (eligibleThroughMiddle > ordinal) high = middle;
    else low = middle + 1;
  }
  return low;
}

export function selectUniformSlots(
  poolSize: number,
  count: number,
  blocked: ReadonlySet<number>,
  randomOrdinal: RandomOrdinal = cryptoRandomOrdinal,
): number[] {
  if (!Number.isInteger(poolSize) || poolSize < 0) throw new RangeError('Tamanho de pool inválido.');
  if (!Number.isInteger(count) || count < 0) throw new RangeError('Quantidade inválida.');
  const unavailable = validUnavailable(poolSize, blocked);
  const available = poolSize - unavailable.length;
  if (available < count) throw new InsufficientQuestionPoolError(available, count);

  const selected: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const remaining = available - index;
    const ordinal = randomOrdinal(remaining);
    if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal >= remaining) {
      throw new RangeError('Fonte aleatória retornou ordinal inválido.');
    }
    const slot = slotAtEligibleOrdinal(poolSize, ordinal, unavailable);
    selected.push(slot);
    const insertionIndex = unavailable.findIndex((current) => current > slot);
    if (insertionIndex === -1) unavailable.push(slot);
    else unavailable.splice(insertionIndex, 0, slot);
  }
  return selected;
}
