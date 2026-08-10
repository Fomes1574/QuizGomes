import { Button } from './button.js';

export function LoadingState({ label = 'Carregando' }: { label?: string }) {
  return <div className="state-card" role="status"><span className="spinner" aria-hidden="true" /><p>{label}</p></div>;
}

export function EmptyState({ action, description, title }: {
  action?: { label: string; onClick: () => void };
  description: string;
  title: string;
}) {
  return (
    <div className="state-card state-card--empty">
      <span className="state-card__orb" aria-hidden="true">?</span>
      <h2>{title}</h2>
      <p>{description}</p>
      {action && <Button onClick={action.onClick} variant="secondary">{action.label}</Button>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state-card state-card--error" role="alert">
      <span className="state-card__orb" aria-hidden="true">×</span>
      <h2>Algo saiu do ritmo</h2>
      <p>{message}</p>
      {onRetry && <Button onClick={onRetry} variant="secondary">Tentar novamente</Button>}
    </div>
  );
}
