// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientApiError } from '../lib/api.js';
import type * as ApiModule from '../lib/api.js';
import { PlayerPage } from '../pages/player-page.js';
import { ThemeRankingPage } from '../pages/theme-ranking-page.js';

const mocks = vi.hoisted(() => {
  const state: {
    apiRequest: ReturnType<typeof vi.fn>;
    getToken: () => Promise<string>;
    profile: null | { publicId: string; userId: string };
    refresh: ReturnType<typeof vi.fn>;
    signIn: ReturnType<typeof vi.fn>;
  } = {
    apiRequest: vi.fn(),
    getToken: () => Promise.resolve('token'),
    profile: { publicId: '#QGEU1234', userId: 'eu' },
    refresh: vi.fn(),
    signIn: vi.fn(),
  };
  return state;
});

vi.mock('../features/auth-context.js', () => ({
  useAuth: () => ({ getToken: mocks.getToken, profile: mocks.profile, signIn: mocks.signIn }),
}));
vi.mock('../features/social-context.js', () => ({ useSocial: () => ({ refresh: mocks.refresh }) }));
vi.mock('../lib/api.js', async (importOriginal) => ({
  ...await importOriginal<typeof ApiModule>(),
  apiRequest: mocks.apiRequest,
}));

const person = (name: string, publicId: string) => ({ customAvatarUrl: null, displayName: name, frameId: null, photoUrl: null, publicId });

function at(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<ThemeRankingPage />} path="/temas/:slug/ranking" />
        <Route element={<PlayerPage />} path="/jogador/:code" />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ranking completo', () => {
  afterEach(() => { cleanup(); mocks.apiRequest.mockReset(); });

  it('lista o Top, mostra a própria posição com vizinhos e liga cada nome ao perfil', async () => {
    mocks.apiRequest.mockResolvedValueOnce({
      around: { entries: [
        { ...person('Lia', '#QGLIA0001'), knowledge: 210, position: 147, self: false },
        { ...person('Eu', '#QGEU1234'), knowledge: 200, position: 149, self: true },
      ], positionCapped: false },
      entries: [{ ...person('Ana Luiza', '#QGANA0001'), knowledge: 16_400, position: 1, self: false }],
      theme: { name: 'Lost', slug: 'lost' },
    });
    at('/temas/lost/ranking');
    expect(await screen.findByRole('link', { name: 'Perfil de Ana Luiza' })).toHaveAttribute('href', '/jogador/QGANA0001');
    expect(screen.getByRole('link', { name: 'Seu perfil' })).toHaveAttribute('href', '/perfil');
    expect(screen.getByText('149')).toBeInTheDocument();
    expect(mocks.apiRequest).toHaveBeenCalledWith('/api/themes/lost/ranking', expect.anything());

    mocks.apiRequest.mockResolvedValueOnce({ entries: [{ ...person('Eu', '#QGEU1234'), knowledge: 200, position: 1, self: true }], theme: { name: 'Lost', slug: 'lost' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Amigos' }));
    expect(await screen.findByText(/Seus amigos ainda não jogaram Rankeada aqui/)).toBeInTheDocument();
    expect(mocks.apiRequest).toHaveBeenLastCalledWith('/api/themes/lost/ranking?scope=friends', expect.anything());
  });
});

describe('perfil de outro jogador', () => {
  afterEach(() => { cleanup(); mocks.apiRequest.mockReset(); mocks.profile = { publicId: '#QGEU1234', userId: 'eu' }; });

  const view = {
    comparison: [{ mine: 400, name: 'Lost', slug: 'lost', theirs: 1_300 }],
    highlights: [{ group: 'feitos', hint: '', id: 'G:STREAK_7', label: 'Chama acesa', style: 'feat' }],
    player: { ...person('Ana Luiza', '#QGANA0001'), availableAt: null, level: 12, requestId: null, title: { label: 'Ouro em Lost', style: 'rank' } },
    ranked: { draws: 0, losses: 1, matches: 4, wins: 3 },
    relationship: 'NONE',
    themes: [{ knowledge: 1_300, name: 'Lost', slug: 'lost' }],
  };

  it('mostra título, destaques, comparação e adiciona com um toque', async () => {
    mocks.apiRequest.mockResolvedValueOnce(view);
    at('/jogador/QGANA0001');
    expect(await screen.findByRole('heading', { name: 'Ana Luiza' })).toBeInTheDocument();
    expect(screen.getByText('Ouro em Lost')).toBeInTheDocument();
    expect(screen.getByText('Chama acesa')).toBeInTheDocument();
    expect(screen.getByText('Ana está 900 à frente')).toBeInTheDocument();
    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(mocks.apiRequest).toHaveBeenCalledWith('/api/players/QGANA0001', expect.anything());

    mocks.apiRequest.mockResolvedValueOnce({});
    fireEvent.click(screen.getByRole('button', { name: /Adicionar Ana/ }));
    await waitFor(() => expect(screen.getByText('Pedido enviado')).toBeInTheDocument());
    expect(mocks.apiRequest).toHaveBeenLastCalledWith('/api/social/requests', expect.objectContaining({ body: { publicId: '#QGANA0001' }, method: 'POST' }));
  });

  it('bloqueio, conta sumida ou código inválido viram "Perfil indisponível"', async () => {
    mocks.apiRequest.mockRejectedValueOnce(new ClientApiError(404, 'PLAYER_NOT_FOUND', 'Não encontramos esse jogador.'));
    at('/jogador/QGANA0001');
    expect(await screen.findByRole('heading', { name: 'Perfil indisponível' })).toBeInTheDocument();
    cleanup();
    at('/jogador/lixo');
    expect(screen.getByRole('heading', { name: 'Perfil indisponível' })).toBeInTheDocument();
  });

  it('sem conta, pede para entrar e não consulta nada', () => {
    mocks.profile = null;
    at('/jogador/QGANA0001');
    expect(screen.getByRole('heading', { name: 'Entre para ver este perfil' })).toBeInTheDocument();
    expect(mocks.apiRequest).not.toHaveBeenCalled();
  });
});
