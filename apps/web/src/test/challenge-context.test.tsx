// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ChallengeProvider, useChallenges } from '../features/challenge-context.js';
import { DirectChallengeWaiting } from '../components/direct-challenge-waiting.js';

interface StartedChallenge {
  challengeId: string;
  opponent: { displayName: string };
  preload: null;
  roomId: string;
}

interface SocialMock {
  challengeRevision: number;
  consumeStartedChallenge: () => StartedChallenge | null;
  startedChallenge: StartedChallenge | null;
}

const mocks = vi.hoisted(() => {
  const social: SocialMock = {
    challengeRevision: 0,
    consumeStartedChallenge: () => null,
    startedChallenge: null,
  };
  return {
    apiRequest: vi.fn(),
    getToken: vi.fn(() => Promise.resolve('synthetic-auth')),
    // Identidade estável, como no AuthContext real: perfil novo a cada render
    // refaria a busca sem que nada tivesse mudado.
    profile: { displayName: 'Dono', publicId: '#QGOWNER1' },
    prepareMatchRoom: vi.fn(() => Promise.resolve()),
    preloadMatchPresentationAssets: vi.fn(),
    social,
  };
});

vi.mock('../features/auth-context.js', () => ({
  useAuth: () => ({ getToken: mocks.getToken, profile: mocks.profile }),
}));
vi.mock('../features/social-context.js', () => ({
  useSocial: () => mocks.social,
}));
vi.mock('../lib/api.js', () => ({ apiRequest: mocks.apiRequest }));
vi.mock('../lib/preloaded-match-room.js', () => ({
  prepareMatchRoom: mocks.prepareMatchRoom,
  preloadMatchPresentationAssets: mocks.preloadMatchPresentationAssets,
}));

const ana = {
  customAvatarUrl: null, displayName: 'Ana', frameId: null, photoUrl: null, publicId: '#QGANA1',
};
const dono = {
  customAvatarUrl: null, displayName: 'Dono', frameId: null, photoUrl: null, publicId: '#QGOWNER1',
};

function pendingDirectChallenge(expiresAt: string) {
  return {
    challenged: ana,
    challenger: dono,
    difficulty: 'EASY',
    expiresAt,
    id: 'challenge-direct-1',
    kind: 'DIRECT',
    role: 'CHALLENGER',
    status: 'PENDING_DIRECT',
    theme: { name: 'Elden Ring', slug: 'elden-ring' },
  };
}

function Probe() {
  const { challenges } = useChallenges();
  return <p data-testid="count">{challenges.length}</p>;
}

/** Espelha use-friend-challenge.ts: marca o otimista e, na sequência, atualiza a lista. */
function CreateProbe() {
  const { refreshChallenges, trackPendingDirect } = useChallenges();
  return (
    <button
      onClick={() => {
        trackPendingDirect({ challengeId: 'challenge-direct-1', displayName: 'Ana', expiresAtMs: Date.now() + 30_000 });
        void refreshChallenges();
      }}
      type="button"
    >
      Desafiar
    </button>
  );
}

function Location() {
  const location = useLocation();
  return <p data-testid="rota">{location.pathname}</p>;
}

function app(children: React.ReactNode) {
  return (
    <MemoryRouter initialEntries={['/social']}>
      <div className="app-shell">
        <Routes>
          <Route element={<Location />} path="*" />
        </Routes>
      </div>
      <ChallengeProvider>{children}</ChallengeProvider>
    </MemoryRouter>
  );
}

