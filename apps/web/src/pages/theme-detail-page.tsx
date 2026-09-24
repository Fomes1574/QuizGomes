import { questionsForMode, type MatchMode } from '@quiz-gomes/domain';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { Avatar } from '../components/avatar.js';
import { AvatarFrame } from '../components/avatar-frame.js';
import { Button } from '../components/button.js';
import { ErrorState, LoadingState } from '../components/async-state.js';
import { Icon } from '../components/icons.js';
import { FriendChallengeDialog } from '../components/friend-challenge-dialog.js';
import { MatchmakingDialog } from '../components/matchmaking-dialog.js';
import { RankBadge } from '../components/rank-badge.js';
import { ThemeArtwork } from '../components/theme-artwork.js';
import { useAuth } from '../features/auth-context.js';
import { useFriendChallenge } from '../hooks/use-friend-challenge.js';
import { useMatchmaking } from '../hooks/use-matchmaking.js';
import { apiRequest } from '../lib/api.js';
import { consumePlayAuthIntent, savePlayAuthIntent } from '../lib/auth-intent.js';
import type { ThemeDetailResponse } from '../lib/models.js';
import type { SocialFriend, SocialSnapshot } from '../lib/social.js';

export function ThemeDetailPage() {
  const { slug = '' } = useParams();
  const location = useLocation();
  const restored = location.state as { mode?: MatchMode } | null;
  const { getToken, profile, signIn } = useAuth();
  const [data, setData] = useState<ThemeDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<MatchMode>(restored?.mode === 'RANKED' ? 'RANKED' : 'CASUAL');
  const [reload, setReload] = useState(0);
  const [friends, setFriends] = useState<SocialFriend[]>([]);
  const [challengePickerOpen, setChallengePickerOpen] = useState(false);
  const consumedIntent = useRef(false);
  const matchmaking = useMatchmaking();
  const startMatchmaking = matchmaking.start;
  const friendChallenge = useFriendChallenge(slug);

  useEffect(() => {
    void getToken().then((token) => apiRequest<ThemeDetailResponse>(`/api/themes/${encodeURIComponent(slug)}`, {
      getToken,
      token,
    }))
      .then((result) => { setData(result); setError(null); })
      .catch((requestError: unknown) => setError(requestError instanceof Error ? requestError.message : 'Não foi possível carregar o tema.'));
  }, [getToken, reload, slug]);

  useEffect(() => {
    if (profile === null) return;
    void getToken()
      .then((token) => apiRequest<SocialSnapshot>('/api/social', { getToken, token }))
      .then((snapshot) => setFriends(snapshot.friends))
      .catch(() => setFriends([]));
  }, [getToken, profile]);

  // A intenção só pode ser retomada na mesma aba, uma vez, e é revalidada pelo
  // ticket/servidor dentro de `start`. Não há callback do Firebase que abra uma
  // segunda fila por conta própria.
  useEffect(() => {
    if (consumedIntent.current || profile === null || data === null) return;
    const intent = consumePlayAuthIntent();
    consumedIntent.current = true;
    if (intent === null || intent.themeId !== data.theme.id || intent.themeSlug !== slug) return;
    void startMatchmaking(intent.themeId, intent.mode, intent.themeSlug);
  }, [data, profile, slug, startMatchmaking]);

  if (data === null && error === null) return <LoadingState label="Abrindo o tema" />;
  if (error !== null || data === null) return <ErrorState message={error ?? 'Tema indisponível.'} onRetry={() => setReload((value) => value + 1)} />;

  const required = questionsForMode(mode);
  const available = data.theme.activeQuestionCount;
  const canPlay = available >= required;
  const realtimeEnabled = import.meta.env.VITE_ENABLE_REALTIME_MATCHES === 'true';

  return (
    <section className="page page--theme-detail">
      <Link className="back-link" to="/"><Icon name="back" />Temas</Link>
      <div className="theme-hero">
        <ThemeArtwork artwork={data.theme.artwork} className="theme-hero__art" eager name={data.theme.name} />
        <div><span className="eyebrow">{data.theme.categoryName}</span><h1>{data.theme.name}</h1><p>{data.theme.description}</p><span className="question-count"><Icon name="bolt" />{data.theme.activeQuestionCount.toLocaleString('pt-BR')} perguntas ativas</span></div>
      </div>

      <div className="theme-layout">
        <div className="play-card">
          <div><span className="eyebrow">Nova partida</span><h2>Escolha o desafio</h2></div>
          <div className="segmented segmented--wide" role="radiogroup" aria-label="Modo de partida">
            {(['CASUAL', 'RANKED'] as MatchMode[]).map((value) => <button aria-checked={mode === value} className={mode === value ? 'segmented__active' : ''} key={value} onClick={() => {
              setMode(value);
              // Desafio entre amigos é sempre Casual: sair do Casual fecha o seletor aberto.
              if (value !== 'CASUAL') setChallengePickerOpen(false);
            }} role="radio" type="button">{value === 'CASUAL' ? 'Partida normal' : 'Partida rankeada'}</button>)}
          </div>
          <p className="inline-notice">{required} perguntas · {available} {available === 1 ? 'disponível' : 'disponíveis'}</p>
          {!canPlay && <p className="inline-notice">Este tema ainda precisa de {required} perguntas ativas para uma {mode === 'RANKED' ? 'partida rankeada' : 'partida normal'}.</p>}
          {!realtimeEnabled && canPlay && <p className="inline-notice">O catálogo está pronto; partidas online serão liberadas após a validação do servidor de rodadas.</p>}
          {matchmaking.error && <p className="form-error">{matchmaking.error}</p>}
          {friendChallenge.error && <p className="form-error">{friendChallenge.error}</p>}
          {profile === null
            ? <Button onClick={() => {
              savePlayAuthIntent({ mode, themeId: data.theme.id, themeSlug: slug });
              void signIn();
            }}>Entrar para jogar</Button>
            : (
              <div className="play-card__actions">
                <Button
                  disabled={!canPlay || !realtimeEnabled}
                  onClick={() => void matchmaking.start(data.theme.id, mode, slug)}
                >Puxar partida</Button>
                {mode === 'CASUAL' && (
                  <Button
                    disabled={!canPlay || !realtimeEnabled || friendChallenge.status !== 'idle'}
                    onClick={() => setChallengePickerOpen(true)}
                    variant="secondary"
                  >Desafiar amigo</Button>
                )}
              </div>
            )}
        </div>

        <aside className="leaderboard-card">
          <div className="section-heading"><div><span className="eyebrow">Neste tema</span><h2>Top 5</h2></div></div>
          {data.topFive.length === 0 ? <p className="leaderboard-empty">A primeira Ranqueada ainda está esperando por alguém.</p> : (
            <ol>{data.topFive.map((entry) => <li key={entry.publicId}><span className="leaderboard-position">{entry.position}</span><AvatarFrame frameId={entry.frameId}><Avatar customUrl={entry.customAvatarUrl} googleUrl={entry.photoUrl} name={entry.displayName} size="small" /></AvatarFrame><span><strong>{entry.displayName}</strong><small>{entry.publicId}</small></span><RankBadge knowledge={entry.knowledge} /></li>)}</ol>
          )}
        </aside>
      </div>

      <article className="personal-theme-card"><div><span className="eyebrow">Seu cartão</span><h2>{profile?.displayName ?? 'Entre para acompanhar'}</h2><p>{profile ? (data.personal?.rankedMatches ? 'Seu histórico neste tema é calculado apenas pelas partidas Ranqueadas.' : 'Sua história competitiva neste tema começa na primeira Ranqueada.') : 'Ranking, descoberta histórica e Conhecimento ficam reunidos aqui.'}</p></div><div className="personal-theme-card__stats"><RankBadge knowledge={data.personal?.knowledge ?? 0} showKnowledge /><span><strong>{(data.personal?.discoveredPercentage ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</strong><small>descoberto</small></span><span><strong>{data.personal?.position ? `#${data.personal.position}` : '—'}</strong><small>posição</small></span></div></article>

      {challengePickerOpen && mode === 'CASUAL' && (
        <FriendChallengeDialog
          busy={friendChallenge.status !== 'idle'}
          friends={friends}
          onAsync={(friend) => {
            setChallengePickerOpen(false);
            void friendChallenge.challenge({
              displayName: friend.displayName,
              kind: 'ASYNC',
              publicId: friend.publicId,
            });
          }}
          onClose={() => setChallengePickerOpen(false)}
          onDirect={(friend) => {
            setChallengePickerOpen(false);
            void friendChallenge.challenge({
              displayName: friend.displayName,
              kind: 'DIRECT',
              publicId: friend.publicId,
            });
          }}
          themeName={data.theme.name}
        />
      )}
      {matchmaking.status !== 'idle' && <MatchmakingDialog
        elapsedSeconds={matchmaking.elapsedSeconds}
        mode={mode}
        onCancel={matchmaking.cancel}
        onClose={matchmaking.cancel}
        opponent={matchmaking.opponent}
        preparing={matchmaking.preparing}
        status={matchmaking.status}
        theme={data.theme}
        viewer={profile === null ? undefined : {
          customAvatarUrl: profile.customAvatarUrl,
          displayName: profile.displayName,
          frameId: profile.equippedFrameId,
          knowledge: data.personal?.knowledge ?? 0,
          photoUrl: profile.photoUrl,
        }}
      />}
    </section>
  );
}
