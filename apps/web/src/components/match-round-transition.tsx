import type { CSSProperties } from 'react';

export const MATCH_ROUND_TRANSITION_MS = 1_600;

interface RoundTransitionStyle extends CSSProperties {
  '--round-transition-duration': string;
}

export function roundPresentationDelay(serverDelayMs = 0): number {
  if (!Number.isFinite(serverDelayMs)) return MATCH_ROUND_TRANSITION_MS;
  return Math.max(MATCH_ROUND_TRANSITION_MS, Math.max(0, Math.ceil(serverDelayMs)));
}

export function MatchRoundTransition({ number, total }: { number: number; total: number }) {
  const style: RoundTransitionStyle = {
    '--round-transition-duration': `${MATCH_ROUND_TRANSITION_MS}ms`,
  };

  return (
    <div
      aria-label={`Pergunta ${number} de ${total}`}
      aria-live="polite"
      className="round-transition"
      role="status"
      style={style}
    >
      <span>PERGUNTA</span>
      <strong><span>{number}</span><small>/ {total}</small></strong>
    </div>
  );
}
