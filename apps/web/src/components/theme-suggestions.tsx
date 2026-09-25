import { useEffect, useState, type CSSProperties } from 'react';
import { useAuth } from '../features/auth-context.js';
import { apiRequest } from '../lib/api.js';
import { feedback } from '../lib/feedback.js';
import type { ThemeSuggestion } from '../lib/models.js';
import { Icon } from './icons.js';

/**
 * "Qual tema você quer ver?": a administração escolhe os candidatos, a
 * galera vota. Some quando não há candidato aberto.
 */
export function ThemeSuggestions() {
  const { getToken, profile, signIn } = useAuth();
  const [suggestions, setSuggestions] = useState<ThemeSuggestion[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const signedIn = profile !== null;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const token = signedIn ? await getToken() : null;
      const result = await apiRequest<{ suggestions: ThemeSuggestion[] }>('/api/theme-suggestions', token === null ? {} : { getToken, token });
      if (!cancelled) setSuggestions(Array.isArray(result.suggestions) ? result.suggestions : []);
    };
    load().catch(() => { if (!cancelled) setSuggestions([]); });
    return () => { cancelled = true; };
  }, [getToken, signedIn]);

  if (suggestions.length === 0) return null;
  const top = Math.max(1, ...suggestions.map((suggestion) => suggestion.voteCount));

  async function toggle(suggestion: ThemeSuggestion) {
    if (!signedIn) { void signIn(); return; }
    setBusyId(suggestion.id);
    setError(null);
    feedback('tap');
    try {
      const result = await apiRequest<{ suggestion: ThemeSuggestion }>(
        `/api/theme-suggestions/${encodeURIComponent(suggestion.id)}/vote`,
        { getToken, method: suggestion.voted ? 'DELETE' : 'PUT' },
      );
      setSuggestions((current) => current
        .map((item) => (item.id === result.suggestion.id ? result.suggestion : item))
        .sort((left, right) => right.voteCount - left.voteCount));
    } catch (voteError) {
      setError(voteError instanceof Error ? voteError.message : 'Não foi possível registrar o voto.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section aria-labelledby="theme-suggestions-title" className="theme-suggestions">
      <div className="section-heading">
        <div><span className="eyebrow">Próximos temas</span><h2 id="theme-suggestions-title">Qual tema você quer ver?</h2></div>
      </div>
      <p className="theme-suggestions__lead">Vote nos que você jogaria. Pode escolher mais de um.</p>
      <ul>
        {suggestions.map((suggestion) => (
          <li key={suggestion.id} style={{ '--share': suggestion.voteCount / top } as CSSProperties}>
            <span aria-hidden="true" className="theme-suggestions__bar" />
            <span className="theme-suggestions__copy">
              <strong>{suggestion.name}</strong>
              {suggestion.description !== null && <small>{suggestion.description}</small>}
            </span>
            <span className="theme-suggestions__count">{suggestion.voteCount.toLocaleString('pt-BR')}</span>
            <button
              aria-label={signedIn ? `${suggestion.voted ? 'Tirar voto de' : 'Votar em'} ${suggestion.name}` : `Entrar para votar em ${suggestion.name}`}
              aria-pressed={suggestion.voted}
              className={`theme-suggestions__vote${suggestion.voted ? ' theme-suggestions__vote--on' : ''}`}
              disabled={busyId !== null}
              onClick={() => void toggle(suggestion)}
              type="button"
            >{suggestion.voted ? <><Icon name="check" />Votei</> : 'Quero'}</button>
          </li>
        ))}
      </ul>
      {error !== null && <p className="form-error" role="alert">{error}</p>}
    </section>
  );
}
