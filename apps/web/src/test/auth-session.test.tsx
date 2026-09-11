// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AppShell } from '../components/app-shell.js';

const mocks = vi.hoisted(() => ({
  auth: {
    firebaseUser: null as { displayName: string; photoURL: string | null } | null,
    loading: true,
    profile: null as { displayName: string } | null,
  },
}));

vi.mock('../features/auth-context.js', () => ({ useAuth: () => mocks.auth }));
vi.mock('../features/social-context.js', () => ({
  useSocial: () => ({ onlineCount: null, pendingCount: 0 }),
}));

function shell() {
  return <MemoryRouter><AppShell /></MemoryRouter>;
}

describe('restauração inicial da sessão', () => {
  beforeEach(() => {
    mocks.auth = { firebaseUser: null, loading: true, profile: null };
  });

  afterEach(cleanup);

  it('não anuncia "Visitante" enquanto o Firebase ainda restaura a sessão', () => {
    render(shell());
    expect(screen.getByText('Restaurando sessão')).toBeInTheDocument();
    expect(screen.queryByText('Visitante')).not.toBeInTheDocument();
    expect(screen.queryByText('Entrar')).not.toBeInTheDocument();
  });

  it('só oferece entrar depois que a restauração termina sem sessão', () => {
    mocks.auth = { firebaseUser: null, loading: false, profile: null };
    render(shell());
    expect(screen.getByText('Visitante')).toBeInTheDocument();
    expect(screen.getByText('Entrar')).toBeInTheDocument();
    expect(screen.queryByText('Restaurando sessão')).not.toBeInTheDocument();
  });

  it('mostra o perfil recuperado assim que ele chega', () => {
    mocks.auth = { firebaseUser: null, loading: false, profile: { displayName: 'Gomes' } };
    render(shell());
    expect(screen.getByText('Gomes')).toBeInTheDocument();
    expect(screen.queryByText('Restaurando sessão')).not.toBeInTheDocument();
  });
});

describe('persistência declarada do Firebase Auth', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('firebase/auth');
    vi.doUnmock('firebase/app');
  });

  it('declara IndexedDB antes de localStorage e usa o resolver de popup', async () => {
    interface AuthOptions { persistence: string[]; popupRedirectResolver: string }
    const initializeAuth = vi.fn(
      (app: unknown, options: AuthOptions) => ({ app, kind: 'initialized', options }),
    );
    const getAuth = vi.fn(() => ({ kind: 'fallback' }));
    vi.resetModules();
    vi.doMock('firebase/app', () => ({ initializeApp: () => ({ name: 'app' }) }));
    vi.doMock('firebase/auth', () => ({
      browserLocalPersistence: 'local',
      browserPopupRedirectResolver: 'resolver',
      getAuth,
      GoogleAuthProvider: class { },
      indexedDBLocalPersistence: 'indexeddb',
      initializeAuth,
    }));

    const firebase = await import('../lib/firebase.js');

    expect(initializeAuth).toHaveBeenCalledTimes(1);
    const options = initializeAuth.mock.calls[0]?.[1];
    // A ordem importa: IndexedDB é o que sobrevive ao PWA em standalone no celular.
    expect(options?.persistence).toEqual(['indexeddb', 'local']);
    expect(options?.popupRedirectResolver).toBe('resolver');
    expect(firebase.firebaseAuth).toMatchObject({ kind: 'initialized' });
    expect(getAuth).not.toHaveBeenCalled();
  });

  it('cai no auth já existente quando initializeAuth não é possível', async () => {
    const initializeAuth = vi.fn(() => { throw new Error('já inicializado'); });
    const getAuth = vi.fn(() => ({ kind: 'fallback' }));
    vi.resetModules();
    vi.doMock('firebase/app', () => ({ initializeApp: () => ({ name: 'app' }) }));
    vi.doMock('firebase/auth', () => ({
      browserLocalPersistence: 'local',
      browserPopupRedirectResolver: 'resolver',
      getAuth,
      GoogleAuthProvider: class { },
      indexedDBLocalPersistence: 'indexeddb',
      initializeAuth,
    }));

    const firebase = await import('../lib/firebase.js');

    // Sem fallback, um segundo import derrubava o app inteiro (e o jsdom dos testes).
    expect(firebase.firebaseAuth).toEqual({ kind: 'fallback' });
  });

  it('não força o seletor de contas do Google em todo login', async () => {
    const setCustomParameters = vi.fn();
    vi.resetModules();
    vi.doMock('firebase/app', () => ({ initializeApp: () => ({ name: 'app' }) }));
    vi.doMock('firebase/auth', () => ({
      browserLocalPersistence: 'local',
      browserPopupRedirectResolver: 'resolver',
      getAuth: vi.fn(() => ({ kind: 'fallback' })),
      GoogleAuthProvider: class { setCustomParameters = setCustomParameters; },
      indexedDBLocalPersistence: 'indexeddb',
      initializeAuth: vi.fn(() => ({ kind: 'initialized' })),
    }));

    await import('../lib/firebase.js');

    // `prompt: select_account` em todo login só atrasava a entrada de quem tem uma conta.
    expect(setCustomParameters).not.toHaveBeenCalled();
  });
});
