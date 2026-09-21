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
  createdByUserId: string | null;
  origin: 'OFFICIAL' | 'USER';
  rejectionNote: string | null;
  revision: number;
  status: 'ACTIVE' | 'DISABLED' | 'PENDING' | 'REJECTED';
}

export interface CategoryAdmin {
  id: string;
  name: string;
  revision: number;
  slug: string;
  sortOrder: number;
  status: 'ACTIVE' | 'DISABLED';
}

export interface QuestionSourceInput {
  kind: 'BOOK' | 'OTHER' | 'PRIMARY' | 'WEB';
  title?: string;
  url: string;
}

export interface EditorialQuestionSource extends QuestionSourceInput {
  id: string;
}

export interface EditorialQuestion {
  activeSlot: number | null;
  correctOption: number;
  createdAt: string;
  createdByUserId: string | null;
  difficulty: 'EASY' | 'HARD' | 'MEDIUM';
  id: string;
  options: readonly [string, string, string, string];
  poolId: string;
  prompt: string;
  replacesQuestionId: string | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
  resolvedByUserId: string | null;
  sources: EditorialQuestionSource[];
  status: 'ACTIVE' | 'DISABLED' | 'IN_REVIEW' | 'PENDING' | 'REJECTED';
  themeId: string;
}

export interface EditorialQuestionPage {
  nextCursor: string | null;
  questions: EditorialQuestion[];
}

export interface AdminUserRecord {
  createdAt: string;
  displayName: string;
  publicId: string;
  role: 'ADMIN' | 'PLAYER';
  userId: string;
}

export interface AdminUserPage {
  nextCursor: string | null;
  users: AdminUserRecord[];
}

export interface AuditLogEntry {
  action: string;
  actorDisplayName: string | null;
  createdAt: string;
  entityId: string | null;
  entityType: string;
  id: string;
  metadata: Record<string, unknown>;
}

export interface AuditLogPage {
  entries: AuditLogEntry[];
  nextCursor: string | null;
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
  questionMetadata: {
    difficulty: 'EASY' | 'MEDIUM' | 'HARD';
    sources: Array<{ sourceKind: string; title: string | null; url: string }>;
    statistics: {
      answerCount: number;
      correctCount: number;
      optionACount: number;
      optionBCount: number;
      optionCCount: number;
      optionDCount: number;
      totalResponseMs: number;
      useCount: number;
      wrongCount: number;
    } | null;
    themeName: string;
  } | null;
  questionSnapshot: {
    correctOption: number;
    imageUrl: string | null;
    options: readonly [string, string, string, string];
    prompt: string;
  } | null;
  report: AdminQuestionReport;
}
