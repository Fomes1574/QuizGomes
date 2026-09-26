// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatchmakingDialog } from '../components/matchmaking-dialog.js';
import {
  MATCH_FOUND_ENTRY_MS,
  MATCH_FOUND_EXIT_MS,
  MATCH_FOUND_HOLD_MS,
  MATCH_FOUND_PRESENTATION_MS,
} from '../lib/matchmaking-presentation.js';
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
  beforeEach(() => {
    // Este arquivo verifica estrutura e acessibilidade; manter movimento reduzido
    // evita RAFs decorativos competirem com o limite do runner compartilhado.
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

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
    expect(screen.getByRole('heading', { name: 'Procurando adversário' })).toBeInTheDocument();
    expect(screen.getByRole('timer', { name: '0 segundos de 60' })).toHaveTextContent('0:00');
    expect(screen.queryByText(/mesma dificuldade e modo/i)).not.toBeInTheDocument();
    expect(document.querySelector('.matchmaking-radar__card')).toBeInTheDocument();
    expect(document.querySelectorAll('.matchmaking-radar__seat')).toHaveLength(5);
    // Cancelar é ação secundária: o destaque da tela é a busca, não a desistência.
    expect(screen.getByRole('button', { name: 'Cancelar busca' })).not.toHaveClass('button--primary');
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

  it('divide os 3,3 s em entrada coreografada, permanência e saída perceptível', () => {
    expect(MATCH_FOUND_ENTRY_MS).toBe(1_200);
    expect(MATCH_FOUND_HOLD_MS).toBe(1_200);
    expect(MATCH_FOUND_EXIT_MS).toBe(900);
    // A coreografia do duelo assenta em ~1,3 s e a permanência cobre o resto da janela visível.
    expect(MATCH_FOUND_ENTRY_MS + MATCH_FOUND_HOLD_MS).toBe(2_400);
    expect(MATCH_FOUND_ENTRY_MS + MATCH_FOUND_HOLD_MS + MATCH_FOUND_EXIT_MS)
      .toBe(MATCH_FOUND_PRESENTATION_MS);
  });

  it('compõe o duelo com os dois jogadores, o contexto da partida e as âncoras de continuidade', () => {
    render(<MatchmakingDialog
      elapsedSeconds={22}
      mode="RANKED"
      onCancel={() => undefined}
      onClose={() => undefined}
      opponent={{
        customAvatarUrl: null,
        displayName: 'Ana Real',
        frameId: 'frame-real',
        knowledge: 1_980,
        photoUrl: null,
      }}
      preparing={false}
      status="presenting-opponent"
      theme={theme}
      viewer={{
        customAvatarUrl: null,
        displayName: 'Matheus',
        frameId: null,
        knowledge: 1_240,
        photoUrl: null,
      }}
    />);

    expect(screen.getByText('JOGADOR ENCONTRADO')).toBeInTheDocument();
    expect(screen.getByText('Você')).toBeInTheDocument();
    expect(screen.getByText('Adversário')).toBeInTheDocument();
    expect(screen.getByText('Matheus')).toBeInTheDocument();
    // O adversário continua sendo o título acessível do diálogo.
    expect(screen.getByRole('heading', { name: 'Ana Real' })).toHaveAttribute('id', 'matchmaking-found-title');
    expect(screen.getByText('Partida rankeada · 10 perguntas')).toBeInTheDocument();
    expect(document.querySelector('.duel-side--viewer .sr-only')).toHaveTextContent('1.240 Conhecimento');
    expect(document.querySelector('.duel-side--opponent .sr-only')).toHaveTextContent('1.980 Conhecimento');
    // O acento cromático segue exatamente a liga do selo, sem tabela paralela.
    expect(document.querySelector('.duel-side--opponent')).toHaveClass('duel-side--brass');
    expect(document.querySelector('.duel-side--opponent .rank-badge')).toHaveClass('rank-badge--brass');
    expect(document.querySelector('[data-duel-flip="viewer"]')).toBeInTheDocument();
    expect(document.querySelector('[data-duel-flip="opponent"]')).toBeInTheDocument();
    expect(screen.queryByText(/XP|win rate|nível/i)).not.toBeInTheDocument();
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
    const dialog = screen.getByRole('dialog', { name: 'Procurando adversário' });
    const cancel = screen.getByRole('button', { name: 'Cancelar busca' });
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
    expect(screen.getByRole('button', { name: 'Cancelar busca', hidden: true })).toBeDisabled();
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
