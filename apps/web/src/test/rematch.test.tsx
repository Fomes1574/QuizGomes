// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { MatchResultScreen } from '../components/match-result-screen.js';
import { RematchToast } from '../components/rematch-toast.js';
import { clearRematchInvite, parseRematchInvite, publishRematchInvite, rematchNavigationState } from '../lib/rematch.js';

vi.mock('../lib/feedback.js', () => ({ feedback: vi.fn(), prefersReducedMotion: () => true }));

const invite = {
  expiresAt: Date.now() + 30_000,
  fromName: 'Ana',
  matchId: '11111111-2222-3333-4444-555555555555',
  mode: 'RANKED' as const,
  themeName: 'Naruto',
  themeSlug: 'naruto',
};

describe('revanche imediata', () => {
  afterEach(() => { cleanup(); clearRematchInvite(); });

  it('valida o convite vindo do canal social', () => {
    expect(parseRematchInvite({ ...invite, type: 'REMATCH_REQUESTED' })).toEqual(invite);
    expect(parseRematchInvite({ ...invite, matchId: '../../x' })).toBeNull();
    expect(parseRematchInvite({ ...invite, mode: 'HARD' })).toBeNull();
    expect(parseRematchInvite({ ...invite, themeSlug: 'https://golpe.example' })).toBeNull();
    expect(rematchNavigationState(invite)).toEqual({ autoPlay: true, mode: 'RANKED', rematch: invite.matchId, rematchWith: 'Ana' });
  });

  it('o resultado oferece revanche e, com convite, troca por "Aceitar revanche"', () => {
    const onRequest = vi.fn();
    const onAccept = vi.fn();
    const base = {
      knowledgeAfter: 500, knowledgeDelta: 10, onBack: () => undefined,
      opponent: { name: 'Ana Luiza', result: 'LOSS' as const, score: 40 },
      viewer: { name: 'Gomes', result: 'WIN' as const, score: 70 },
      xpDelta: 30,
    };
    const { rerender } = render(<MatchResultScreen {...base} rematch={{ incoming: null, onAccept, onRequest, state: 'idle' }} />);
    fireEvent.click(screen.getByRole('button', { name: /Revanche com Ana/ }));
    expect(onRequest).toHaveBeenCalledOnce();

    rerender(<MatchResultScreen {...base} rematch={{ incoming: invite, onAccept, onRequest, state: 'idle' }} />);
    expect(screen.getByRole('status')).toHaveTextContent('Ana quer revanche!');
    expect(screen.queryByRole('button', { name: /Revanche com/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Aceitar revanche' }));
    expect(onAccept).toHaveBeenCalledWith(invite);
  });

  it('fora do resultado, o convite aparece como aviso e some ao recusar', () => {
    render(<MemoryRouter><RematchToast /></MemoryRouter>);
    act(() => { publishRematchInvite(invite); });
    expect(screen.getByRole('status')).toHaveTextContent('Ana quer revanche em Naruto!');
    fireEvent.click(screen.getByRole('button', { name: 'Recusar revanche' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
