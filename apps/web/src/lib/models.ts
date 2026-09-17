import type { ReportContextKind, ReportReason, ReportStatus, ThemeArtwork } from '@quiz-gomes/domain';

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
  customAvatarUrl: string | null;
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

export interface AdminQuestionReport {
  contextId: string;
  contextKind: ReportContextKind;
  createdAt: string;
  id: string;
  note: string | null;
  questionId: string;
  reason: ReportReason;
  resolutionNote: string | null;
  resolvedAt: string | null;
  resolvedByUserId: string | null;
  roundNumber: number;
  status: ReportStatus;
}

export interface AdminQuestionReportEntry {
  questionSnapshot: {
    correctOption: number;
    imageUrl: string | null;
    options: readonly [string, string, string, string];
    prompt: string;
  } | null;
  report: AdminQuestionReport;
}
