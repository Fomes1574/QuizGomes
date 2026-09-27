// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CelebrationHost } from '../components/celebration-host.js';

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  retryProfile: vi.fn(() => Promise.resolve()),
}));

vi.mock('../features/auth-context.js', () => ({
  useAuth: () => ({
    getToken: () => Promise.resolve('token'),
    profile: { customAvatarUrl: null, displayName: 'Chama', equippedFrameId: null, photoUrl: null, publicId: '#QGCHAMA', totalXp: 0, userId: 'u-1' },
    retryProfile: mocks.retryProfile,
  }),
}));
vi.mock('../lib/api.js', () => ({ apiRequest: mocks.apiRequest }));
vi.mock('../lib/feedback.js', () => ({ feedback: vi.fn() }));

describe('cartões de parabéns', () => {
  afterEach(() => { cleanup(); mocks.apiRequest.mockReset(); });

  it('mostra um por vez, equipa a moldura e marca como visto ao continuar', async () => {
    mocks.apiRequest.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/api/profile/celebrations' && options?.method === undefined) {
        return Promise.resolve({ celebrations: [
          { achievementId: 'STREAK_100', frameId: 'frame-streak-100', themeName: 'Naruto', unlockedAt: '2026-09-27', value: 100 },
          { achievementId: 'MISSIONS_DAY', frameId: 'frame-missions', themeName: null, unlockedAt: '2026-09-27', value: 0 },
        ] });
      }
      return Promise.resolve({ ok: true });
    });
    render(<CelebrationHost />);
    expect(await screen.findByRole('heading', { name: 'Centenário' })).toBeInTheDocument();
    expect(screen.getByText('100 dias seguidos jogando em Naruto.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Usar moldura' }));
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledWith('/api/profile/frame', expect.objectContaining({ body: { frameId: 'frame-streak-100' } })));
    await waitFor(() => expect(mocks.retryProfile).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Continuar (+1)' }));
    expect(mocks.apiRequest).toHaveBeenCalledWith('/api/profile/celebrations', expect.objectContaining({ body: { achievementIds: ['STREAK_100'] }, method: 'POST' }));
    expect(await screen.findByRole('heading', { name: 'Dia completo' })).toBeInTheDocument();
  });
});
