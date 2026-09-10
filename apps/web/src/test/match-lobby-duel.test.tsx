// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MatchLobbyDuel } from '../components/match-lobby-duel.js';
import { clearDuelHandoff, takeDuelOrigin } from '../lib/match-handoff.js';

const viewer = { customAvatarUrl: null, displayName: 'Gomes', frameId: null, photoUrl: null };
const opponent = { customAvatarUrl: null, displayName: 'Ana', frameId: null, photoUrl: null };

describe('line-up do lobby da partida', () => {
  afterEach(() => {
    cleanup();
    clearDuelHandoff();
  });

  it('mostra os dois jogadores sem elo nem número competitivo', () => {
    render(<MatchLobbyDuel opponent={opponent} roomId="room-1" viewer={viewer} />);

    expect(screen.getByText('Gomes')).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByText('Você')).toBeInTheDocument();
    expect(screen.getByText('Adversário')).toBeInTheDocument();
    // O lobby não tem valor autoritativo de Conhecimento para exibir.
    expect(document.querySelector('.rank-badge')).not.toBeInTheDocument();
    expect(screen.queryByText(/Conhecimento/)).not.toBeInTheDocument();
  });

  it('marca as âncoras dos dois assentos para a continuidade até o placar', () => {
    render(<MatchLobbyDuel opponent={opponent} roomId="room-1" viewer={viewer} />);

    expect(document.querySelector('[data-duel-flip="viewer"]')).toBeInTheDocument();
    expect(document.querySelector('[data-duel-flip="opponent"]')).toBeInTheDocument();
  });

  it('não publica geometria inutilizável quando a tela ainda não tem layout medido', () => {
    render(<MatchLobbyDuel opponent={opponent} roomId="room-1" viewer={viewer} />);

    // Em jsdom todo retângulo é zero: nada é guardado e o placar simplesmente não anima.
    expect(takeDuelOrigin('room-1', 'lobby', 'viewer')).toBeNull();
  });
});
