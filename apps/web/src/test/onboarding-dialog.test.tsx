// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { User } from 'firebase/auth';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OnboardingDialog } from '../components/onboarding-dialog.js';
import { useAuth } from '../features/auth-context.js';

vi.mock('../features/auth-context.js', () => ({ useAuth: vi.fn() }));

const mockedUseAuth = vi.mocked(useAuth);

describe('onboarding', () => {
  afterEach(() => {
    cleanup();
    mockedUseAuth.mockReset();
  });

  function authWith(overrides: Partial<ReturnType<typeof useAuth>>): ReturnType<typeof useAuth> {
    return {
      createProfile: vi.fn().mockResolvedValue(undefined),
      error: null,
      firebaseUser: { displayName: 'Matheus', uid: 'firebase-fixture-uid' } as User,
      getToken: vi.fn().mockResolvedValue('token'),
      loading: false,
      profile: null,
      profileStatus: 'missing',
      removeCustomAvatar: vi.fn().mockResolvedValue(undefined),
      retryProfile: vi.fn().mockResolvedValue(undefined),
      role: null,
      signIn: vi.fn().mockResolvedValue(undefined),
      signOut: vi.fn().mockResolvedValue(undefined),
      updateDisplayName: vi.fn().mockResolvedValue(undefined),
      uploadCustomAvatar: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    };
  }

  it('permite sair ou trocar a conta sem criar perfil', async () => {
    const createProfile = vi.fn().mockResolvedValue(undefined);
    const signOut = vi.fn().mockResolvedValue(undefined);
    mockedUseAuth.mockReturnValue(authWith({ createProfile, signOut }));

    render(<OnboardingDialog />);
    fireEvent.click(screen.getByRole('button', { name: 'Sair / trocar conta' }));

    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
    expect(createProfile).not.toHaveBeenCalled();
  });

  it('falha de rede ao carregar um perfil existente mostra "tentar de novo", nunca o primeiro acesso', async () => {
    const retryProfile = vi.fn().mockResolvedValue(undefined);
    mockedUseAuth.mockReturnValue(authWith({ error: 'Falha de rede', profileStatus: 'error', retryProfile }));
    render(<OnboardingDialog />);
    expect(screen.queryByText('Como você quer ser chamado?')).not.toBeInTheDocument();
    expect(screen.getByText('Não conseguimos carregar seu perfil')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    await waitFor(() => expect(retryProfile).toHaveBeenCalledTimes(1));
  });

  it('conta desativada explica o motivo e só oferece sair', () => {
    mockedUseAuth.mockReturnValue(authWith({ error: 'Esta conta está desativada.', profileStatus: 'disabled' }));
    render(<OnboardingDialog />);
    expect(screen.getByText('Conta desativada')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tentar de novo' })).not.toBeInTheDocument();
  });
});
