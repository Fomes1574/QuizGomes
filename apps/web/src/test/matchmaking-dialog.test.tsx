// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatchmakingDialog } from '../components/matchmaking-dialog.js';
import {
  MATCH_FOUND_ENTRY_MS,
  MATCH_FOUND_EXIT_MS,
  MATCH_FOUND_HOLD_MS,
  MATCH_FOUND_PRESENTATION_MS,
} from '../hooks/use-matchmaking.js';
import type { ThemeSummary } from '../lib/models.js';

const theme: ThemeSummary = {
  activeQuestionCount: 30,
  artwork: { kind: 'NONE', version: 0 },
  categoryId: 'games',
  categoryName: 'Games',
  coverImageKey: null,
  description: 'Fixture sintética.',
  id: 'theme-games',
  name: 'Games em Geral',
  slug: 'games-em-geral',
};

describe('fechamento visual do matchmaking', () => {
  afterEach(() => cleanup());

  it('mostra arte, timer autoritativo, globo, personagens, lupa e Cancelar vermelho sem o texto antigo', () => {
    const onCancel = vi.fn();
    render(<MatchmakingDialog
      elapsedSeconds={0}
      onCancel={onCancel}
      onClose={() => undefined}
      opponent={null}
      preparing={false}
      status="searching"
      theme={theme}
    />);

    expect(screen.getByText('Games em Geral')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'PROCURANDO ADVERSÁRIO' })).toBeInTheDocument();
    expect(screen.getByRole('timer', { name: '0 segundos de 60' })).toHaveTextContent('00:00 / 01:00');
    expect(screen.queryByText(/mesma dificuldade e modo/i)).not.toBeInTheDocument();
    expect(document.querySelector('.matchmaking-globe__sphere')).toBeInTheDocument();
    expect(document.querySelectorAll('.globe-character')).toHaveLength(4);
    expect(document.querySelector('.matchmaking-magnifier')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveClass('button--primary');
    expect(screen.getByRole('button', { name: 'Cancelar' })).not.toHaveClass('button--secondary');
  });

  it('apresenta somente identidade e elo temático autoritativos do adversário', () => {
    render(<MatchmakingDialog
      elapsedSeconds={17}
      onCancel={() => undefined}
      onClose={() => undefined}
      opponent={{
        customAvatarUrl: '/api/avatars/user-real/v4.webp',
        displayName: 'Ana Real',
        frameId: 'frame-real',
        knowledge: 0,
        photoUrl: 'https://lh3.googleusercontent.com/foto-real',
      }}
      preparing
      status="presenting-opponent"
      theme={theme}
    />);

    expect(screen.getByText('JOGADOR ENCONTRADO')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ana Real' })).toBeInTheDocument();
    expect(document.querySelector('.match-found img')).toHaveAttribute('src', '/api/avatars/user-real/v4.webp');
    expect(document.querySelector('[data-frame-id="frame-real"]')).toBeInTheDocument();
    expect(screen.getByText(/Latão/)).toBeInTheDocument();
    expect(screen.getByText('Preparando partida...')).toBeInTheDocument();
    expect(screen.queryByText(/XP|win rate|nível/i)).not.toBeInTheDocument();
  });

  it('mantém os 2,9 s divididos em entrada suave, permanência e saída perceptível', () => {
    expect(MATCH_FOUND_ENTRY_MS).toBe(1_200);
    expect(MATCH_FOUND_HOLD_MS).toBe(800);
    expect(MATCH_FOUND_EXIT_MS).toBe(900);
    expect(MATCH_FOUND_ENTRY_MS + MATCH_FOUND_HOLD_MS + MATCH_FOUND_EXIT_MS)
      .toBe(MATCH_FOUND_PRESENTATION_MS);
  });
});
