// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { relativeDay, resetCountdown } from '../components/profile-sections.js';
import { presentAchievement } from '../lib/achievements.js';
import { ProfilePage } from '../pages/profile-page.js';

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  getToken: vi.fn(() => Promise.resolve('fixture-auth')),
  retryProfile: vi.fn(() => Promise.resolve()),
}));

vi.mock('../features/auth-context.js', () => ({
  useAuth: () => ({
    error: null,
    firebaseUser: { displayName: 'Cartão', photoURL: null },
    getToken: mocks.getToken,
    profile: { customAvatarUrl: null, displayName: 'Cartão', equippedFrameId: null, photoUrl: null, publicId: '#QGCARTAO', totalXp: 0, userId: 'u-1' },
    removeCustomAvatar: vi.fn(),
    retryProfile: mocks.retryProfile,
    role: 'PLAYER',
    signIn: vi.fn(),
    signOut: vi.fn(),
    updateDisplayName: vi.fn(),
    uploadCustomAvatar: vi.fn(),
  }),
}));
vi.mock('../features/social-context.js', () => ({ useSocial: () => ({ pushConfigured: false, refresh: vi.fn() }) }));
vi.mock('../hooks/use-theme-mode.js', () => ({ useThemeMode: () => ({ mode: 'system', setMode: vi.fn() }) }));
vi.mock('../lib/api.js', () => ({ apiRequest: mocks.apiRequest }));
vi.mock('../lib/social-notifications.js', () => ({
  activateFriendNotifications: vi.fn(),
  browserNotificationState: () => 'prompt',
  publicVapidKey: () => '',
}));

const summary = {
  achievements: [{ achievementId: 'STREAK_7', frameId: 'frame-streak-7', seen: true, themeName: 'Naruto', unlockedAt: '2026-09-20 10:00:00', value: 7 }],
  activeStreak: { atRisk: true, bestStreak: 9, currentStreak: 8, lastActiveDay: '2026-09-26', themeId: 't', themeName: 'Naruto', themeSlug: 'naruto' },
  bestTheme: null,
  casualSummary: { draws: 1, losses: 2, matches: 7, wins: 4 },
  categoryAverages: [],
  frames: [{ equipped: false, id: 'frame-streak-7', name: 'Chama acesa' }],
  matchSummary: { draws: 0, losses: 0, matches: 0, wins: 0 },
  missions: [],
  missionsResetAt: new Date(Date.now() + 3 * 3_600_000 + 12 * 60_000).toISOString(),
  recentMatches: [
    { finishedAt: new Date().toISOString(), matchId: 'm1', mode: 'CASUAL', myScore: 120, opponent: { displayName: 'Rival', publicId: '#QGRIVAL' }, opponentScore: 80, result: 'WIN', themeName: 'Naruto', themeSlug: 'naruto', xpDelta: 20 },
    { finishedAt: new Date().toISOString(), matchId: 'm2', mode: 'RANKED', myScore: 50, opponent: null, opponentScore: 90, result: 'LOSS', themeName: 'Bleach', themeSlug: 'bleach', xpDelta: 5 },
  ],
  streakReminder: false,
  themeRecords: [
    { bestScore: 120, mode: 'CASUAL', themeName: 'Naruto', themeSlug: 'naruto' },
    { bestScore: 150, mode: 'RANKED', themeName: 'Naruto', themeSlug: 'naruto' },
  ],
};

describe('Perfil como cartão de jogador', () => {
  afterEach(() => { cleanup(); mocks.apiRequest.mockReset(); });

  it('mostra ofensiva em risco, últimas partidas com ✓/×, recordes e estatística da Normal', async () => {
    mocks.apiRequest.mockResolvedValue(summary);
    render(<MemoryRouter><ProfilePage /></MemoryRouter>);
    expect(await screen.findByRole('img', { name: 'Vitória' })).toBeInTheDocument();
    // Ofensiva em risco: só o ícone pulsa, sem texto de sermão.
    expect(screen.queryByText(/mantém a chama acesa/)).not.toBeInTheDocument();
    expect(document.querySelector('.profile-card--streak-risk')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Vitória' })).toHaveTextContent('✓');
    expect(screen.getByRole('img', { name: 'Derrota' })).toHaveTextContent('×');
    expect(screen.getByText(/contra Rival/)).toBeInTheDocument();
    expect(screen.getByText('150')).toBeInTheDocument();
    expect(screen.getByText(/Renovam em 3 h 1[12] min/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Normal' }));
    expect(screen.getByText('57%')).toBeInTheDocument();
  });

  it('equipa uma moldura ganha e recarrega o perfil', async () => {
    mocks.apiRequest.mockImplementation((path: string) => Promise.resolve(path === '/api/profile/summary' ? summary : { equippedFrameId: 'frame-streak-7' }));
    render(<MemoryRouter><ProfilePage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: /Chama acesa.*Toque para usar/ }));
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledWith('/api/profile/frame', expect.objectContaining({ body: { frameId: 'frame-streak-7' }, method: 'PUT' })));
    await waitFor(() => expect(mocks.retryProfile).toHaveBeenCalled());
    // Moldura bloqueada não é clicável e diz como ganhar.
    expect(screen.getByRole('button', { name: /Lenda de dois anos.*2 anos de ofensiva/ })).toBeDisabled();
  });
});

describe('textos do perfil e das conquistas', () => {
  it('conta o tempo até a renovação e dias relativos no horário de Brasília', () => {
    expect(resetCountdown(10 * 60_000, 0)).toBe('10 min');
    expect(resetCountdown(2 * 3_600_000, 0)).toBe('2 h');
    expect(resetCountdown(0, 0)).toBe('menos de 1 min');
    const now = Date.parse('2026-09-27T15:00:00.000Z');
    expect(relativeDay('2026-09-27 12:00:00', now)).toBe('hoje');
    // 01h UTC do dia 27 ainda é dia 26 em Brasília.
    expect(relativeDay('2026-09-27T01:00:00.000Z', now)).toBe('ontem');
  });

  it('cartões ficam mais especiais a cada marco', () => {
    expect(presentAchievement({ achievementId: 'STREAK_100', themeName: null })).toMatchObject({ big: '100', tier: 'bronze', title: 'Centenário' });
    expect(presentAchievement({ achievementId: 'STREAK_300', themeName: null }).tier).toBe('gold');
    expect(presentAchievement({ achievementId: 'STREAK_365', themeName: 'Naruto' })).toMatchObject({ big: '1', bigCaption: 'ano', tier: 'year' });
    expect(presentAchievement({ achievementId: 'STREAK_730', themeName: null })).toMatchObject({ big: '2', tier: 'legend' });
    expect(presentAchievement({ achievementId: 'STREAK_1000', themeName: null })).toMatchObject({ title: '1.000 dias de ofensiva', tier: 'legend' });
  });
});
