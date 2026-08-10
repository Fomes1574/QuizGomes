export const QUESTION_DURATION_MS = 10_000;

export function displayedSeconds(remainingMs: number): number {
  if (!Number.isFinite(remainingMs)) return 0;
  return Math.min(10, Math.max(0, Math.ceil(remainingMs / 1_000)));
}

export function scoreAnswer(correct: boolean, remainingMs: number): number {
  if (!correct || remainingMs <= 0) return 0;
  return 10 + displayedSeconds(remainingMs);
}

export function remainingAt(serverNowMs: number, deadlineMs: number): number {
  if (!Number.isFinite(serverNowMs) || !Number.isFinite(deadlineMs)) return 0;
  return Math.max(0, deadlineMs - serverNowMs);
}
