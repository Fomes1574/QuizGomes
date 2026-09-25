// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  getToken: () => Promise.resolve('token'),
  profile: { displayName: 'Gomes' } as { displayName: string } | null,
  signIn: vi.fn(),
}));
vi.mock('../lib/api.js', () => ({ apiRequest: mocks.apiRequest }));
vi.mock('../features/auth-context.js', () => ({
  useAuth: () => ({ getToken: mocks.getToken, profile: mocks.profile, signIn: mocks.signIn }),
}));

import { ThemeSuggestions } from '../components/theme-suggestions.js';

const base = { createdAt: '2026-09-01', description: 'Dragões e cavaleiros', status: 'OPEN' as const };

describe('votação de próximos temas', () => {
  beforeEach(() => {
    mocks.apiRequest.mockReset();
    mocks.signIn.mockReset();
    mocks.profile = { displayName: 'Gomes' };
  });
  afterEach(() => cleanup());

  it('vota e reordena pela contagem devolvida pelo servidor', async () => {
    mocks.apiRequest.mockImplementation((path: string) => {
      if (path === '/api/theme-suggestions') {
        return Promise.resolve({ suggestions: [
          { ...base, id: 'a', name: 'Animes', voteCount: 2, voted: false },
          { ...base, id: 'b', name: 'Bruxaria', voteCount: 1, voted: false },
        ] });
      }
      return Promise.resolve({ suggestion: { ...base, id: 'b', name: 'Bruxaria', voteCount: 3, voted: true } });
    });
    render(<ThemeSuggestions />);
    fireEvent.click(await screen.findByRole('button', { name: 'Votar em Bruxaria' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Tirar voto de Bruxaria' })).toHaveAttribute('aria-pressed', 'true'));
    expect(mocks.apiRequest).toHaveBeenCalledWith('/api/theme-suggestions/b/vote', expect.objectContaining({ method: 'PUT' }));
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('Bruxaria');
  });

  it('sem login, o botão leva para entrar; sem candidatos, a seção some', async () => {
    mocks.profile = null;
    mocks.apiRequest.mockResolvedValue({ suggestions: [{ ...base, id: 'a', name: 'Animes', voteCount: 0, voted: false }] });
    render(<ThemeSuggestions />);
    fireEvent.click(await screen.findByRole('button', { name: 'Entrar para votar em Animes' }));
    expect(mocks.signIn).toHaveBeenCalled();
    cleanup();
    mocks.apiRequest.mockResolvedValue({ suggestions: [] });
    const { container } = render(<ThemeSuggestions />);
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
