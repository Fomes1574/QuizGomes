// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '../components/app-shell.js';

const state = vi.hoisted(() => ({ pendingCount: 2 }));

vi.mock('../features/auth-context.js', () => ({
  useAuth: () => ({ firebaseUser: null, profile: null }),
}));
vi.mock('../features/social-context.js', () => ({
  useSocial: () => ({ pendingCount: state.pendingCount }),
}));

describe('badge Social conta somente pedidos recebidos reais', () => {
  afterEach(() => cleanup());

  it('apresenta quantidade recebida acessível na aba Social', () => {
    state.pendingCount = 2;
    render(<MemoryRouter><AppShell /></MemoryRouter>);
    expect(screen.getByLabelText('2 solicitações de amizade recebidas')).toHaveTextContent('2');
    expect(screen.getByRole('navigation', { name: 'Navegação principal' })).toHaveTextContent('Social');
  });

  it('não mostra badge quando não existem pedidos PENDING recebidos', () => {
    state.pendingCount = 0;
    render(<MemoryRouter><AppShell /></MemoryRouter>);
    expect(screen.queryByLabelText(/solicitações de amizade recebidas/)).not.toBeInTheDocument();
  });
});
