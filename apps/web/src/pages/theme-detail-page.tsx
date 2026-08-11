import { questionsForDifficulty, type Difficulty, type MatchMode } from '@quiz-gomes/domain';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Avatar } from '../components/avatar.js';
import { Button } from '../components/button.js';
import { ErrorState, LoadingState } from '../components/async-state.js';
import { Icon } from '../components/icons.js';
import { MatchmakingDialog } from '../components/matchmaking-dialog.js';
import { RankBadge } from '../components/rank-badge.js';
import { useAuth } from '../features/auth-context.js';
import { useMatchmaking } from '../hooks/use-matchmaking.js';
import { apiRequest } from '../lib/api.js';
import type { ThemeDetailResponse } from '../lib/models.js';

const difficultyLabel: Record<Difficulty, string> = { EASY: 'Fácil', MEDIUM: 'Médio', HARD: 'Difícil' };

export function ThemeDetailPage() {
  const { slug = '' } = useParams();
  const { getToken, profile, signIn } = useAuth();
  const [data, setData] = useState<ThemeDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty>('EASY');
  const [mode, setMode] = useState<MatchMode>('CASUAL');
  const [reload, setReload] = useState(0);
  const matchmaking = useMatchmaking();

  useEffect(() => {
    void getToken().then((token) => apiRequest<ThemeDetailResponse>(`/api/themes/${encodeURIComponent(slug)}`, {
      getToken,
      token,
    }))
      .then((result) => { setData(result); setError(null); })
      .catch((requestError: unknown) => setError(requestError instanceof Error ? requestError.message : 'Não foi possível carregar o tema.'));
  }, [getToken, reload, slug]);

  if (data === null && error === null) return <LoadingState label="Abrindo o tema" />;
  if (error !== null || data === null) return <ErrorState message={error ?? 'Tema indisponível.'} onRetry={() => setReload((value) => value + 1)} />;

  const required = questionsForDifficulty(difficulty);
  const available = data.questionCounts[difficulty];
  const canPlay = available >= required;
  const realtimeEnabled = import.meta.env.VITE_ENABLE_REALTIME_MATCHES === 'true';

  return (
    <section className="page page--theme-detail">
      <Link className="back-link" to="/"><Icon name="back" />Temas</Link>
      <div className="theme-hero">
        <span className="theme-hero__art" aria-hidden="true">{data.theme.name.slice(0, 2).toLocaleUpperCase('pt-BR')}</span>
        <div><span className="eyebrow">{data.theme.categoryName}</span><h1>{data.theme.name}</h1><p>{data.theme.description}</p><span className="question-count"><Icon name="bolt" />{data.theme.activeQuestionCount.toLocaleString('pt-BR')} perguntas ativas</span></div>
      </div>

      <div className="theme-layout">
        <div className="play-card">
          <div><span className="eyebrow">Nova partida</span><h2>Escolha o desafio</h2></div>
          <div className="difficulty-grid">
            {(['EASY', 'MEDIUM', 'HARD'] as Difficulty[]).map((value) => (
              <button className={difficulty === value ? 'difficulty difficulty--active' : 'difficulty'} key={value} onClick={() => setDifficulty(value)} type="button"><strong>{difficultyLabel[value]}</strong><small>{questionsForDifficulty(value)} perguntas · {data.questionCounts[value]} disponíveis</small></button>
            ))}
          </div>
          <div className="segmented segmented--wide" role="radiogroup" aria-label="Modo de partida">
            {(['CASUAL', 'RANKED'] as MatchMode[]).map((value) => <button aria-checked={mode === value} className={mode === value ? 'segmented__active' : ''} key={value} onClick={() => setMode(value)} role="radio" type="button">{value === 'CASUAL' ? 'Casual' : 'Ranqueada'}</button>)}
          </div>
          {!canPlay && <p className="inline-notice">Este pool ainda precisa de {required} perguntas ativas para uma partida {difficultyLabel[difficulty]}.</p>}
          {!realtimeEnabled && canPlay && <p className="inline-notice">O catálogo está pronto; partidas online serão liberadas após a validação do servidor de rodadas.</p>}
          {matchmaking.error && <p className="form-error">{matchmaking.error}</p>}
          {profile === null
            ? <Button onClick={() => void signIn()}>Entrar para jogar</Button>
            : <Button disabled={!canPlay || !realtimeEnabled} onClick={() => void matchmaking.start(data.theme.id, difficulty, mode)}>Buscar partida</Button>}
        </div>

        <aside className="leaderboard-card">
          <div className="section-heading"><div><span className="eyebrow">Neste tema</span><h2>Top 5</h2></div></div>
          {data.topFive.length === 0 ? <p className="leaderboard-empty">A primeira Ranqueada ainda está esperando por alguém.</p> : (
            <ol>{data.topFive.map((entry) => <li key={entry.publicId}><span className="leaderboard-position">{entry.position}</span><Avatar name={entry.displayName} photoUrl={entry.photoUrl} size="small" /><span><strong>{entry.displayName}</strong><small>{entry.publicId}</small></span><RankBadge knowledge={entry.knowledge} /></li>)}</ol>
          )}
        </aside>
      </div>

      <article className="personal-theme-card"><div><span className="eyebrow">Seu cartão</span><h2>{profile?.displayName ?? 'Entre para acompanhar'}</h2><p>{profile ? (data.personal?.rankedMatches ? 'Seu histórico neste tema é calculado apenas pelas partidas Ranqueadas.' : 'Sua história competitiva neste tema começa na primeira Ranqueada.') : 'Ranking, descoberta histórica e Conhecimento ficam reunidos aqui.'}</p></div><div className="personal-theme-card__stats"><RankBadge knowledge={data.personal?.knowledge ?? 0} showKnowledge /><span><strong>{(data.personal?.discoveredPercentage ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</strong><small>descoberto</small></span><span><strong>{data.personal?.position ? `#${data.personal.position}` : '—'}</strong><small>posição</small></span></div></article>

      {matchmaking.status !== 'idle' && <MatchmakingDialog onCancel={matchmaking.cancel} onClose={matchmaking.cancel} status={matchmaking.status} themeName={data.theme.name} />}
    </section>
  );
}
