// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { inviteUrl, publicIdFromInviteCode, rememberInviteAdd } from '../lib/invite-link.js';
import { InvitePage } from '../pages/invite-page.js';

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  auth: {
    firebaseUser: null as { uid: string } | null,
    loading: false,
    profile: null as null | {
      customAvatarUrl: string | null; displayName: string; equippedFrameId: string | null; photoUrl: string | null; publicId: string;
    },
  },
  getToken: vi.fn(() => Promise.resolve('synthetic-auth')),
  refresh: vi.fn(() => Promise.resolve()),
  signIn: vi.fn(() => Promise.resolve()),
}));

vi.mock('../features/auth-context.js', () => ({
  useAuth: () => ({ ...mocks.auth, getToken: mocks.getToken, signIn: mocks.signIn }),
}));
vi.mock('../features/social-context.js', () => ({ useSocial: () => ({ refresh: mocks.refresh }) }));
vi.mock('../lib/api.js', () => ({ apiRequest: mocks.apiRequest }));

const ME = { customAvatarUrl: null, displayName: 'Matheus Gomes', equippedFrameId: null, photoUrl: null, publicId: '#QGMEU0001' };
const ANA = {
  availableAt: null as string | null, customAvatarUrl: null, displayName: 'Ana Luiza', frameId: null, photoUrl: null,
  publicId: '#QGANA2222', relationship: 'NONE' as 'FRIEND' | 'INCOMING' | 'NONE' | 'OUTGOING', requestId: null as string | null,
};

function openInvite(code = 'QGANA2222') {
  render(
    <MemoryRouter initialEntries={[`/convite/${code}`]}>
      <Routes>
        <Route path="convite/:code" element={<InvitePage />} />
        <Route path="social" element={<p>Página Social</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

function searchReturns(candidate: typeof ANA | null) {
  mocks.apiRequest.mockImplementation((path: string) => {
    if (path.startsWith('/api/social/search')) return Promise.resolve({ users: candidate === null ? [] : [candidate] });
    return Promise.resolve({ created: true, ok: true, request: { id: 'r-1' } });
  });
}

describe('link de convite', () => {
  it('monta e lê o código sem o "#" (que viraria âncora)', () => {
    expect(inviteUrl('#QGajc7rk', 'https://quiz.test')).toBe('https://quiz.test/convite/QGAJC7RK');
    expect(publicIdFromInviteCode('qgajc7rk')).toBe('#QGAJC7RK');
    expect(publicIdFromInviteCode('%23QGAJC7RK')).toBe('#QGAJC7RK');
    expect(publicIdFromInviteCode('AB12')).toBeNull();
    expect(publicIdFromInviteCode('QG<script>')).toBeNull();
    expect(publicIdFromInviteCode('%E0%A4%A')).toBeNull();
  });
});

describe('tela do convite', () => {
  beforeEach(() => {
    mocks.apiRequest.mockReset();
    mocks.refresh.mockClear();
    mocks.signIn.mockClear();
    mocks.auth.firebaseUser = { uid: 'uid-1' };
    mocks.auth.loading = false;
    mocks.auth.profile = ME;
    sessionStorage.clear();
  });
  afterEach(cleanup);

  it('mostra quem convidou e envia o pedido num toque', async () => {
    searchReturns({ ...ANA });
    openInvite();
    expect(await screen.findByRole('heading', { name: 'Ana te chamou pra duelar' })).toBeInTheDocument();
    expect(mocks.apiRequest).toHaveBeenCalledWith('/api/social/search?q=%23QGANA2222', expect.anything());
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar Ana' }));
    expect(await screen.findByRole('heading', { name: 'Pedido enviado para Ana!' })).toBeInTheDocument();
    expect(mocks.apiRequest).toHaveBeenCalledWith('/api/social/requests', expect.objectContaining({
      body: { publicId: '#QGANA2222' }, method: 'POST',
    }));
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it('nada é enviado só por abrir o link', async () => {
    searchReturns({ ...ANA });
    openInvite();
    await screen.findByRole('heading', { name: 'Ana te chamou pra duelar' });
    expect(mocks.apiRequest.mock.calls.some((call) => call[0] === '/api/social/requests')).toBe(false);
  });

  it('pedido que a pessoa já mandou vira "aceitar"', async () => {
    searchReturns({ ...ANA, relationship: 'INCOMING', requestId: '0b0b0b0b-0000-4000-8000-000000000001' });
    openInvite();
    fireEvent.click(await screen.findByRole('button', { name: 'Aceitar e virar amigos' }));
    expect(await screen.findByRole('heading', { name: 'Você e Ana agora são amigos' })).toBeInTheDocument();
    expect(mocks.apiRequest).toHaveBeenCalledWith(
      '/api/social/requests/0b0b0b0b-0000-4000-8000-000000000001/accept', expect.objectContaining({ method: 'POST' }),
    );
  });

  it('já amigos, pedido pendente e espera para reenviar não mostram "Adicionar"', async () => {
    searchReturns({ ...ANA, relationship: 'FRIEND' });
    openInvite();
    expect(await screen.findByRole('heading', { name: 'Você e Ana já são amigos' })).toBeInTheDocument();
    cleanup();
    searchReturns({ ...ANA, relationship: 'OUTGOING' });
    openInvite();
    expect(await screen.findByRole('heading', { name: 'Seu pedido para Ana já está lá' })).toBeInTheDocument();
    cleanup();
    searchReturns({ ...ANA, availableAt: '2026-11-20T12:00:00.000Z' });
    openInvite();
    expect(await screen.findByText(/Você poderá mandar um novo pedido a partir de 20 de novembro/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Adicionar Ana' })).toBeNull();
  });

  it('o próprio link e código inexistente ou inválido têm aviso claro', async () => {
    openInvite('QGMEU0001');
    expect(screen.getByRole('heading', { name: 'Esse link é seu' })).toBeInTheDocument();
    expect(mocks.apiRequest).not.toHaveBeenCalled();
    cleanup();
    searchReturns(null);
    openInvite();
    expect(await screen.findByRole('heading', { name: 'Convite não encontrado' })).toBeInTheDocument();
    cleanup();
    openInvite('xyz');
    expect(screen.getByRole('heading', { name: 'Convite inválido' })).toBeInTheDocument();
  });

  it('visitante entra pelo convite e o pedido sai sozinho quando a conta fica pronta', async () => {
    mocks.auth.firebaseUser = null;
    mocks.auth.profile = null;
    searchReturns({ ...ANA });
    openInvite();
    expect(screen.getByRole('heading', { name: 'Te chamaram pro QUIZ GOMES' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Entrar com Google e adicionar' }));
    expect(mocks.signIn).toHaveBeenCalled();
    cleanup();
    // Volta do login (popup ou redirecionamento) com a conta pronta.
    mocks.auth.firebaseUser = { uid: 'uid-1' };
    mocks.auth.profile = ME;
    openInvite();
    expect(await screen.findByRole('heading', { name: 'Pedido enviado para Ana!' })).toBeInTheDocument();
    await waitFor(() => expect(mocks.apiRequest.mock.calls.filter((call) => call[0] === '/api/social/requests')).toHaveLength(1));
  });

  it('o pedido automático só vale para o convite que foi tocado', async () => {
    rememberInviteAdd('#QGOUTRO999');
    searchReturns({ ...ANA });
    openInvite();
    await screen.findByRole('heading', { name: 'Ana te chamou pra duelar' });
    expect(mocks.apiRequest.mock.calls.some((call) => call[0] === '/api/social/requests')).toBe(false);
  });
});
