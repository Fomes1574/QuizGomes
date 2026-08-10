import { rankedAbandonmentLoss } from '../progression/ranking.js';
import type { MatchMode } from '../types.js';

export const RECONNECT_GRACE_MS = 7_000;

export type ConnectionResolution =
  | { kind: 'WAITING'; remainingGraceMs: number }
  | { disconnectedKnowledgeDelta: 0; kind: 'VOID_SYSTEM' }
  | { disconnectedKnowledgeDelta: number; kind: 'VOID_INDIVIDUAL' };

export function resolveConnectionLoss(input: {
  disconnectedKnowledge: number;
  disconnectedPlayers: 1 | 2;
  elapsedMs: number;
  infrastructureFailure: boolean;
  mode: MatchMode;
}): ConnectionResolution {
  const elapsedMs = Math.max(0, input.elapsedMs);
  if (elapsedMs < RECONNECT_GRACE_MS) {
    return { kind: 'WAITING', remainingGraceMs: RECONNECT_GRACE_MS - elapsedMs };
  }
  if (input.infrastructureFailure || input.disconnectedPlayers === 2) {
    return { disconnectedKnowledgeDelta: 0, kind: 'VOID_SYSTEM' };
  }
  return {
    disconnectedKnowledgeDelta: input.mode === 'RANKED'
      ? rankedAbandonmentLoss(input.disconnectedKnowledge).appliedDelta
      : 0,
    kind: 'VOID_INDIVIDUAL',
  };
}
