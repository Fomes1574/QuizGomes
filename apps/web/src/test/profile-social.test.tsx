// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfilePage } from '../pages/profile-page.js';

const mocks = vi.hoisted(() => ({
  activate: vi.fn(() => Promise.resolve<'denied' | 'granted'>('granted')),
  apiRequest: vi.fn(),
  getToken: vi.fn(() => Promise.resolve('fixture-auth')),
  notificationState: 'prompt',
  profile: {
    customAvatarUrl: null,
    displayName: 'Perfil Real',
    equippedFrameId: null,
    photoUrl: null,
    publicId: '#QGPERFIL1',
    totalXp: 0,
  },
  pushConfigured: true,
  refresh: vi.fn(() => Promise.resolve()),
}));

vi.mock('../features/auth-context.js', () => ({
  useAuth: () => ({
    error: null,
    firebaseUser: { displayName: 'Perfil Real', photoURL: null },
    getToken: mocks.getToken,
    profile: mocks.profile,
    removeCustomAvatar: vi.fn(),
    role: 'PLAYER',
    signIn: vi.fn(),
    signOut: vi.fn(),
    updateDisplayName: vi.fn(),
    uploadCustomAvatar: vi.fn(),
  }),
}));
vi.mock('../features/social-context.js', () => ({
  useSocial: () => ({ pushConfigured: mocks.pushConfigured, refresh: mocks.refresh }),
}));
vi.mock('../hooks/use-theme-mode.js', () => ({
  useThemeMode: () => ({ mode: 'system', setMode: vi.fn() }),
}));
vi.mock('../lib/api.js', () => ({ apiRequest: mocks.apiRequest }));
vi.mock('../lib/social-notifications.js', () => ({
  activateFriendNotifications: mocks.activate,
  browserNotificationState: () => mocks.notificationState,
  publicVapidKey: () => 'synthetic-public-vapid-key',
}));

