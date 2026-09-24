// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CreatePage } from '../pages/create-page.js';

interface MockAuth {
  firebaseUser: { displayName: string; photoURL: string | null };
  getToken: () => Promise<string | null>;
  profile: { displayName: string; publicId: string };
  role: 'ADMIN' | 'PLAYER';
  signIn: () => Promise<void>;
}

const mocks = vi.hoisted(() => {
  const getToken = vi.fn(() => Promise.resolve('synthetic-auth'));
  const adminAuth = {
    firebaseUser: { displayName: 'Admin', photoURL: null },
    getToken,
    profile: { displayName: 'Admin', publicId: '#QGADMIN1' },
    role: 'ADMIN' as const,
    signIn: vi.fn(() => Promise.resolve()),
  };
  const currentAuth: MockAuth = adminAuth;
  return {
    adminAuth,
    apiRequest: vi.fn(),
    currentAuth,
    getToken,
    playerAuth: { ...adminAuth, role: 'PLAYER' as const },
  };
});

vi.mock('../lib/api.js', () => ({ apiRequest: mocks.apiRequest, apiUpload: vi.fn() }));
vi.mock('../features/auth-context.js', () => ({
  useAuth: () => mocks.currentAuth,
}));

const reportEntry = {
  questionMetadata: {
    sources: [{ sourceKind: 'PRIMARY', title: 'Fonte oficial', url: 'https://example.test/source' }],
    statistics: { answerCount: 11, correctCount: 7, optionACount: 2, optionBCount: 7, optionCCount: 1, optionDCount: 1, totalResponseMs: 10_000, useCount: 12, wrongCount: 4 },
    themeName: 'Geografia',
  },
  questionSnapshot: { correctOption: 1, imageUrl: null, options: ['Errada', 'Certa', 'X', 'Y'], prompt: 'Qual é a capital?' },
  report: {
    contextId: 'match-1', contextKind: 'MATCH' as const, createdAt: '2026-09-17T10:00:00.000Z',
    id: 'report-1', note: 'Parece errada.', questionId: 'question-1', reason: 'INCORRECT' as const,
    resolutionNote: null, resolvedAt: null, resolvedByUserId: null, roundNumber: 3, status: 'OPEN' as const,
  },
};

describe('painel administrativo de denúncias', () => {
  beforeEach(() => {
    mocks.apiRequest.mockReset();
    mocks.apiRequest.mockImplementation((path: string) => {
      if (path === '/api/categories') return Promise.resolve({ categories: [] });
      if (path === '/api/admin/categories') return Promise.resolve({ categories: [] });
      if (path.startsWith('/api/admin/themes')) return Promise.resolve({ themes: [] });
      if (path.startsWith('/api/admin/reports?')) return Promise.resolve({ nextCursor: null, reports: [reportEntry] });
      if (path.startsWith('/api/admin/users')) return Promise.resolve({ nextCursor: null, users: [] });
      if (path.startsWith('/api/admin/audit-logs')) return Promise.resolve({ entries: [], nextCursor: null });
      return Promise.resolve({ ok: true });
    });
    mocks.currentAuth = mocks.adminAuth;
  });

  afterEach(cleanup);

  it('não aparece para quem não é ADMIN', async () => {
    mocks.currentAuth = mocks.playerAuth;
    render(<CreatePage />);
    await waitFor(() => { expect(mocks.apiRequest).toHaveBeenCalledWith('/api/categories'); });
    expect(screen.queryByText('Denúncias de perguntas')).not.toBeInTheDocument();
  });

  it('lista a fila OPEN com a pergunta, as alternativas e a correta marcada', async () => {
    render(<CreatePage />);
    expect(await screen.findByText('Qual é a capital?')).toBeInTheDocument();
    expect(screen.getByText('Certa').closest('li')).toHaveClass('report-card__option--correct');
    expect(screen.getByText('Parece errada.', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Geografia', { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Fonte oficial' })).toHaveAttribute('href', 'https://example.test/source');
  });

  it('trocar a aba de status busca a fila correspondente', async () => {
    render(<CreatePage />);
    await screen.findByText('Qual é a capital?');
    mocks.apiRequest.mockImplementation((path: string) => {
      if (path === '/api/categories') return Promise.resolve({ categories: [] });
      if (path === '/api/admin/categories') return Promise.resolve({ categories: [] });
      if (path.startsWith('/api/admin/themes')) return Promise.resolve({ themes: [] });
      if (path.startsWith('/api/admin/reports?')) return Promise.resolve({ nextCursor: null, reports: [] });
      if (path.startsWith('/api/admin/users')) return Promise.resolve({ nextCursor: null, users: [] });
      if (path.startsWith('/api/admin/audit-logs')) return Promise.resolve({ entries: [], nextCursor: null });
      return Promise.resolve({ ok: true });
    });

    fireEvent.click(screen.getByRole('tab', { name: 'Resolvidas' }));

    await waitFor(() => {
      expect(mocks.apiRequest).toHaveBeenCalledWith(
        expect.stringContaining('status=RESOLVED'),
        expect.anything(),
      );
    });
  });

  it('resolver uma denúncia envia a nota e remove o card da fila', async () => {
    mocks.apiRequest.mockImplementation((path: string) => {
      if (path === '/api/categories') return Promise.resolve({ categories: [] });
      if (path === '/api/admin/categories') return Promise.resolve({ categories: [] });
      if (path.startsWith('/api/admin/themes')) return Promise.resolve({ themes: [] });
      if (path.startsWith('/api/admin/reports?')) return Promise.resolve({ nextCursor: null, reports: [reportEntry] });
      if (path === '/api/admin/reports/report-1/resolve') {
        return Promise.resolve({ report: { ...reportEntry.report, status: 'RESOLVED' } });
      }
      if (path.startsWith('/api/admin/users')) return Promise.resolve({ nextCursor: null, users: [] });
      if (path.startsWith('/api/admin/audit-logs')) return Promise.resolve({ entries: [], nextCursor: null });
      return Promise.resolve({ ok: true });
    });
    render(<CreatePage />);
    await screen.findByText('Qual é a capital?');

    fireEvent.change(screen.getByRole('textbox', { name: /Nota de resolução/ }), {
      target: { value: 'Confirmado: a pergunta está mesmo errada.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Resolver' }));

    await waitFor(() => {
      expect(mocks.apiRequest).toHaveBeenCalledWith('/api/admin/reports/report-1/resolve', expect.objectContaining({
        body: { resolutionNote: 'Confirmado: a pergunta está mesmo errada.', status: 'RESOLVED' },
        method: 'POST',
      }));
    });
    await waitFor(() => { expect(screen.queryByText('Qual é a capital?')).not.toBeInTheDocument(); });
  });
});
