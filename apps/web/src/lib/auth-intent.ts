import type { Difficulty, MatchMode } from '@quiz-gomes/domain';

const KEY = 'quiz-gomes.auth-intent.v1';
const TTL_MS = 15 * 60 * 1_000;

export interface PlayAuthIntent {
  createdAt: number;
  difficulty: Difficulty;
  mode: MatchMode;
  themeId: string;
  themeSlug: string;
  type: 'PLAY';
}

function storage(): Storage | null {
  try { return window.sessionStorage; } catch { return null; }
}

export function savePlayAuthIntent(intent: Omit<PlayAuthIntent, 'createdAt' | 'type'>): void {
  storage()?.setItem(KEY, JSON.stringify({ ...intent, createdAt: Date.now(), type: 'PLAY' satisfies PlayAuthIntent['type'] }));
}

export function consumePlayAuthIntent(): PlayAuthIntent | null {
  const value = storage()?.getItem(KEY);
  storage()?.removeItem(KEY);
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value) as Partial<PlayAuthIntent>;
    if (parsed.type !== 'PLAY' || !Number.isFinite(parsed.createdAt) || Date.now() - Number(parsed.createdAt) > TTL_MS ||
      (parsed.difficulty !== 'EASY' && parsed.difficulty !== 'MEDIUM' && parsed.difficulty !== 'HARD') ||
      (parsed.mode !== 'CASUAL' && parsed.mode !== 'RANKED') ||
      typeof parsed.themeId !== 'string' || typeof parsed.themeSlug !== 'string') return null;
    return parsed as PlayAuthIntent;
  } catch { return null; }
}

export function clearAuthIntent(): void { storage()?.removeItem(KEY); }
