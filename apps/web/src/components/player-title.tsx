import type { PlayerTitle } from '@quiz-gomes/domain';

function Crown() {
  return (
    <svg aria-hidden="true" className="player-title__crown" viewBox="0 0 24 24">
      <path d="m3 7 4.5 4L12 4l4.5 7L21 7l-2 12H5L3 7Z" />
    </svg>
  );
}

/**
 * Título sob o nome. Top 1 em ouro com coroa, Top 2 em prata, Top 3 em
 * bronze; a luz passando pelo nome só aparece onde o título é o assunto
 * (duelo e perfil), nunca em lista.
 */
export function PlayerTitleText({ animated = false, compact = false, title }: {
  animated?: boolean;
  compact?: boolean;
  title: Pick<PlayerTitle, 'label' | 'style'> | null | undefined;
}) {
  if (title === null || title === undefined) return null;
  const metal = title.style === 'gold' || title.style === 'silver' || title.style === 'bronze';
  return (
    <span
      className={`player-title player-title--${title.style}${compact ? ' player-title--compact' : ''}${animated && metal ? ' player-title--shine' : ''}`}
    >
      {title.style === 'gold' && <Crown />}
      {(title.style === 'silver' || title.style === 'bronze') && (
        <i aria-hidden="true" className="player-title__medal">{title.style === 'silver' ? 2 : 3}</i>
      )}
      <span className="player-title__text">{title.label}</span>
    </span>
  );
}
