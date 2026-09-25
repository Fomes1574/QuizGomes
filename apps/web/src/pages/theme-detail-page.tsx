import { questionsForMode, type MatchMode } from '@quiz-gomes/domain';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
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
import { feedback } from '../lib/feedback.js';
import { consumePlayAuthIntent, savePlayAuthIntent } from '../lib/auth-intent.js';
import type { ThemeDetailResponse } from '../lib/models.js';
import type { SocialFriend, SocialSnapshot } from '../lib/social.js';

export function ThemeDetailPage() {
  const { slug = '' } = useParams();
  const location = useLocation();
  const restored = location.state as { autoPlay?: boolean; mode?: MatchMode } | null;
  const navigate = useNavigate();
  const consumedAutoPlay = useRef(false);
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

  // "Jogar de novo" chega aqui com autoPlay: entra na fila uma única vez e limpa o
  // estado do histórico para um recarregamento não abrir outra busca sozinho.
  useEffect(() => {
    if (consumedAutoPlay.current || restored?.autoPlay !== true || profile === null || data === null) return;
    consumedAutoPlay.current = true;
    const autoMode = restored.mode === 'RANKED' ? 'RANKED' : 'CASUAL';
    void navigate(location.pathname, { replace: true, state: { mode: autoMode } });
    if (data.theme.activeQuestionCount < questionsForMode(autoMode)) return;
    void startMatchmaking(data.theme.id, autoMode, slug);
  }, [data, location.pathname, navigate, profile, restored, slug, startMatchmaking]);

  if (data === null && error === null) return <LoadingState label="Abrindo o tema" />;
  if (error !== null || data === null) return <ErrorState message={error ?? 'Tema indisponível.'} onRetry={() => setReload((value) => value + 1)} />;

  const required = questionsForMode(mode);
  const available = data.theme.activeQuestionCount;
  const canPlay = available >= required;
  const realtimeEnabled = import.meta.env.VITE_ENABLE_REALTIME_MATCHES === 'true';

  const modeIndex = mode === 'CASUAL' ? 0 : 1;
  const podium = [data.topFive[1], data.topFive[0], data.topFive[2]];
  const discovered = data.personal?.discoveredPercentage ?? 0;
  const records = data.personal?.records;
  const modeRecord = records?.[mode] ?? null;

  return (
    <section className="page page--theme-detail">
      <Link className="back-link" to="/"><Icon name="back" />Temas</Link>
      <div className="theme-hero">
        <span className="theme-hero__art-wrap">
          <ThemeArtwork artwork={data.theme.artwork} className="theme-hero__art" eager name={data.theme.name} />
        </span>
        <div><span className="eyebrow">{data.theme.categoryName}</span><h1>{data.theme.name}</h1><p>{data.theme.description}</p><span className="question-count"><Icon name="bolt" />{data.theme.activeQuestionCount.toLocaleString('pt-BR')} perguntas ativas</span></div>
      </div>

      <div className="theme-layout">
        <div className="play-card">
          <div><span className="eyebrow">Nova partida</span><h2>Escolha o desafio</h2></div>
          <div
            aria-label="Modo de partida"
            className="segmented segmented--wide segmented--slide"
            role="radiogroup"
            style={{ '--segment-index': modeIndex } as CSSProperties}
          >
            <span aria-hidden="true" className="segmented__indicator" />
            {(['CASUAL', 'RANKED'] as MatchMode[]).map((value) => <button aria-checked={mode === value} className={mode === value ? 'segmented__active' : ''} key={value} onClick={() => {
              setMode(value);
              // Desafio entre amigos é sempre Casual: sair do Casual fecha o seletor aberto.
              if (value !== 'CASUAL') setChallengePickerOpen(false);
            }} role="radio" type="button">{value === 'CASUAL' ? 'Partida normal' : 'Partida rankeada'}</button>)}
          </div>
          <div className={`play-deck play-deck--${mode === 'RANKED' ? 'ranked' : 'casual'}`} key={mode}>
            <span aria-hidden="true" className="play-deck__stack">
              <span className="play-deck__card" />
              <span className="play-deck__card" />
              <span className="play-deck__card play-deck__card--top">
                <strong>{required}</strong>
                <small>perguntas</small>
              </span>
            </span>
            <div className="play-deck__copy">
              <strong>{mode === 'RANKED' ? 'Vale Conhecimento' : 'Sem pressão no ranking'}</strong>
              <p>{mode === 'RANKED'
                ? 'Vitória rende 30 XP e mexe no seu Conhecimento deste tema.'
                : 'Vitória rende 20 XP. Seu Conhecimento fica intacto.'}</p>
              <ul className="play-deck__facts">
                {modeRecord !== null && <li className="play-deck__record"><Icon name="crown" />Seu recorde: {modeRecord.toLocaleString('pt-BR')}</li>}
                <li><Icon name="bolt" />10 s por pergunta</li>
                <li>{available.toLocaleString('pt-BR')} {available === 1 ? 'disponível' : 'disponíveis'}</li>
              </ul>
            </div>
          </div>
          {!canPlay && <p className="inline-notice">Este tema ainda precisa de {required} perguntas ativas para uma {mode === 'RANKED' ? 'partida rankeada' : 'partida normal'}.</p>}
          {!realtimeEnabled && canPlay && <p className="inline-notice">O catálogo está pronto; partidas online serão liberadas após a validação do servidor de rodadas.</p>}
          {matchmaking.error && <p className="form-error">{matchmaking.error}</p>}
          {friendChallenge.error && <p className="form-error">{friendChallenge.error}</p>}
          {profile === null
            ? <Button className="play-card__cta" onClick={() => {
              savePlayAuthIntent({ mode, themeId: data.theme.id, themeSlug: slug });
              void signIn();
            }}>Entrar para jogar</Button>
            : (
              <div className="play-card__actions">
                <Button
                  className="play-card__cta"
                  disabled={!canPlay || !realtimeEnabled}
                  onClick={() => { feedback('tap'); void matchmaking.start(data.theme.id, mode, slug); }}
                ><Icon name="play" />Puxar partida</Button>
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
          <div className="podium" aria-hidden={data.topFive.length === 0 ? undefined : true}>
            {podium.map((entry, index) => {
              const place = [2, 1, 3][index] ?? 0;
              return entry === undefined ? (
                <div className={`podium__slot podium__slot--${place} podium__slot--open`} key={place}>
                  <span className="podium__seat">{place === 1 ? <Icon name="crown" /> : '?'}</span>
                  <small>{place === 1 ? 'Sua vaga?' : 'Livre'}</small>
                  <span className="podium__block">{place}</span>
                </div>
              ) : (
                <div className={`podium__slot podium__slot--${place}`} key={entry.publicId}>
                  <span className="podium__seat">
                    {place === 1 && <Icon className="podium__crown" name="crown" />}
                    <AvatarFrame frameId={entry.frameId}><Avatar customUrl={entry.customAvatarUrl} googleUrl={entry.photoUrl} name={entry.displayName} size="medium" /></AvatarFrame>
                  </span>
                  <small>{entry.displayName}</small>
                  <span className="podium__block">{place}</span>
                </div>
              );
            })}
          </div>
          {data.topFive.length === 0 ? <p className="leaderboard-empty">A primeira Ranqueada ainda está esperando por alguém.</p> : (
            <ol>{data.topFive.map((entry) => <li key={entry.publicId}><span className="leaderboard-position">{entry.position}</span><AvatarFrame frameId={entry.frameId}><Avatar customUrl={entry.customAvatarUrl} googleUrl={entry.photoUrl} name={entry.displayName} size="small" /></AvatarFrame><span><strong>{entry.displayName}</strong><small>{entry.publicId}</small></span><RankBadge knowledge={entry.knowledge} /></li>)}</ol>
          )}
        </aside>
      </div>

      <article className="personal-theme-card"><div><span className="eyebrow">Seu cartão</span><h2>{profile?.displayName ?? 'Entre para acompanhar'}</h2><p>{profile ? (data.personal?.rankedMatches ? 'Seu histórico neste tema é calculado apenas pelas partidas Ranqueadas.' : 'Sua história competitiva neste tema começa na primeira Ranqueada.') : 'Ranking, descoberta histórica e Conhecimento ficam reunidos aqui.'}</p></div><div className="personal-theme-card__stats"><RankBadge knowledge={data.personal?.knowledge ?? 0} showKnowledge /><span className="discovery-ring" style={{ '--discovered': Math.min(1, discovered / 100) } as CSSProperties}><strong>{discovered.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</strong><small>descoberto</small></span><span><strong>{data.personal?.position ? `#${data.personal.position}` : '—'}</strong><small>posição</small></span></div>{profile !== null && <div className="personal-records" aria-label="Recordes pessoais neste tema"><span><Icon name="crown" /><small>Recorde Normal</small><strong>{records?.CASUAL != null ? records.CASUAL.toLocaleString('pt-BR') : '—'}</strong></span><span><Icon name="crown" /><small>Recorde Rankeada</small><strong>{records?.RANKED != null ? records.RANKED.toLocaleString('pt-BR') : '—'}</strong></span></div>}</article>

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
