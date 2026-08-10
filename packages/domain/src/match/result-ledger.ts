import { clampKnowledge } from '../progression/ranking.js';
import { TOTAL_XP_TO_MAX_LEVEL } from '../progression/xp.js';

export interface ProgressState {
  knowledge: number;
  totalXp: number;
}

export interface ProgressDelta {
  knowledge: number;
  xp: number;
}

export interface IdempotentProgressResult {
  applied: boolean;
  ledger: ReadonlySet<string>;
  state: ProgressState;
}

export function applyProgressOnce(
  state: ProgressState,
  ledger: ReadonlySet<string>,
  resultKey: string,
  delta: ProgressDelta,
): IdempotentProgressResult {
  if (resultKey.trim().length === 0) throw new Error('Chave de resultado obrigatória.');
  if (ledger.has(resultKey)) return { applied: false, ledger, state: { ...state } };
  const nextLedger = new Set(ledger);
  nextLedger.add(resultKey);
  return {
    applied: true,
    ledger: nextLedger,
    state: {
      knowledge: clampKnowledge(state.knowledge + Math.trunc(delta.knowledge)),
      totalXp: Math.min(TOTAL_XP_TO_MAX_LEVEL, Math.max(0, Math.trunc(state.totalXp + delta.xp))),
    },
  };
}
