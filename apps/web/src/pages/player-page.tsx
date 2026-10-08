import { rankForKnowledge, type PlayerTitle } from '@quiz-gomes/domain';
import { useEffect, useState, type CSSProperties } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ErrorState } from '../components/async-state.js';
import { Avatar } from '../components/avatar.js';
import { AvatarFrame } from '../components/avatar-frame.js';
import { Button } from '../components/button.js';
import { Icon } from '../components/icons.js';
import { PlayerTitleText } from '../components/player-title.js';
import { RankBadge } from '../components/rank-badge.js';
import { PlayerSkeleton } from '../components/skeletons.js';
import { useAuth } from '../features/auth-context.js';
import { useSocial } from '../features/social-context.js';
import { apiRequest } from '../lib/api.js';
import { publicIdFromInviteCode } from '../lib/invite-link.js';
import type { ShowcaseTitle } from '../lib/titles.js';

interface PlayerView {
  comparison: Array<{ mine: number; name: string; slug: string; theirs: number }>;
  highlights: ShowcaseTitle[];
  player: {
    availableAt: string | null;
    customAvatarUrl: string | null;
    displayName: string;
    frameId: string | null;
    level: number;
    photoUrl: string | null;
    publicId: string;
    requestId: string | null;
    title: PlayerTitle | null;
  };
  ranked: { draws: number; losses: number; matches: number; wins: number };
  relationship: 'FRIEND' | 'INCOMING' | 'NONE' | 'OUTGOING' | 'SELF';
  themes: Array<{ knowledge: number; name: string; slug: string }>;
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/** Quem está na frente no tema, dito como placar, sem enfeite. */
function comparisonNote(mine: number, theirs: number, name: string): string {
  if (mine === theirs) return 'Empatados';
  const gap = Math.abs(mine - theirs).toLocaleString('pt-BR');
  return mine > theirs ? `Você está ${gap} à frente` : `${name} está ${gap} à frente`;
}

/**
 * Perfil de outra pessoa, aberto pelo ranking, pelo Social ou por link.
 * Mostra o que ela escolheu exibir e onde vocês dois se encontram.
 */
export function PlayerPage() {
  const { code } = useParams();
  const navigate = useNavigate();
  const { getToken, profile, signIn } = useAuth();
  const { refresh } = useSocial();
  const publicId = publicIdFromInviteCode(code);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const requestKey = `${publicId ?? ''}|${attempt}|${profile?.userId ?? ''}`;
  const [result, setResult] = useState<{ key: string; state: 'error' | 'missing' | 'ready'; view?: PlayerView } | null>(null);

  useEffect(() => {
    if (profile === null || publicId === null) return undefined;
    let active = true;
    void apiRequest<PlayerView>(`/api/players/${encodeURIComponent(publicId.slice(1))}`, { getToken })
      .then((response) => { if (active) setResult({ key: requestKey, state: 'ready', view: response }); })
      .catch((reason: unknown) => {
        if (!active) return;
        const status = (reason as { status?: number }).status;
        setResult({ key: requestKey, state: status === 404 ? 'missing' : 'error' });
      });
    return () => { active = false; };
  }, [getToken, profile, publicId, requestKey]);

  const current = result?.key === requestKey ? result : null;
  const state = current?.state ?? 'loading';
  const view = current?.view ?? null;
  const setView = (next: PlayerView) => setResult({ key: requestKey, state: 'ready', view: next });

  async function addFriend() {
    if (view === null) return;
    setBusy(true);
    setNotice(null);
    try {
      if (view.relationship === 'INCOMING' && view.player.requestId !== null) {
        await apiRequest(`/api/social/requests/${encodeURIComponent(view.player.requestId)}/accept`, { body: {}, getToken, method: 'POST' });
        setView({ ...view, relationship: 'FRIEND' });
      } else {
        await apiRequest('/api/social/requests', { body: { publicId: view.player.publicId }, getToken, method: 'POST' });
        setView({ ...view, relationship: 'OUTGOING' });
      }
      void refresh();
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : 'Não deu certo agora. Tente de novo.');
    } finally {
      setBusy(false);
    }
  }

  if (profile === null) {
    return (
      <section className="page page--narrow player-page">
        <div className="player-page__gate">
          <h1>Entre para ver este perfil</h1>
          <p>Perfis de jogadores ficam visíveis só para quem tem conta no QUIZ GOMES.</p>
          <Button onClick={() => void signIn()}>Entrar com Google</Button>
        </div>
      </section>
    );
  }
  if (publicId === null || state === 'missing') {
    return (
      <section className="page page--narrow player-page">
        <div className="player-page__gate">
          <h1>Perfil indisponível</h1>
          <p>Esse jogador não existe ou o perfil não está disponível para você.</p>
          <Button onClick={() => void navigate('/social')} variant="secondary">Ir para o Social</Button>
        </div>
      </section>
    );
  }
  if (state === 'error') return <section className="page page--narrow"><ErrorState message="Não deu para abrir o perfil." onRetry={() => setAttempt((value) => value + 1)} /></section>;
  if (view === null || state === 'loading') return <PlayerSkeleton />;