describe('Perfil — privacidade e notificações opcionais', () => {
  beforeEach(() => {
    mocks.apiRequest.mockReset();
    mocks.activate.mockClear();
    mocks.refresh.mockClear();
    mocks.notificationState = 'prompt';
    mocks.pushConfigured = true;
    mocks.apiRequest.mockImplementation((path: string) => {
      if (path === '/api/profile/summary') return Promise.resolve({ activeStreak: null, bestTheme: null, missions: [] });
      if (path === '/api/social/blocks') return Promise.resolve({ users: [{
        customAvatarUrl: '/api/avatars/blocked/v1.webp',
        displayName: 'Pessoa Bloqueada',
        frameId: 'frame-bloqueado',
        photoUrl: null,
        publicId: '#QGBLOCKED1',
      }] });
      return Promise.resolve({ ok: true });
    });
  });

  afterEach(() => cleanup());

  it('carrega bloqueados somente ao abrir Privacidade e Segurança e confirma o desbloqueio', async () => {
    render(<ProfilePage />);
    expect(mocks.apiRequest).toHaveBeenCalledWith('/api/profile/summary', expect.any(Object));
    fireEvent.click(screen.getByRole('button', { name: 'Usuários bloqueados' }));
    expect(await screen.findByText('Pessoa Bloqueada')).toBeInTheDocument();
    expect(screen.getByText('#QGBLOCKED1')).toBeInTheDocument();
    expect(document.querySelector('[data-frame-id="frame-bloqueado"]')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Desbloquear' }));
    const dialog = screen.getByRole('dialog', { name: 'Desbloquear Pessoa Bloqueada?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Desbloquear' }));
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledWith('/api/social/blocks',
      expect.objectContaining({ body: { publicId: '#QGBLOCKED1' }, method: 'DELETE' })));
  });

  it('M12 — "Carregar mais" busca a próxima página de bloqueados e soma à lista', async () => {
    mocks.apiRequest.mockImplementation((path: string) => {
      if (path === '/api/profile/summary') return Promise.resolve({ activeStreak: null, bestTheme: null, missions: [] });
      if (path === '/api/social/blocks') return Promise.resolve({
        nextCursor: 'cursor-1',
        users: [{ customAvatarUrl: null, displayName: 'Pessoa Bloqueada', frameId: null, photoUrl: null, publicId: '#QGBLOCKED1' }],
      });
      if (path === '/api/social/blocks?cursor=cursor-1') return Promise.resolve({
        nextCursor: null,
        users: [{ customAvatarUrl: null, displayName: 'Outra Pessoa', frameId: null, photoUrl: null, publicId: '#QGBLOCKED2' }],
      });
      return Promise.resolve({ ok: true });
    });
    render(<ProfilePage />);
    fireEvent.click(screen.getByRole('button', { name: 'Usuários bloqueados' }));
    expect(await screen.findByText('Pessoa Bloqueada')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Carregar mais' }));
    expect(await screen.findByText('Outra Pessoa')).toBeInTheDocument();
    // A primeira página continua visível: "carregar mais" soma, nunca substitui.
    expect(screen.getByText('Pessoa Bloqueada')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).not.toBeInTheDocument();
  });

  it('solicita notificações apenas após gesto explícito do usuário', async () => {
    render(<ProfilePage />);
    expect(mocks.activate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Ativar notificações' }));
    await waitFor(() => expect(mocks.activate).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Pedidos de amizade ativados')).toBeInTheDocument();
  });

  it('permission denied não impede Perfil/Social nem solicita autorização repetidamente', () => {
    mocks.notificationState = 'denied';
    render(<ProfilePage />);
    expect(screen.getByText('Notificações bloqueadas pelo navegador')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Usuários bloqueados' })).toBeInTheDocument();
    expect(mocks.activate).not.toHaveBeenCalled();
  });

  it('credencial FCM ausente mantém experiência funcional com push desativado', () => {
    mocks.pushConfigured = false;
    render(<ProfilePage />);
    expect(screen.getByText('Notificações ainda não configuradas')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ativar notificações' })).not.toBeInTheDocument();
  });
});

describe('M11 — missões e streak no Perfil', () => {
  beforeEach(() => {
    mocks.apiRequest.mockReset();
    mocks.notificationState = 'prompt';
    mocks.pushConfigured = true;
  });

  afterEach(() => cleanup());

  it('exibe progresso das três missões do dia e a sequência ativa', async () => {
    mocks.apiRequest.mockImplementation((path: string) => {
      if (path === '/api/profile/summary') return Promise.resolve({
        activeStreak: { bestStreak: 4, currentStreak: 3, themeName: 'Geografia' },
        bestTheme: null,
        missions: [
          { completedAt: null, progress: 0, target: 1, type: 'PLAY_MATCH' },
          { completedAt: null, progress: 5, target: 8, type: 'ANSWER_QUESTIONS' },
          { completedAt: '2026-01-01T00:00:00.000Z', progress: 5, target: 5, type: 'CORRECT_ANSWERS' },
        ],
      });
      return Promise.resolve({ ok: true });
    });
    render(<ProfilePage />);

    expect(await screen.findByText('Jogue uma partida válida')).toBeInTheDocument();
    expect(screen.getByText('0/1')).toBeInTheDocument();
    expect(screen.getByText('Responda perguntas')).toBeInTheDocument();
    expect(screen.getByText('5/8')).toBeInTheDocument();
    expect(screen.getByText('Acerte perguntas')).toBeInTheDocument();
    expect(screen.getByText('5/5')).toBeInTheDocument();
    expect(screen.getByText('3 dias')).toBeInTheDocument();
    expect(screen.getByText('Geografia · recorde de 4 dias')).toBeInTheDocument();
  });

  it('sem streak ativa e sem missões, mostra os estados vazios', async () => {
    mocks.apiRequest.mockImplementation((path: string) => {
      if (path === '/api/profile/summary') return Promise.resolve({ activeStreak: null, bestTheme: null, missions: [] });
      return Promise.resolve({ ok: true });
    });
    render(<ProfilePage />);

    expect(await screen.findByText('Sem missões disponíveis hoje.')).toBeInTheDocument();
    expect(screen.getByText('Jogue uma partida válida em qualquer tema para começar sua sequência.')).toBeInTheDocument();
  });
});

describe('M11 — partidas e média por categoria no Perfil', () => {
  beforeEach(() => {
    mocks.apiRequest.mockReset();
    mocks.notificationState = 'prompt';
    mocks.pushConfigured = true;
  });

  afterEach(() => cleanup());

  it('exibe os totais de partidas Ranqueadas e a média por categoria', async () => {
    mocks.apiRequest.mockImplementation((path: string) => {
      if (path === '/api/profile/summary') return Promise.resolve({
        activeStreak: null,
        bestTheme: null,
        categoryAverages: [{
          average: { rank: { division: 'III', knowledge: 5_000, tier: 'Bronze' }, sampledThemes: 2 },
          categoryId: 'cat-1',
          categoryName: 'Jogos',
        }],
        matchSummary: { draws: 2, losses: 3, matches: 10, wins: 5 },
        missions: [],
      });
      return Promise.resolve({ ok: true });
    });
    render(<ProfilePage />);

    expect(await screen.findByText('10')).toBeInTheDocument();
    expect(screen.getByText('Partidas')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('Vitórias')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Derrotas')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('Empates')).toBeInTheDocument();
    expect(screen.getByText('Jogos')).toBeInTheDocument();
    expect(screen.getByText('Bronze III')).toBeInTheDocument();
  });

  it('sem Ranqueadas ainda, mostra os estados vazios de partidas e categoria', async () => {
    mocks.apiRequest.mockImplementation((path: string) => {
      if (path === '/api/profile/summary') return Promise.resolve({
        activeStreak: null, bestTheme: null, categoryAverages: [], matchSummary: { draws: 0, losses: 0, matches: 0, wins: 0 }, missions: [],
      });
      return Promise.resolve({ ok: true });
    });
    render(<ProfilePage />);

    expect(await screen.findAllByText('Jogue sua primeira Ranqueada para preencher este espaço.')).toHaveLength(2);
    expect(screen.getByText('Jogue Ranqueadas em mais de um tema da mesma categoria para ver sua média.')).toBeInTheDocument();
  });
});
