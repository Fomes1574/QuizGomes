import { questionsForMode } from '@quiz-gomes/domain';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { EmptyState, ErrorState } from '../components/async-state.js';
import { Button } from '../components/button.js';
import { Icon } from '../components/icons.js';
import { ThemeArtwork } from '../components/theme-artwork.js';
import { ThemeCard } from '../components/theme-card.js';
import { useQueueActivity } from '../features/social-context.js';
import { apiRequest } from '../lib/api.js';
import { feedback, prefersReducedMotion } from '../lib/feedback.js';
import type { Category, ThemeSummary } from '../lib/models.js';
import { pickSurpriseTheme, totalWaiting } from '../lib/queue-activity.js';

const HEADLINE_INTERVAL_MS = 2_400;
const SHUFFLE_MS = 520;

/** Troca o nome em destaque no título a cada poucos segundos, usando temas reais do catálogo. */
function useRotatingName(names: readonly string[]): string | null {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (names.length < 2 || prefersReducedMotion()) return undefined;
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % names.length), HEADLINE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [names]);
  return names.length === 0 ? null : names[index % names.length] ?? null;
}

function ThemeRowSkeleton() {
  return (
    <section aria-hidden="true" className="theme-group">
      <span className="skeleton theme-group__skeleton-title" />
      <div className="theme-grid">
        {Array.from({ length: 4 }, (_, index) => <span className="skeleton theme-card-skeleton" key={index} />)}
      </div>
    </section>
  );
}

export function ThemesPage() {
  const navigate = useNavigate();
  const [categories, setCategories] = useState<Category[]>([]);
  const [themes, setThemes] = useState<ThemeSummary[]>([]);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [shuffling, setShuffling] = useState(false);
  const queueActivity = useQueueActivity();

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

  const playable = useMemo(
    () => themes.filter((theme) => theme.activeQuestionCount >= questionsForMode('CASUAL')),
    [themes],
  );
  const headlineNames = useMemo(() => playable.slice(0, 8).map((theme) => theme.name), [playable]);
  const headlineName = useRotatingName(headlineNames);
  const deck = useMemo(() => [...playable]
    .sort((left, right) => Number(right.artwork.kind === 'CUSTOM') - Number(left.artwork.kind === 'CUSTOM'))
    .slice(0, 3), [playable]);

  const liveThemes = useMemo(() => playable.filter((theme) => totalWaiting(queueActivity, theme.id) > 0), [playable, queueActivity]);
  const liveWaiting = liveThemes.reduce((sum, theme) => sum + totalWaiting(queueActivity, theme.id), 0);

  function surprise() {
    const pick = pickSurpriseTheme(playable, queueActivity);
    if (pick === undefined || shuffling) return;
    feedback('tap');
    if (prefersReducedMotion()) {
      void navigate(`/temas/${pick.slug}`);
      return;
    }
    setShuffling(true);
    window.setTimeout(() => void navigate(`/temas/${pick.slug}`), SHUFFLE_MS);
  }

  return (
    <section className="page page--themes">
      <div className="themes-hero">
        <span className="eyebrow">Escolha sua carta</span>
        <h1>
          Quem manja mais de{' '}
          <span className="themes-hero__rotator">
            <span key={headlineName ?? 'tudo'}>{headlineName ?? 'tudo'}</span>
          </span>
          ?
        </h1>
        <p>Puxe uma partida contra alguém de verdade. Dez segundos por pergunta, sem desempate.</p>
        <div className="themes-hero__actions">
          <Button
            className={shuffling ? 'button--shuffling' : ''}
            disabled={playable.length === 0}
            onClick={surprise}
            variant="secondary"
          >
            <Icon className="themes-hero__dice" name="dice" />
            Surpreenda-me
          </Button>
          {liveWaiting > 0 && (
            <span className="themes-hero__live" role="status">
              <span aria-hidden="true" className="theme-card__live-dot" />
              {liveWaiting === 1 ? '1 pessoa' : `${liveWaiting} pessoas`} na fila agora
              {liveThemes.length === 1 && liveThemes[0] !== undefined ? ` em ${liveThemes[0].name}` : ''}
            </span>
          )}
        </div>
        {deck.length === 3 && (
          <div aria-label="Temas em destaque" className="themes-hero__deck">
            {deck.map((theme) => (
              <Link className="themes-hero__deck-card" key={theme.id} to={`/temas/${theme.slug}`}>
                <ThemeArtwork artwork={theme.artwork} name={theme.name} />
                <span className="themes-hero__deck-name">{theme.name}</span>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="themes-toolbar">
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
      </div>

      {loading && themes.length === 0 ? (
        <div className="themes-loading" role="status">
          <span className="sr-only">Organizando os temas</span>
          <ThemeRowSkeleton />
          <ThemeRowSkeleton />
        </div>
      ) : null}
      {error ? <ErrorState message={error} onRetry={() => setReload((value) => value + 1)} /> : null}
      {!loading && !error && grouped.length === 0 ? (
        <EmptyState description="Tente outro nome ou remova o filtro de categoria." title="Nenhum tema por aqui" />
      ) : null}
      {!error && grouped.map(({ category, themes: categoryThemes }) => (
        <section className="theme-group" key={category.id}>
          <div className="section-heading"><h2>{category.name}</h2><span>{categoryThemes.length}</span></div>
          <div className="theme-grid">
            {categoryThemes.map((theme, index) => <ThemeCard index={index} key={theme.id} theme={theme} waiting={totalWaiting(queueActivity, theme.id)} />)}
          </div>
        </section>
      ))}
    </section>
  );
}
