import type { MatchMode, MatchResult, RankedThemeSample } from '../types.js';

export const KNOWLEDGE_CAP = 999_999;
export const CHALLENGER_I_THRESHOLD = 105_500;

export const TIERS = [
  'Latão',
  'Bronze',
  'Prata',
  'Ouro',
  'Platina',
  'Diamante',
  'Mestre',
  'Desafiante',
] as const;

export const DIVISIONS = ['V', 'IV', 'III', 'II', 'I'] as const;

export type Tier = (typeof TIERS)[number];
export type Division = (typeof DIVISIONS)[number];

const TRANSITION_COSTS = [
  300, 400, 500, 600, 700,
  800, 900, 1_000, 1_100, 1_200,
  1_300, 1_400, 1_500, 1_600, 1_700,
  1_800, 1_900, 2_000, 2_100, 2_200,
  2_300, 2_400, 2_500, 2_600, 2_700,
  3_000, 3_200, 3_400, 3_600, 3_800,
  4_200, 4_500, 4_800, 5_100, 5_400,
  6_000, 6_500, 7_000, 7_500,
] as const;

export const DIVISION_THRESHOLDS = TRANSITION_COSTS.reduce<number[]>(
  (thresholds, cost) => [...thresholds, (thresholds.at(-1) ?? 0) + cost],
  [0],
);

if (DIVISION_THRESHOLDS.at(-1) !== CHALLENGER_I_THRESHOLD) {
  throw new Error('Os thresholds de ranking não somam 105.500.');
}

// Rankeada é hoje o único modo que move Conhecimento, e não existe mais escolha de
// dificuldade: os valores abaixo são os que antes valiam só para HARD (índice 2).
const WIN_VALUES: Record<Tier, number> = {
  Latão: 75,
  Bronze: 69,
  Prata: 63,
  Ouro: 57,
  Platina: 51,
  Diamante: 45,
  Mestre: 39,
  Desafiante: 33,
};

const LOSS_VALUES: Record<Tier, number> = {
  Latão: 30,
  Bronze: 33,
  Prata: 36,
  Ouro: 39,
  Platina: 42,
  Diamante: 45,
  Mestre: 48,
  Desafiante: 54,
};

export interface RankSnapshot {
  division: Division;
  divisionIndex: number;
  knowledge: number;
  nextThreshold: number | null;
  progress: number;
  progressInDivision: number;
  tier: Tier;
}

export interface KnowledgeResolution {
  after: RankSnapshot;
  appliedDelta: number;
  before: RankSnapshot;
  requestedDelta: number;
}

export function clampKnowledge(knowledge: number): number {
  if (!Number.isFinite(knowledge)) throw new TypeError('Conhecimento deve ser finito.');
  return Math.min(KNOWLEDGE_CAP, Math.max(0, Math.trunc(knowledge)));
}

export function divisionIndexForKnowledge(knowledgeInput: number): number {
  const knowledge = clampKnowledge(knowledgeInput);
  let low = 0;
  let high = DIVISION_THRESHOLDS.length - 1;

  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const threshold = DIVISION_THRESHOLDS[middle];
    if (threshold !== undefined && threshold <= knowledge) low = middle;
    else high = middle - 1;
  }

  return low;
}

/**
 * Faixas de Conhecimento do matchmaking Rankeado, alargando conforme o tempo
 * de espera do candidato: mesma divisão até 15 s, divisões vizinhas até 30 s,
 * até duas divisões até 45 s e qualquer divisão do mesmo tema depois disso (o
 * timeout geral de 60 s da fila é o teto). Partida normal nunca usa
 * Conhecimento: pareia só por tema, na ordem de chegada.
 */
export function rankedMatchmakingDivisionBand(waitMs: number): number {
  if (waitMs < 15_000) return 0;
  if (waitMs < 30_000) return 1;
  if (waitMs < 45_000) return 2;
  return Number.POSITIVE_INFINITY;
}

