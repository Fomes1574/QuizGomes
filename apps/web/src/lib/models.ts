import type { ThemeArtwork } from '@quiz-gomes/domain';

export interface Category {
  id: string;
  name: string;
  slug: string;
}

export interface ThemeSummary {
  activeQuestionCount: number;
  artwork: ThemeArtwork;
  categoryId: string;
  categoryName: string;
  coverImageKey: string | null;
  description: string;
  id: string;
  name: string;
  slug: string;
}

export interface AdminThemeSummary extends ThemeSummary {
  status: 'ACTIVE' | 'DISABLED' | 'PENDING' | 'REJECTED';
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