  const { player } = view;
  const name = firstName(player.displayName);
  const winRate = view.ranked.matches === 0 ? null : Math.round((view.ranked.wins / view.ranked.matches) * 100);

  return (
    <section className="page page--narrow player-page">
      <header className="player-hero">
        <AvatarFrame frameId={player.frameId} variant="result">
          <Avatar customUrl={player.customAvatarUrl} googleUrl={player.photoUrl} name={player.displayName} size="large" />
        </AvatarFrame>
        <div className="player-hero__copy">
          <span className="player-hero__level">Nível {player.level}</span>
          <h1>{player.displayName}</h1>
          <PlayerTitleText animated title={player.title} />
          <small>{player.publicId}</small>
        </div>
        <div className="player-hero__action">
          {view.relationship === 'SELF' && <p className="player-hero__note">É assim que os outros veem seu perfil.</p>}
          {view.relationship === 'FRIEND' && <span className="player-hero__badge"><Icon name="check" />Vocês são amigos</span>}
          {view.relationship === 'OUTGOING' && <span className="player-hero__badge">Pedido enviado</span>}
          {(view.relationship === 'NONE' || view.relationship === 'INCOMING') && (
            <Button disabled={busy || (view.relationship === 'NONE' && player.availableAt !== null)} onClick={() => void addFriend()}>
              <Icon name={view.relationship === 'INCOMING' ? 'check' : 'add'} />
              {busy ? 'Enviando…' : view.relationship === 'INCOMING' ? `Aceitar ${name}` : `Adicionar ${name}`}
            </Button>
          )}
          {notice !== null && <p className="form-error" role="alert">{notice}</p>}
        </div>
      </header>

      {view.highlights.length > 0 && (
        <ul aria-label="Destaques" className="player-highlights">
          {view.highlights.map((title) => (
            <li className={`player-highlights__item player-highlights__item--${title.style}`} key={title.id}>
              <PlayerTitleText compact title={title} />
            </li>
          ))}
        </ul>
      )}

      {view.comparison.length > 0 && (
        <article className="profile-card player-compare">
          <span className="eyebrow">Você × {name}</span>
          <ul>
            {view.comparison.map((theme) => {
              const total = Math.max(1, theme.mine + theme.theirs);
              return (
                <li key={theme.slug}>
                  <Link className="player-compare__theme" to={`/temas/${encodeURIComponent(theme.slug)}`}>{theme.name}</Link>
                  <div className="player-compare__bar" aria-hidden="true">
                    <span className="player-compare__mine" style={{ '--share': theme.mine / total } as CSSProperties} />
                    <span className="player-compare__theirs" style={{ '--share': theme.theirs / total } as CSSProperties} />
                  </div>
                  <div className="player-compare__values">
                    <span><b>Você</b> {rankForKnowledge(theme.mine).tier} {rankForKnowledge(theme.mine).division}</span>
                    <span><b>{name}</b> {rankForKnowledge(theme.theirs).tier} {rankForKnowledge(theme.theirs).division}</span>
                  </div>
                  <small>{comparisonNote(theme.mine, theme.theirs, name)}</small>
                </li>
              );
            })}
          </ul>
        </article>
      )}

      <div className="player-grid">
        <article className="profile-card">
          <span className="eyebrow">Melhores temas</span>
          {view.themes.length === 0 ? <p>Ainda sem Rankeada.</p> : (
            <ul className="player-themes">
              {view.themes.map((theme) => (
                <li key={theme.slug}>
                  <Link to={`/temas/${encodeURIComponent(theme.slug)}`}>{theme.name}</Link>
                  <RankBadge knowledge={theme.knowledge} />
                </li>
              ))}
            </ul>
          )}
        </article>
        <article className="profile-card player-stats">
          <span className="eyebrow">Rankeada</span>
          <div>
            <span><strong>{view.ranked.matches.toLocaleString('pt-BR')}</strong><small>partidas</small></span>
            <span><strong>{view.ranked.wins.toLocaleString('pt-BR')}</strong><small>vitórias</small></span>
            <span><strong>{winRate === null ? '—' : `${winRate}%`}</strong><small>aproveitamento</small></span>
          </div>
        </article>
      </div>
    </section>
  );
}

export default PlayerPage;
