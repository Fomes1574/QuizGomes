export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`brand-lockup${compact ? ' brand-lockup--compact' : ''}`} aria-label="QUIZ GOMES">
      <span className="brand-lockup__mark" aria-hidden="true" />
      {!compact && <span className="brand-lockup__name">QUIZ GOMES</span>}
    </span>
  );
}
