import { Link } from 'react-router-dom';
import type { ThemeSummary } from '../lib/models.js';
import { Icon } from './icons.js';
import { ThemeArtwork } from './theme-artwork.js';

const accents = ['ember', 'rose', 'plum', 'copper', 'ruby'] as const;

function accent(theme: ThemeSummary): string {
  let sum = 0;
  for (const character of theme.id) sum += character.charCodeAt(0);
  return accents[sum % accents.length] ?? 'ember';
}

export function ThemeCard({ theme }: { theme: ThemeSummary }) {
  return (
    <Link className={`theme-card theme-card--${accent(theme)}`} to={`/temas/${theme.slug}`}>
      <ThemeArtwork artwork={theme.artwork} className="theme-card__art" name={theme.name} />
      <span className="theme-card__body">
        <small>{theme.categoryName}</small>
        <strong>{theme.name}</strong>
        <span>{theme.activeQuestionCount.toLocaleString('pt-BR')} perguntas</span>
      </span>
      <Icon className="theme-card__arrow" name="back" />
    </Link>
  );
}
