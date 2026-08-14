// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

  it('abre no top layer, torna o AppShell inerte e confina Tab no Cancelar', () => {
    const navigate = vi.fn();
    render(
      <>
        <div className="app-shell">
          <header><button aria-label="Abrir perfil" onClick={navigate} type="button">Perfil</button></header>
          <nav aria-label="Navegação principal">
            {['Temas', 'Social', 'Criar', 'Perfil'].map((label) => (
              <button key={label} onClick={navigate} type="button">{label}</button>
            ))}
          </nav>
        </div>
        <MatchmakingDialog
          elapsedSeconds={8}
          onCancel={() => undefined}
          onClose={() => undefined}
          opponent={null}
          preparing={false}
          status="searching"
          theme={theme}
        />
      </>,
    );

    const shell = document.querySelector('.app-shell');
    const dialog = screen.getByRole('dialog', { name: 'PROCURANDO ADVERSÁRIO' });
    const cancel = screen.getByRole('button', { name: 'Cancelar' });
    expect(dialog).toBeInstanceOf(HTMLDialogElement);
    expect(dialog).toHaveAttribute('open');
    expect(shell).toHaveAttribute('inert');
    expect(shell).toHaveAttribute('aria-hidden', 'true');
    expect(cancel).toHaveFocus();

    for (const button of document.querySelectorAll('.app-shell button')) fireEvent.click(button);
    expect(navigate).not.toHaveBeenCalled();
    fireEvent.keyDown(cancel, { key: 'Tab' });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true });
    expect(cancel).toHaveFocus();
  });

  it('Escape equivale a Cancelar durante a busca', () => {
    const onCancel = vi.fn();
    render(<MatchmakingDialog
      elapsedSeconds={3}
      onCancel={onCancel}
      onClose={() => undefined}
      opponent={null}
      preparing={false}
      status="searching"
      theme={theme}
    />);

    const event = new Event('cancel', { cancelable: true });
    fireEvent(screen.getByRole('dialog'), event);
    expect(event.defaultPrevented).toBe(true);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('mantém o fundo bloqueado na apresentação do adversário', () => {
    const navigate = vi.fn();
    render(
      <>
        <div className="app-shell"><button onClick={navigate} type="button">Temas</button></div>
        <MatchmakingDialog
          elapsedSeconds={12}
          onCancel={() => undefined}
          onClose={() => undefined}
          opponent={{
            customAvatarUrl: null,
            displayName: 'Adversário Real',
            frameId: null,
            knowledge: 500,
            photoUrl: null,
          }}
          preparing={false}
          status="presenting-opponent"
          theme={theme}
        />
      </>,
    );

    expect(document.querySelector('.app-shell')).toHaveAttribute('inert');
    fireEvent.click(screen.getByRole('button', { name: 'Temas', hidden: true }));
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Cancelar', hidden: true })).toBeDisabled();
  });

  it('mantém timeout modal até Voltar ao tema e então restaura interação e foco', () => {
    const searchButton = document.createElement('button');
    searchButton.textContent = 'Buscar partida';
    const appShell = document.createElement('div');
    appShell.className = 'app-shell';
    appShell.append(searchButton);
    document.body.append(appShell);
    searchButton.focus();
    const onClose = vi.fn();
    const view = render(<MatchmakingDialog
      elapsedSeconds={60}
      onCancel={() => undefined}
      onClose={onClose}
      opponent={null}
      preparing={false}
      status="timed-out"
      theme={theme}
    />);

    const close = screen.getByRole('button', { name: 'Voltar ao tema' });
    expect(appShell).toHaveAttribute('inert');
    expect(close).toHaveFocus();
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(appShell).toHaveAttribute('inert');

    view.unmount();
    expect(appShell).not.toHaveAttribute('inert');
    expect(appShell).not.toHaveAttribute('aria-hidden');
    expect(searchButton).toHaveFocus();
    appShell.remove();
  });
});
