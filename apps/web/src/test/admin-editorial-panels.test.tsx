// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminCategoriesPanel, AdminQuestionEditorialPanel, AdminThemeModerationPanel } from '../pages/admin-editorial-panels.js';

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn(), getToken: vi.fn(() => Promise.resolve('synthetic-auth')) }));
vi.mock('../lib/api.js', () => ({ apiRequest: mocks.apiRequest }));

describe('AdminCategoriesPanel', () => {
  beforeEach(() => { mocks.apiRequest.mockReset(); });
  afterEach(cleanup);

  it('lista categorias existentes e cria uma nova', async () => {
    mocks.apiRequest.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/api/admin/categories' && (options?.method ?? 'GET') === 'GET') {
        return Promise.resolve({ categories: [{ id: 'cat-1', name: 'Esportes', revision: 1, slug: 'esportes', sortOrder: 0, status: 'ACTIVE' }] });
      }
      if (path === '/api/admin/categories' && options?.method === 'POST') {
        return Promise.resolve({ category: { id: 'cat-2', name: 'Ciência', revision: 1, slug: 'ciencia', sortOrder: 1, status: 'ACTIVE' } });
      }
      return Promise.resolve({ ok: true });
    });
    render(<AdminCategoriesPanel getToken={mocks.getToken} />);
    expect(await screen.findByDisplayValue('Esportes')).toBeInTheDocument();

    fireEvent.change(screen.getAllByRole('textbox')[0]!, { target: { value: 'Ciência' } });
    fireEvent.change(screen.getAllByRole('textbox')[1]!, { target: { value: 'ciencia' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar categoria' }));

    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledWith('/api/admin/categories', expect.objectContaining({
      body: { name: 'Ciência', slug: 'ciencia', sortOrder: 0 }, method: 'POST',
    })));
    expect(await screen.findByDisplayValue('Ciência')).toBeInTheDocument();
  });
});

describe('AdminThemeModerationPanel', () => {
  beforeEach(() => { mocks.apiRequest.mockReset(); });
  afterEach(cleanup);

  const pendingTheme = {
    activeQuestionCount: 0, artwork: { kind: 'NONE' as const, version: 0 }, categoryId: 'cat-1', categoryName: 'Jogos',
    createdByUserId: 'user-1', coverImageKey: null, description: 'Um tema proposto.', id: 'theme-1', name: 'Tema Proposto',
    origin: 'USER' as const, rejectionNote: null, revision: 1, slug: 'tema-proposto', status: 'PENDING' as const,
  };

  it('mostra temas pendentes e aprova com a revisão esperada', async () => {
    mocks.apiRequest.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/api/admin/themes' && (options?.method ?? 'GET') === 'GET') return Promise.resolve({ themes: [pendingTheme] });
      if (path === '/api/admin/themes/theme-1/approve') return Promise.resolve({ theme: { ...pendingTheme, revision: 2, status: 'ACTIVE' } });
      return Promise.resolve({ ok: true });
    });
    render(<AdminThemeModerationPanel getToken={mocks.getToken} />);
    expect(await screen.findByText('Tema Proposto')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Aprovar' }));
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledWith('/api/admin/themes/theme-1/approve', expect.objectContaining({
      body: { expectedRevision: 1 }, method: 'POST',
    })));
  });
});

describe('AdminQuestionEditorialPanel', () => {
  beforeEach(() => { mocks.apiRequest.mockReset(); });
  afterEach(cleanup);

  const theme = {
    activeQuestionCount: 5, artwork: { kind: 'NONE' as const, version: 0 }, categoryId: 'cat-1', categoryName: 'Jogos',
    createdByUserId: null, coverImageKey: null, description: 'x', id: 'theme-1', name: 'Tema Um',
    origin: 'OFFICIAL' as const, rejectionNote: null, revision: 1, slug: 'tema-um', status: 'ACTIVE' as const,
  };
  const question = {
    activeSlot: null, correctOption: 0, createdAt: '2026-01-01T00:00:00.000Z', createdByUserId: 'user-1', difficulty: 'EASY' as const,
    id: 'question-1', options: ['A', 'B', 'C', 'D'] as const, poolId: 'pool-1', prompt: 'Pergunta em revisão?',
    replacesQuestionId: null, resolutionNote: null, resolvedAt: null, resolvedByUserId: null, sources: [], status: 'IN_REVIEW' as const, themeId: 'theme-1',
  };

  it('busca tema, lista perguntas em revisão e aprova', async () => {
    mocks.apiRequest.mockImplementation((path: string) => {
      if (path.startsWith('/api/admin/themes?')) return Promise.resolve({ themes: [theme] });
      if (path.startsWith('/api/editorial/themes/theme-1/questions')) return Promise.resolve({ nextCursor: null, questions: [question] });
      if (path === '/api/editorial/questions/question-1/approve') return Promise.resolve({ ok: true });
      return Promise.resolve({ ok: true });
    });
    render(<AdminQuestionEditorialPanel getToken={mocks.getToken} />);

    fireEvent.change(screen.getByPlaceholderText('Buscar tema'), { target: { value: 'Tema' } });
    await screen.findByRole('option', { name: 'Tema Um' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Tema' }), { target: { value: 'theme-1' } });

    expect(await screen.findByText('Pergunta em revisão?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Aprovar' }));
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledWith('/api/editorial/questions/question-1/approve', expect.objectContaining({
      body: {}, method: 'POST',
    })));
  });
});
