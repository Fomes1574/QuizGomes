// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ThemeDetailPage } from '../pages/theme-detail-page.js';

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  challenge: vi.fn(() => Promise.resolve()),
  getToken: vi.fn(() => Promise.resolve('synthetic-auth')),
  presence: new Map<string, { presence: string; publicId: string; queueThemeId?: string; revision: number }>(),
  profile: { displayName: 'Dono', publicId: '#QGOWNER1' },
  start: vi.fn(() => Promise.resolve()),
}));

vi.mock('../features/auth-context.js', () => ({
  useAuth: () => ({ getToken: mocks.getToken, profile: mocks.profile, signIn: vi.fn() }),
}));
vi.mock('../features/social-context.js', () => ({
  useFriendPresence: () => mocks.presence,
  useQueueActivity: () => new Map(),
}));
vi.mock('../hooks/use-matchmaking.js', () => ({
  useMatchmaking: () => ({ error: null, start: mocks.start, status: 'idle' }),
}));
vi.mock('../hooks/use-friend-challenge.js', () => ({
  useFriendChallenge: () => ({ challenge: mocks.challenge, error: null, status: 'idle' }),
}));
vi.mock('../lib/api.js', () => ({ apiRequest: mocks.apiRequest }));

const ana = {
  customAvatarUrl: null, displayName: 'Ana', frameId: null, photoUrl: null, publicId: '#QGANA1',
};

const theme = {
  personal: null,
  theme: {
    activeQuestionCount: 40,
    artwork: { kind: 'NONE', version: 1 },
    categoryName: 'Games',
    description: 'Tema de teste.',
    id: 'theme-1',
    name: 'Elden Ring',
    slug: 'elden-ring',
  },
  topFive: [],
};

function page(entry = '/tema/elden-ring') {
  return (
    <MemoryRouter initialEntries={[entry]}>
      <Routes><Route element={<ThemeDetailPage />} path="/tema/:slug" /></Routes>
    </MemoryRouter>
  );
}

describe('desafiar amigo a partir do tema', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_ENABLE_REALTIME_MATCHES', 'true');
    mocks.apiRequest.mockReset();
    mocks.challenge.mockClear();
    mocks.presence = new Map([['#QGANA1', { presence: 'ONLINE', publicId: '#QGANA1', revision: 1 }]]);
    mocks.apiRequest.mockImplementation((path: string) => {
      if (path === '/api/social') return Promise.resolve({ friends: [ana], incoming: [], outgoing: [] });
      return Promise.resolve(theme);
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  it('o link "Me chama nessa fila" entra na fila do modo pedido uma única vez', async () => {
    mocks.start.mockClear();
    mocks.presence = new Map([['#QGANA1', { presence: 'MATCHMAKING', publicId: '#QGANA1', queueThemeId: 'theme-1', revision: 2 }]]);
    render(page('/tema/elden-ring?jogar=rankeada'));
    await waitFor(() => expect(mocks.start).toHaveBeenCalledWith('theme-1', 'RANKED', 'elden-ring', 'Elden Ring'));
    expect(mocks.start).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Ana está na fila deste tema agora.')).toBeInTheDocument();
  });

  it('só oferece "Desafiar amigo" na Partida normal', async () => {
    render(page());
    expect(await screen.findByRole('button', { name: 'Desafiar amigo' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'Partida rankeada' }));
    // Desafio entre amigos é sempre Casual: em Ranqueada o botão nem existe.
    expect(screen.queryByRole('button', { name: 'Desafiar amigo' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'Partida normal' }));
    expect(screen.getByRole('button', { name: 'Desafiar amigo' })).toBeInTheDocument();
  });

  it('trocar para Partida rankeada fecha o seletor já aberto', async () => {
    render(page());
    fireEvent.click(await screen.findByRole('button', { name: 'Desafiar amigo' }));
    expect(await screen.findByRole('heading', { name: 'Desafiar amigo' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'Partida rankeada' }));

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Desafiar amigo' })).not.toBeInTheDocument();
    });
  });

  it('"Agora" exige amigo Online; "Depois" vale em qualquer presença', async () => {
    mocks.presence = new Map([['#QGANA1', { presence: 'OFFLINE', publicId: '#QGANA1', revision: 1 }]]);
    render(page());
    fireEvent.click(await screen.findByRole('button', { name: 'Desafiar amigo' }));

    const now = await screen.findByRole('button', { name: 'Agora' });
    const later = screen.getByRole('button', { name: 'Depois' });
    expect(now).toBeDisabled();
    expect(later).toBeEnabled();

    fireEvent.click(later);
    expect(mocks.challenge).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'ASYNC', publicId: '#QGANA1',
    }));
  });

  it('o diálogo deixa claro que o desafio é sempre Casual, com 7 perguntas', async () => {
    render(page());
    fireEvent.click(await screen.findByRole('button', { name: 'Desafiar amigo' }));
    expect(await screen.findByText(/sempre Casual, com 7 perguntas/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Agora' }));

    expect(mocks.challenge).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'DIRECT', publicId: '#QGANA1',
    }));
  });
});