export function rankForKnowledge(knowledgeInput: number): RankSnapshot {
  const knowledge = clampKnowledge(knowledgeInput);
  const divisionIndex = divisionIndexForKnowledge(knowledge);
  const tierIndex = Math.floor(divisionIndex / DIVISIONS.length);
  const divisionIndexWithinTier = divisionIndex % DIVISIONS.length;
  const floor = DIVISION_THRESHOLDS[divisionIndex] ?? 0;
  const nextThreshold = DIVISION_THRESHOLDS[divisionIndex + 1] ?? null;
  const progressInDivision = knowledge - floor;
  const progress = nextThreshold === null
    ? 1
    : Math.min(1, progressInDivision / (nextThreshold - floor));

  return {
    division: DIVISIONS[divisionIndexWithinTier] ?? 'I',
    divisionIndex,
    knowledge,
    nextThreshold,
    progress,
    progressInDivision,
    tier: TIERS[tierIndex] ?? 'Desafiante',
  };
}

export function knowledgeDelta(
  knowledge: number,
  result: MatchResult,
  mode: MatchMode,
): number {
  if (mode === 'CASUAL' || result === 'DRAW' || result === 'VOID') return 0;
  const tier = rankForKnowledge(knowledge).tier;
  if (result === 'WIN') return WIN_VALUES[tier];
  return -LOSS_VALUES[tier];
}

export function resolveKnowledge(
  knowledge: number,
  result: MatchResult,
  mode: MatchMode,
): KnowledgeResolution {
  const before = rankForKnowledge(knowledge);
  const requestedDelta = knowledgeDelta(before.knowledge, result, mode);
  const after = rankForKnowledge(before.knowledge + requestedDelta);
  return {
    after,
    appliedDelta: after.knowledge - before.knowledge,
    before,
    requestedDelta,
  };
}

/** Abandono rankeado aplica a perda que antes era exclusiva de HARD. */
export function rankedAbandonmentLoss(knowledge: number): KnowledgeResolution {
  return resolveKnowledge(knowledge, 'LOSS', 'RANKED');
}

export function perfectWinsToChallengerI(): number {
  let knowledge = 0;
  let wins = 0;
  while (knowledge < CHALLENGER_I_THRESHOLD) {
    knowledge = resolveKnowledge(knowledge, 'WIN', 'RANKED').after.knowledge;
    wins += 1;
  }
  return wins;
}

function ordinalPosition(knowledge: number): number {
  const rank = rankForKnowledge(knowledge);
  return Math.min(DIVISION_THRESHOLDS.length - 1, rank.divisionIndex + rank.progress);
}

export interface CategoryAverage {
  rank: RankSnapshot;
  sampledThemes: number;
  value: number;
}

export function categoryAverage(samples: readonly RankedThemeSample[]): CategoryAverage | null {
  const played = samples.filter((sample) => sample.rankedMatches > 0);
  if (played.length === 0) return null;
  const value = played.reduce((total, sample) => total + ordinalPosition(sample.knowledge), 0) / played.length;
  const index = Math.min(DIVISION_THRESHOLDS.length - 1, Math.floor(value));
  return {
    rank: rankForKnowledge(DIVISION_THRESHOLDS[index] ?? CHALLENGER_I_THRESHOLD),
    sampledThemes: played.length,
    value,
  };
}

export function competitionPositions(knowledgeValues: readonly number[]): number[] {
  const sorted = [...knowledgeValues].map(clampKnowledge).sort((a, b) => b - a);
  const positionByKnowledge = new Map<number, number>();
  sorted.forEach((knowledge, index) => {
    if (!positionByKnowledge.has(knowledge)) positionByKnowledge.set(knowledge, index + 1);
  });
  return knowledgeValues.map((knowledge) => positionByKnowledge.get(clampKnowledge(knowledge)) ?? 0);
}
