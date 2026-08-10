import { useEffect, useMemo, useState } from 'react';
import { EmptyState, ErrorState, LoadingState } from '../components/async-state.js';
import { Icon } from '../components/icons.js';
import { ThemeCard } from '../components/theme-card.js';
import { apiRequest } from '../lib/api.js';
import type { Category, ThemeSummary } from '../lib/models.js';

export function ThemesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [themes, setThemes] = useState<ThemeSummary[]>([]);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const delay = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (selectedCategory) params.set('category', selectedCategory);
      void Promise.all([
        apiRequest<{ categories: Category[] }>('/api/categories', { signal: controller.signal }),
        apiRequest<{ themes: ThemeSummary[] }>(`/api/themes?${params}`, { signal: controller.signal }),
      ]).then(([categoryResult, themeResult]) => {
        setCategories(categoryResult.categories);
        setThemes(themeResult.themes);
      }).catch((requestError: unknown) => {
        if (requestError instanceof DOMException && requestError.name === 'AbortError') return;
        setError(requestError instanceof Error ? requestError.message : 'Não foi possível carregar os temas.');
      }).finally(() => setLoading(false));
    }, 180);
    return () => {
      controller.abort();
      clearTimeout(delay);
    };
  }, [reload, search, selectedCategory]);

  const grouped = useMemo(() => categories.map((category) => ({
    category,
    themes: themes.filter((theme) => theme.categoryId === category.id),
  })).filter((group) => group.themes.length > 0), [categories, themes]);

  return (
    <section className="page page--themes">
      <div className="page-heading page-heading--hero">
        <div>
          <span className="eyebrow">Escolha seu campo</span>
          <h1>Qual é o seu assunto?</h1>
          <p>Encontre um tema e transforme o que você sabe em Conhecimento.</p>
        </div>
        <span className="hero-stat"><strong>{themes.length}</strong><small>temas encontrados</small></span>
      </div>

      <label className="search-field">
        <Icon name="search" />
        <span className="sr-only">Buscar tema</span>
        <input onChange={(event) => setSearch(event.target.value)} placeholder="Buscar um tema" type="search" value={search} />
        {search && <button aria-label="Limpar busca" onClick={() => setSearch('')} type="button"><Icon name="close" /></button>}
      </label>

      <div className="chip-row" aria-label="Filtrar por categoria">
        <button className={selectedCategory === null ? 'chip chip--active' : 'chip'} onClick={() => setSelectedCategory(null)} type="button">Todos</button>
        {categories.map((category) => (
          <button className={selectedCategory === category.id ? 'chip chip--active' : 'chip'} key={category.id} onClick={() => setSelectedCategory(category.id)} type="button">
            {category.name}
          </button>
        ))}
      </div>

      {loading && themes.length === 0 ? <LoadingState label="Organizando os temas" /> : null}
      {error ? <ErrorState message={error} onRetry={() => setReload((value) => value + 1)} /> : null}
      {!loading && !error && grouped.length === 0 ? (
        <EmptyState description="Tente outro nome ou remova o filtro de categoria." title="Nenhum tema por aqui" />
      ) : null}
      {!error && grouped.map(({ category, themes: categoryThemes }) => (
        <section className="theme-group" key={category.id}>
          <div className="section-heading"><h2>{category.name}</h2><span>{categoryThemes.length}</span></div>
          <div className="theme-grid">{categoryThemes.map((theme) => <ThemeCard key={theme.id} theme={theme} />)}</div>
        </section>
      ))}
    </section>
  );
}