describe('estado global dos desafios', () => {
  beforeEach(() => {
    vi.useRealTimers();
    mocks.apiRequest.mockReset();
    mocks.apiRequest.mockResolvedValue({ challenges: [] });
    mocks.prepareMatchRoom.mockClear();
    mocks.preloadMatchPresentationAssets.mockClear();
    mocks.social = {
      challengeRevision: 0,
      consumeStartedChallenge: () => null,
      startedChallenge: null,
    };
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('atualiza a lista por evento do canal social, sem nenhum polling', async () => {
    const view = render(app(<Probe />));
    await waitFor(() => { expect(mocks.apiRequest).toHaveBeenCalledTimes(1); });

    // Tempo passando sozinho NÃO pode gerar requisição nova: só o evento atualiza.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 250)); });
    expect(mocks.apiRequest).toHaveBeenCalledTimes(1);

    mocks.apiRequest.mockResolvedValue({ challenges: [pendingDirectChallenge(
      new Date(Date.now() + 30_000).toISOString(),
    )] });
    mocks.social = { ...mocks.social, challengeRevision: 1 };
    view.rerender(app(<Probe />));

    await waitFor(() => { expect(screen.getByTestId('count')).toHaveTextContent('1'); });
    expect(mocks.apiRequest).toHaveBeenCalledTimes(2);
    expect(mocks.apiRequest.mock.calls.every((call) => call[0] === '/api/challenges')).toBe(true);
  });

  it('consome todas as páginas de desafios vivos, inclusive para a recuperação global', async () => {
    const secondPage = {
      ...pendingDirectChallenge(new Date(Date.now() + 20_000).toISOString()),
      id: 'challenge-direct-2',
    };
    mocks.apiRequest.mockImplementation((path: string) => {
      if (path === '/api/challenges') return Promise.resolve({
        challenges: [pendingDirectChallenge(new Date(Date.now() + 30_000).toISOString())],
        nextCursor: 'cursor-next',
      });
      if (path === '/api/challenges?cursor=cursor-next') {
        return Promise.resolve({ challenges: [secondPage], nextCursor: null });
      }
      return Promise.reject(new Error(`Rota inesperada: ${path}`));
    });

    render(app(<Probe />));

    await waitFor(() => { expect(screen.getByTestId('count')).toHaveTextContent('2'); });
    expect(mocks.apiRequest).toHaveBeenCalledWith('/api/challenges?cursor=cursor-next', expect.anything());
  });

  it('recupera a espera do convite direto depois de um reload e trava o app', async () => {
    // Nada de estado otimista aqui: a espera vem só do que o servidor devolveu.
    mocks.apiRequest.mockResolvedValue({
      challenges: [pendingDirectChallenge(new Date(Date.now() + 18_400).toISOString())],
    });
    render(app(<DirectChallengeWaiting />));

    expect(await screen.findByText('Aguardando Ana')).toBeInTheDocument();
    // A contagem deriva do prazo do servidor, nunca de um contador local de 30 s.
    await waitFor(() => { expect(screen.getByRole('timer')).toHaveTextContent('19s'); });
    const shell = document.querySelector('.app-shell');
    expect(shell).toHaveAttribute('inert');
    expect(shell).toHaveAttribute('aria-hidden', 'true');
  });

  it('cancelar a espera libera o app e avisa o servidor', async () => {
    mocks.apiRequest.mockImplementation((path: string) => (
      path === '/api/challenges'
        ? Promise.resolve({ challenges: [pendingDirectChallenge(new Date(Date.now() + 30_000).toISOString())] })
        : Promise.resolve({ ok: true })
    ));
    render(app(<DirectChallengeWaiting />));
    await screen.findByText('Aguardando Ana');

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar convite' }));

    await waitFor(() => { expect(screen.queryByText('Aguardando Ana')).not.toBeInTheDocument(); });
    expect(mocks.apiRequest).toHaveBeenCalledWith(
      '/api/challenges/challenge-direct-1/cancel',
      expect.objectContaining({ method: 'POST' }),
    );
    const shell = document.querySelector('.app-shell');
    expect(shell).not.toHaveAttribute('inert');
    expect(shell).not.toHaveAttribute('aria-hidden');
  });

  it('mantém o convite otimista visível até a atualização causada pela própria criação confirmar', async () => {
    mocks.apiRequest.mockResolvedValueOnce({ challenges: [] });
    render(app(<><CreateProbe /><DirectChallengeWaiting /></>));
    await waitFor(() => { expect(mocks.apiRequest).toHaveBeenCalledTimes(1); });

    // A lista ainda não sabe do convite recém-criado: é exatamente a janela
    // real entre trackPendingDirect() e o refreshChallenges() que o sucede.
    let resolveFollowUp: ((value: { challenges: unknown[] }) => void) | undefined;
    mocks.apiRequest.mockImplementationOnce(() => new Promise((resolve) => { resolveFollowUp = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: 'Desafiar' }));

    await screen.findByText('Aguardando Ana');
    // Passar o tempo sem a resposta chegar não pode apagar o convite: nada
    // provou ainda que ele terminou, só que a lista antiga não o conhecia.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(screen.getByText('Aguardando Ana')).toBeInTheDocument();

    resolveFollowUp?.({ challenges: [pendingDirectChallenge(new Date(Date.now() + 30_000).toISOString())] });
    await waitFor(() => { expect(mocks.apiRequest).toHaveBeenCalledTimes(2); });
    expect(screen.getByText('Aguardando Ana')).toBeInTheDocument();
  });

  it('convite otimista some com aviso quando a atualização causada por ele confirma que terminou', async () => {
    mocks.apiRequest.mockResolvedValueOnce({ challenges: [] });
    render(app(<><CreateProbe /><DirectChallengeWaiting /></>));
    await waitFor(() => { expect(mocks.apiRequest).toHaveBeenCalledTimes(1); });

    let resolveFollowUp: ((value: { challenges: unknown[] }) => void) | undefined;
    mocks.apiRequest.mockImplementationOnce(() => new Promise((resolve) => { resolveFollowUp = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: 'Desafiar' }));
    await screen.findByText('Aguardando Ana');

    // Só agora a lista realmente reflete o pós-criação: o convite nunca chegou a existir vivo.
    resolveFollowUp?.({ challenges: [] });
    await waitFor(() => { expect(screen.queryByText('Aguardando Ana')).not.toBeInTheDocument(); });
    expect(await screen.findByText('Este convite não está mais disponível.')).toBeInTheDocument();
  });

  it('o aceite remoto leva o desafiante à sala mesmo fora da tela do tema', async () => {
    const started: StartedChallenge = {
      challengeId: 'challenge-direct-1',
      opponent: ana,
      preload: null,
      roomId: 'room-direct-1',
    };
    mocks.social = {
      challengeRevision: 0,
      consumeStartedChallenge: () => started,
      startedChallenge: started,
    };
    // Montado em /social: a navegação não pode depender da ThemeDetail estar viva.
    render(app(<Probe />));

    await waitFor(() => { expect(screen.getByTestId('rota')).toHaveTextContent('/partida/room-direct-1'); });
    expect(mocks.prepareMatchRoom).toHaveBeenCalledWith('room-direct-1', mocks.getToken);
  });
});
