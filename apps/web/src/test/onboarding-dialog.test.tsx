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

  it('permite sair ou trocar a conta sem criar perfil', async () => {
    const createProfile = vi.fn().mockResolvedValue(undefined);
    const signOut = vi.fn().mockResolvedValue(undefined);
    mockedUseAuth.mockReturnValue({
      createProfile,
      error: null,
      firebaseUser: { displayName: 'Matheus', uid: 'firebase-fixture-uid' } as User,
      getToken: vi.fn().mockResolvedValue('token'),
      loading: false,
      profile: null,
      removeCustomAvatar: vi.fn().mockResolvedValue(undefined),
      role: null,
      signIn: vi.fn().mockResolvedValue(undefined),
      signOut,
      updateDisplayName: vi.fn().mockResolvedValue(undefined),
      uploadCustomAvatar: vi.fn().mockResolvedValue(undefined),
    });

    render(<OnboardingDialog />);
    fireEvent.click(screen.getByRole('button', { name: 'Sair / trocar conta' }));

    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
    expect(createProfile).not.toHaveBeenCalled();
  });
});
