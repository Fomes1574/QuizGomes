export const MATCH_ROUND_TRANSITION_MS = 900;

export function roundPresentationDelay(serverDelayMs = 0): number {
  if (!Number.isFinite(serverDelayMs)) return MATCH_ROUND_TRANSITION_MS;
  return Math.max(MATCH_ROUND_TRANSITION_MS, Math.max(0, Math.ceil(serverDelayMs)));
}

export function MatchRoundTransition({ number, total }: { number: number; total: number }) {
  return (
    <div
      aria-label={`Pergunta ${number} de ${total}`}
      aria-live="polite"
      className="round-transition"
      role="status"
    >
      <span>PERGUNTA</span>
      <strong><span>{number}</span><small>/ {total}</small></strong>
    </div>
  );
}
