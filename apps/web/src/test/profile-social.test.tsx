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
    expect(mocks.apiRequest).not.toHaveBeenCalled();
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
