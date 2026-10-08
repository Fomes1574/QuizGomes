// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { WeeklyMissionsCard, weekCountdown } from '../components/profile-sections.js';
import { ThemeTrail } from '../components/theme-trail.js';

describe('missões da semana', () => {
  afterEach(() => cleanup());

  it('mostra o progresso das três e quando a semana vira', () => {
    render(<WeeklyMissionsCard
      missions={[
        { completedAt: null, progress: 4, target: 10, type: 'PLAY_RANKED' },
        { completedAt: '2026-10-08T12:00:00Z', progress: 5, target: 5, type: 'WIN_RANKED' },
        { completedAt: null, progress: 12, target: 40, type: 'CORRECT_RANKED' },
      ]}
      resetAt={new Date(Date.now() + (3 * 24 + 5) * 3_600_000 + 60_000).toISOString()}
    />);
    expect(screen.getByText('Jogue Rankeadas até o fim')).toBeInTheDocument();
    expect(screen.getByText('4/10')).toBeInTheDocument();
    expect(screen.getByText(/Viram em 3 d 5 h/)).toBeInTheDocument();
    expect(screen.getByText('Só a Rankeada conta. A semana vira na segunda, 0h.')).toBeInTheDocument();
  });

  it('contagem curta no último dia', () => {
    expect(weekCountdown(Date.now() + 90 * 60_000, Date.now())).toBe('1 h 30 min');
  });
});

describe('trilha do tema', () => {
  afterEach(() => cleanup());

  it('mostra o próximo título com quanto falta e marca o objetivo', () => {
    render(<ThemeTrail
      goalId="T:lost:TIER_SILVER"
      steps={[
        { id: 'T:lost:FIRST_WIN', label: 'Estreou vencendo em Lost', progress: null, style: 'feat', unlocked: true },
        { id: 'T:lost:TIER_BRONZE', label: 'Bronze em Lost', progress: { ratio: 0.8, text: 'faltam 500 de Conhecimento' }, style: 'rank', unlocked: false },
        { id: 'T:lost:TIER_SILVER', label: 'Prata em Lost', progress: { ratio: 0.2, text: 'faltam 5.000 de Conhecimento' }, style: 'rank', unlocked: false },
      ]}
      themeName="Lost"
    />);
    expect(screen.getByRole('heading', { name: 'Títulos de Lost' })).toBeInTheDocument();
    expect(screen.getByText('1 de 3')).toBeInTheDocument();
    expect(screen.getByText('Próximo título')).toBeInTheDocument();
    expect(screen.getAllByText('faltam 500 de Conhecimento').length).toBeGreaterThan(0);
    expect(screen.getByText('Bronze')).toBeInTheDocument(); // rótulo curto no caminho
    expect(screen.getByText(/seu objetivo/)).toBeInTheDocument();
  });
});
