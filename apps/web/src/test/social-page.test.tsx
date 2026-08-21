// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SocialPage } from '../pages/social-page.js';

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  getToken: vi.fn(() => Promise.resolve('synthetic-auth')),
  profile: { displayName: 'Dono', publicId: '#QGOWNER1' },
  refresh: vi.fn(() => Promise.resolve()),
  signIn: vi.fn(() => Promise.resolve()),
}));

vi.mock('../features/auth-context.js', () => ({
  useAuth: () => ({
    getToken: mocks.getToken,
    profile: mocks.profile,
    signIn: mocks.signIn,
  }),
}));
vi.mock('../features/social-context.js', () => ({
  useSocial: () => ({ pendingCount: 1, pushConfigured: false, refresh: mocks.refresh, revision: 0 }),
}));
vi.mock('../lib/api.js', () => ({ apiRequest: mocks.apiRequest }));

const incomingUser = {
  customAvatarUrl: '/api/avatars/social-real/v2.webp',
  displayName: 'Ana Real',
  frameId: 'frame-social-real',
  photoUrl: 'https://lh3.googleusercontent.com/social-real',
  publicId: '#QGANA222',
};

const friendUser = {
  customAvatarUrl: null,
  displayName: 'Bia Amiga',
  frameId: null,
  photoUrl: null,
  publicId: '#QGBIA333',
};

describe('Social Foundation — interface web', () => {
  beforeEach(() => {
    mocks.apiRequest.mockReset();
    mocks.refresh.mockClear();
    mocks.apiRequest.mockImplementation((path: string) => {
      if (path === '/api/social') return Promise.resolve({
        friends: [friendUser],
        incoming: [{ createdAt: '2026-08-21', id: '11111111-1111-4111-8111-111111111111', user: incomingUser }],
        outgoing: [],
      });
      if (path.startsWith('/api/social/search')) return Promise.resolve({ users: [{
        ...friendUser,
        availableAt: null,
        relationship: 'NONE',
        requestId: null,
      }] });
      return Promise.resolve({ ok: true });
    });
  });

  afterEach(() => cleanup());

  it('mostra pedidos antes de amigos, avatar/frame reais e ações verde/vermelha sem presença falsa', async () => {
    render(<SocialPage />);
    await screen.findByText('Ana Real');
    const incoming = screen.getByRole('region', { name: 'Pedidos recebidos' });
    expect(within(incoming).getByText('#QGANA222')).toBeInTheDocument();
    expect(within(incoming).getByRole('button', { name: 'Aceitar' })).toHaveClass('button--accept');
    expect(within(incoming).getByRole('button', { name: 'Recusar' })).toHaveClass('button--primary');
    expect(incoming.querySelector('img')).toHaveAttribute('src', '/api/avatars/social-real/v2.webp');
    expect(incoming.querySelector('[data-frame-id="frame-social-real"]')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Amigos' })).toHaveTextContent('Bia Amiga');
    expect(screen.queryByText(/online|assíncronas|desafiar/i)).not.toBeInTheDocument();
  });

  it('busca no backend com nome/ID público sem baixar toda a lista de usuários', async () => {
    render(<SocialPage />);
    await screen.findByText('Ana Real');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'bia' } });
    await waitFor(() => {
      expect(mocks.apiRequest.mock.calls.some((call) => call[0] === '/api/social/search?q=bia')).toBe(true);
    });
    expect(await screen.findAllByText('Bia Amiga')).toHaveLength(2);
    expect(screen.getByRole('region', { name: 'Resultados da busca' })).toHaveTextContent('#QGBIA333');
  });

  it('aceita e recusa com ação imediata dirigida somente ao pedido existente', async () => {
    const view = render(<SocialPage />);
    await screen.findByText('Ana Real');
    fireEvent.click(screen.getByRole('button', { name: 'Aceitar' }));
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledWith(
      '/api/social/requests/11111111-1111-4111-8111-111111111111/accept',
      expect.objectContaining({ method: 'POST' }),
    ));
    view.unmount();

    render(<SocialPage />);
    await screen.findByText('Ana Real');
    fireEvent.click(screen.getByRole('button', { name: 'Recusar' }));
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledWith(
      '/api/social/requests/11111111-1111-4111-8111-111111111111/reject',
      expect.objectContaining({ method: 'POST' }),
    ));
  });

  it('confirma bloqueio com dialog acessível e envia apenas o ID público do alvo', async () => {
    render(<SocialPage />);
    await screen.findByText('Bia Amiga');
    fireEvent.click(screen.getByRole('button', { name: 'Bloquear Bia Amiga' }));
    const dialog = screen.getByRole('dialog', { name: 'Bloquear Bia Amiga?' });
    expect(dialog).toHaveTextContent('futuras partidas');
    expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toHaveFocus();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Bloquear usuário' }));
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledWith(
      '/api/social/blocks',
      expect.objectContaining({ body: { publicId: '#QGBIA333' }, method: 'POST' }),
    ));
  });
});
