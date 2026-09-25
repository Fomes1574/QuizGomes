import { questionsForMode } from '@quiz-gomes/domain';
import type { CSSProperties, PointerEvent } from 'react';
import { Link } from 'react-router-dom';
import { prefersReducedMotion } from '../lib/feedback.js';
import type { ThemeSummary } from '../lib/models.js';
import { Icon } from './icons.js';
import { ThemeArtwork } from './theme-artwork.js';

const accents = ['ember', 'rose', 'plum', 'copper', 'ruby'] as const;

function accent(theme: ThemeSummary): string {
  let sum = 0;
  for (const character of theme.id) sum += character.charCodeAt(0);
  return accents[sum % accents.length] ?? 'ember';
}

/** Mesmo limiar do servidor: Normal abre com 7 perguntas ativas, Rankeada com 10. */
function availability(count: number): { label: string; tone: 'full' | 'normal' | 'soon' } {
  if (count >= questionsForMode('RANKED')) return { label: 'Normal e Rankeada', tone: 'full' };
  if (count >= questionsForMode('CASUAL')) return { label: 'Partida normal', tone: 'normal' };
  return { label: 'Em preparo', tone: 'soon' };
}

function tilt(event: PointerEvent<HTMLAnchorElement>): void {
  // Inclinação só com mouse: no toque ela brigaria com o scroll horizontal.
  if (event.pointerType !== 'mouse' || prefersReducedMotion()) return;
  const card = event.currentTarget;
  const bounds = card.getBoundingClientRect();
  const x = (event.clientX - bounds.left) / bounds.width;
  const y = (event.clientY - bounds.top) / bounds.height;
  card.style.setProperty('--tilt-x', `${((0.5 - y) * 9).toFixed(2)}deg`);
  card.style.setProperty('--tilt-y', `${((x - 0.5) * 11).toFixed(2)}deg`);
  card.style.setProperty('--shine-x', `${(x * 100).toFixed(1)}%`);
}

function resetTilt(event: PointerEvent<HTMLAnchorElement>): void {
  const card = event.currentTarget;
  card.style.removeProperty('--tilt-x');
  card.style.removeProperty('--tilt-y');
  card.style.removeProperty('--shine-x');
}

export function ThemeCard({ index = 0, theme }: { index?: number; theme: ThemeSummary }) {
  const status = availability(theme.activeQuestionCount);
  return (
    <Link
      className={`theme-card theme-card--${accent(theme)}`}
      onPointerLeave={resetTilt}
      onPointerMove={tilt}
      style={{ '--card-index': index } as CSSProperties}
      to={`/temas/${theme.slug}`}
    >
      <span className="theme-card__frame">
        <ThemeArtwork artwork={theme.artwork} className="theme-card__art" name={theme.name} />
        <span aria-hidden="true" className="theme-card__shine" />
        <span className={`theme-card__status theme-card__status--${status.tone}`}>{status.label}</span>
      </span>
      <span className="theme-card__body">
        <small>{theme.categoryName}</small>
        <strong>{theme.name}</strong>
        <span className="theme-card__meta"><Icon name="bolt" />{theme.activeQuestionCount.toLocaleString('pt-BR')} perguntas</span>
      </span>
    </Link>
  );
}
