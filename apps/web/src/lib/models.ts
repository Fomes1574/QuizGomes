export interface Category {
  id: string;
  name: string;
  slug: string;
}

export interface ThemeSummary {
  activeQuestionCount: number;
  categoryId: string;
  categoryName: string;
  coverImageKey: string | null;
  description: string;
  id: string;
  name: string;
  slug: string;
}

export interface LeaderboardEntry {
  displayName: string;
  frameId: string | null;
  knowledge: number;
  photoUrl: string | null;
  position: number;
  publicId: string;
}

export interface ThemeDetailResponse {
  personal: null | {
    discoveredPercentage: number;
    knowledge: number;
    position: number | null;
    rankedMatches: number;
  };
  questionCounts: { EASY: number; HARD: number; MEDIUM: number };
  theme: ThemeSummary;
  topFive: LeaderboardEntry[];
}
