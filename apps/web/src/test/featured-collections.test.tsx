// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CollectionsCard } from '../components/profile-sections.js';
import { ThemesPage } from '../pages/themes-page.js';

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock('../lib/api.js', () => ({ apiRequest: mocks.apiRequest }));
vi.mock('../features/social-context.js', () => ({ useQueueActivity: () => new Map() }));
vi.mock('../components/theme-suggestions.js', () => ({ ThemeSuggestions: () => null }));

const theme = (id: string, name: string, featured = false) => ({
  activeQuestionCount: 40, artwork: { kind: 'NONE', version: 0 }, categoryId: 'animes', categoryName: 'Animes',
  coverImageKey: null, description: '', id, name, slug: id, ...(featured ? { featured: true } : {}),
});

describe('temas em destaque', () => {
  afterEach(() => { cleanup(); mocks.apiRequest.mockReset(); });

  it('abrem a tela de Temas numa fileira própria', async () => {
    mocks.apiRequest.mockImplementation((path: string) => Promise.resolve(path === '/api/categories'
      ? { categories: [{ id: 'animes', name: 'Animes', slug: 'animes' }] }
      : { themes: [theme('lost', 'Lost', true), theme('naruto', 'Naruto')] }));
    render(<MemoryRouter><ThemesPage /></MemoryRouter>);
    const featured = (await screen.findByRole('heading', { name: 'Em destaque' })).closest('section');
    if (featured === null) throw new Error('fileira ausente');
    expect(within(featured).getByText('Lost')).toBeInTheDocument();
    expect(within(featured).queryByText('Naruto')).not.toBeInTheDocument();
  });

  it('sem destaque, a fileira não aparece', async () => {
    mocks.apiRequest.mockImplementation((path: string) => Promise.resolve(path === '/api/categories'
      ? { categories: [{ id: 'animes', name: 'Animes', slug: 'animes' }] }
      : { themes: [theme('naruto', 'Naruto')] }));
    render(<MemoryRouter><ThemesPage /></MemoryRouter>);
    await screen.findByRole('heading', { name: 'Animes' });
    expect(screen.queryByRole('heading', { name: 'Em destaque' })).not.toBeInTheDocument();
  });
});

describe('coleções', () => {
  afterEach(() => cleanup());

  it('mostra quantos temas de cada categoria já têm título', () => {
    render(<CollectionsCard collections={[
      { categoryId: 'animes', categoryName: 'Animes', total: 8, withTitle: 3 },
      { categoryId: 'series', categoryName: 'Séries', total: 2, withTitle: 2 },
    ]} />);
    expect(screen.getByText('3 de 8')).toBeInTheDocument();
    expect(screen.getByText('Séries').closest('li')).toHaveAttribute('data-complete', 'true');
  });
});
