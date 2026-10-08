/**
 * Esqueletos com o formato da tela que vai chegar: a página já "existe"
 * enquanto os dados vêm, e nada pula de lugar quando eles chegam.
 * O texto fica só para leitor de tela.
 */

function Bar({ className = '' }: { className?: string }) {
  return <span aria-hidden="true" className={`skeleton skeleton-bar ${className}`} />;
}

export function RankingListSkeleton({ label = 'Abrindo o ranking', rows = 8 }: { label?: string; rows?: number }) {
  return (
    <div className="skeleton-stack" role="status">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <div aria-hidden="true" className="skeleton-row" key={index}>
          <Bar className="skeleton-bar--dot" />
          <span className="skeleton skeleton-avatar" />
          <span className="skeleton-row__copy"><Bar className="skeleton-bar--name" /><Bar className="skeleton-bar--small" /></span>
          <span className="skeleton skeleton-badge" />
        </div>
      ))}
    </div>
  );
}

export function PlayerSkeleton() {
  return (
    <section className="page page--narrow player-page" role="status">
      <span className="sr-only">Abrindo perfil</span>
      <div aria-hidden="true" className="player-hero skeleton-hero">
        <span className="skeleton skeleton-avatar skeleton-avatar--large" />
        <span className="skeleton-row__copy"><Bar className="skeleton-bar--chip" /><Bar className="skeleton-bar--title" /><Bar className="skeleton-bar--name" /></span>
      </div>
      <span aria-hidden="true" className="skeleton skeleton-card" />
      <span aria-hidden="true" className="skeleton skeleton-card skeleton-card--short" />
    </section>
  );
}

export function ThemeDetailSkeleton() {
  return (
    <section className="page skeleton-theme" role="status">
      <span className="sr-only">Abrindo o tema</span>
      <span aria-hidden="true" className="skeleton skeleton-theme__hero" />
      <div aria-hidden="true" className="skeleton-theme__grid">
        <span className="skeleton skeleton-card" />
        <span className="skeleton skeleton-card" />
      </div>
    </section>
  );
}

export function TitleShowcaseSkeleton() {
  return (
    <div aria-hidden="true" className="title-showcase skeleton-showcase">
      <span className="skeleton skeleton-card skeleton-card--tall" />
      <span className="skeleton skeleton-card skeleton-card--tall" />
    </div>
  );
}
