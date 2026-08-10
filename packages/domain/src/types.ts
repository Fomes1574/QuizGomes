export const DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const MATCH_MODES = ['CASUAL', 'RANKED'] as const;
export type MatchMode = (typeof MATCH_MODES)[number];

export const MATCH_RESULTS = ['WIN', 'LOSS', 'DRAW', 'VOID'] as const;
export type MatchResult = (typeof MATCH_RESULTS)[number];

export interface RankedThemeSample {
  knowledge: number;
  rankedMatches: number;
}
