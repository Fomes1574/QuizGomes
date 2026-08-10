import { Link } from 'react-router-dom';
import type { ThemeSummary } from '../lib/models.js';
import { Icon } from './icons.js';

const accents = ['ember', 'rose', 'plum', 'copper', 'ruby'] as const;

function accent(theme: ThemeSummary): string {
  let sum = 0;
  for (const character of theme.id) sum += character.charCodeAt(0);
  return accents[sum % accents.length] ?? 'ember';
}

export function ThemeCard({ theme }: { theme: ThemeSummary }) {
  return (
    <Link className={`theme-card theme-card--${accent(theme)}`} to={`/temas/${theme.slug}`}>
      <span className="theme-card__art" aria-hidden="true">
        <span>{theme.name.slice(0, 2).toLocaleUpperCase('pt-BR')}</span>
      </span>
      <span className="theme-card__body">
        <small>{theme.categoryName}</small>
        <strong>{theme.name}</strong>
        <span>{theme.activeQuestionCount.toLocaleString('pt-BR')} perguntas</span>
      </span>
      <Icon className="theme-card__arrow" name="back" />
    </Link>
  );
}
