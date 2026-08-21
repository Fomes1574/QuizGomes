// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SocialPage } from '../pages/social-page.js';

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  getToken: vi.fn(() => Promise.resolve('synthetic-auth')),
  presence: new Map<string, { presence: string; publicId: string; revision: number }>(),
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
  useFriendPresence: () => mocks.presence,
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
    mocks.presence = new Map();
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

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('mostra pedidos antes de amigos, avatar/frame reais e estado privado somente no card de amizade', async () => {
    render(<SocialPage />);
    await screen.findByText('Ana Real');
    const incoming = screen.getByRole('region', { name: 'Pedidos recebidos' });
    expect(within(incoming).getByText('#QGANA222')).toBeInTheDocument();
    expect(within(incoming).getByRole('button', { name: 'Aceitar' })).toHaveClass('button--accept');
    expect(within(incoming).getByRole('button', { name: 'Recusar' })).toHaveClass('button--primary');
    expect(incoming.querySelector('img')).toHaveAttribute('src', '/api/avatars/social-real/v2.webp');
    expect(incoming.querySelector('[data-frame-id="frame-social-real"]')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Amigos' })).toHaveTextContent('Bia Amiga');
    expect(screen.getByLabelText('Bia Amiga está offline')).toBeInTheDocument();
    expect(screen.queryByText(/assíncronas|desafiar/i)).not.toBeInTheDocument();
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

  it('mostra avatar, frame e bolinha verde/amarela/cinza somente para amigos autorizados', async () => {
    mocks.presence = new Map([[friendUser.publicId, {
      presence: 'MATCHMAKING',
      publicId: friendUser.publicId,
      revision: 1,
    }]]);
    const view = render(<SocialPage />);
    expect(await screen.findByLabelText('Bia Amiga está procurando partida')).toBeInTheDocument();
    const friend = screen.getByRole('region', { name: 'Amigos' });
    expect(friend.querySelector('.friend-presence-dot')).toHaveAttribute('data-presence', 'MATCHMAKING');
    expect(screen.getByRole('region', { name: 'Pedidos recebidos' })
      .querySelector('.friend-presence-dot')).not.toBeInTheDocument();

    mocks.presence = new Map([[friendUser.publicId, {
      presence: 'IN_MATCH',
      publicId: friendUser.publicId,
      revision: 2,
    }]]);
    view.rerender(<SocialPage />);
    expect(screen.getByLabelText('Bia Amiga está em partida')).toBeInTheDocument();
    expect(friend.querySelector('.friend-presence-dot')).toHaveAttribute('data-presence', 'IN_MATCH');

    mocks.presence = new Map([[friendUser.publicId, {
      presence: 'RECONNECTING',
      publicId: friendUser.publicId,
      revision: 3,
    }]]);
    view.rerender(<SocialPage />);
    expect(screen.getByLabelText('Bia Amiga está reconectando')).toBeInTheDocument();
    expect(friend.querySelector('.friend-presence-dot')).toHaveAttribute('data-presence', 'RECONNECTING');

    mocks.presence = new Map([[friendUser.publicId, {
      presence: 'OFFLINE',
      publicId: friendUser.publicId,
      revision: 4,
    }]]);
    view.rerender(<SocialPage />);
    expect(screen.getByLabelText('Bia Amiga está offline')).toBeInTheDocument();
    expect(friend.querySelector('.friend-presence-dot')).toHaveAttribute('data-presence', 'OFFLINE');
  });

  it('ordena disponíveis, busca, partida/reconexão e offline alfabeticamente sem expor status na busca', async () => {
    const roster = [
      { ...friendUser, displayName: 'Zoe Livre', publicId: '#QGZOE111' },
      { ...friendUser, displayName: 'Ana Livre', publicId: '#QGANA111' },
      { ...friendUser, displayName: 'Caio Busca', publicId: '#QGCAIO11' },
      { ...friendUser, displayName: 'Bia Partida', publicId: '#QGBIA111' },
      { ...friendUser, displayName: 'Ivo Offline', publicId: '#QGIVO111' },
    ];
    mocks.presence = new Map(roster.map((user, index) => [user.publicId, {
      presence: ['ONLINE', 'ONLINE', 'MATCHMAKING', 'IN_MATCH', 'OFFLINE'][index] ?? 'OFFLINE',
      publicId: user.publicId,
      revision: index + 1,
    }]));
    mocks.apiRequest.mockImplementation((path: string) => {
      if (path === '/api/social') return Promise.resolve({ friends: roster, incoming: [], outgoing: [] });
      if (path.startsWith('/api/social/search')) return Promise.resolve({ users: [{
        ...roster[1],
        availableAt: null,
        relationship: 'NONE',
        requestId: null,
      }] });
      return Promise.resolve({ ok: true });
    });
    render(<SocialPage />);
    await screen.findByText('Ana Livre');
    const cards = [...screen.getByRole('region', { name: 'Amigos' })
      .querySelectorAll('[data-friend-id]')].map((card) => card.getAttribute('data-friend-id'));
    expect(cards).toEqual(['#QGANA111', '#QGZOE111', '#QGCAIO11', '#QGBIA111', '#QGIVO111']);
    expect(screen.getByText('3 disponíveis')).toBeInTheDocument();
    expect(screen.getByText('1 em partida')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'ana' } });
    await waitFor(() => expect(screen.getByRole('region', { name: 'Resultados da busca' }))
      .toHaveTextContent('Ana Livre'));
    expect(screen.getByRole('region', { name: 'Resultados da busca' })
      .querySelector('.friend-presence-dot')).not.toBeInTheDocument();
  });

  it('reorganiza cards com FLIP leve e desliga Web Animations quando reduced-motion está ativo', async () => {
    const first = { ...friendUser, displayName: 'Ana movimento', publicId: '#QGANA777' };
    const second = { ...friendUser, displayName: 'Bia movimento', publicId: '#QGBIA777' };
    let reduced = false;
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: reduced })));
    const animate = vi.fn();
    const previousAnimate = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate');
    Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const row = this.closest('[data-friend-id]');
      const parent = row?.parentElement ?? null;
      const position = row === null || parent === null
        ? 0
        : [...parent.querySelectorAll('[data-friend-id]')].indexOf(row);
      return {
        bottom: position * 100 + 80,
        height: 80,
        left: 0,
        right: 300,
        toJSON: () => ({}),
        top: position * 100,
        width: 300,
        x: 0,
        y: position * 100,
      };
    });
    mocks.apiRequest.mockImplementation((path: string) => path === '/api/social'
      ? Promise.resolve({ friends: [first, second], incoming: [], outgoing: [] })
      : Promise.resolve({ ok: true }));
    mocks.presence = new Map([
      [first.publicId, { presence: 'ONLINE', publicId: first.publicId, revision: 1 }],
      [second.publicId, { presence: 'OFFLINE', publicId: second.publicId, revision: 1 }],
    ]);

    try {
      const view = render(<SocialPage />);
      await screen.findByText('Ana movimento');
      mocks.presence = new Map([
        [first.publicId, { presence: 'OFFLINE', publicId: first.publicId, revision: 2 }],
        [second.publicId, { presence: 'ONLINE', publicId: second.publicId, revision: 2 }],
      ]);
      view.rerender(<SocialPage />);
      expect(animate).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ duration: 390 }));

      animate.mockClear();
      reduced = true;
      mocks.presence = new Map([
        [first.publicId, { presence: 'ONLINE', publicId: first.publicId, revision: 3 }],
        [second.publicId, { presence: 'OFFLINE', publicId: second.publicId, revision: 3 }],
      ]);
      view.rerender(<SocialPage />);
      expect(animate).not.toHaveBeenCalled();
      expect(screen.getByLabelText('Ana movimento está online')).toBeInTheDocument();
    } finally {
      if (previousAnimate === undefined) delete (HTMLElement.prototype as { animate?: unknown }).animate;
      else Object.defineProperty(HTMLElement.prototype, 'animate', previousAnimate);
    }
  });

  it('mantém avatar, moldura, status e ações acessíveis em viewport móvel/desktop e tema escuro', async () => {
    const styledFriend = {
      ...friendUser,
      customAvatarUrl: '/api/avatars/social-presence/v3.webp',
      frameId: 'frame-presence-premium',
    };
    mocks.presence = new Map([[styledFriend.publicId, {
      presence: 'IN_MATCH',
      publicId: styledFriend.publicId,
      revision: 7,
    }]]);
    mocks.apiRequest.mockImplementation((path: string) => path === '/api/social'
      ? Promise.resolve({ friends: [styledFriend], incoming: [], outgoing: [] })
      : Promise.resolve({ ok: true }));
    const previousTheme = document.documentElement.dataset.theme;

    try {
      for (const [width, theme] of [[390, 'dark'], [1440, 'light']] as const) {
        vi.stubGlobal('innerWidth', width);
        document.documentElement.dataset.theme = theme;
        const view = render(<SocialPage />);
        const status = await screen.findByLabelText('Bia Amiga está em partida');
        const friends = screen.getByRole('region', { name: 'Amigos' });
        expect(status).toBeInTheDocument();
        expect(friends.querySelector('img')).toHaveAttribute('src', '/api/avatars/social-presence/v3.webp');
        expect(friends.querySelector('[data-frame-id="frame-presence-premium"]')).toBeInTheDocument();
        expect(within(friends).getByRole('button', { name: 'Remover amigo' })).toBeEnabled();
        expect(within(friends).getByRole('button', { name: 'Bloquear Bia Amiga' })).toBeEnabled();
        expect(friends.querySelector('.friend-presence-dot')).toHaveAttribute('data-presence', 'IN_MATCH');
        view.unmount();
      }
    } finally {
      if (previousTheme === undefined) delete document.documentElement.dataset.theme;
      else document.documentElement.dataset.theme = previousTheme;
    }
  });
});
