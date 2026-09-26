import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { Avatar } from '../components/avatar.js';
import { AvatarFrame } from '../components/avatar-frame.js';
import { EmptyState, LoadingState } from '../components/async-state.js';
import { Button } from '../components/button.js';
import { Icon } from '../components/icons.js';
import { SocialConfirmDialog } from '../components/social-confirm-dialog.js';
import { useAuth } from '../features/auth-context.js';
import { useChallenges } from '../features/challenge-context.js';
import { useFriendPresence, useSocial } from '../features/social-context.js';
import { apiRequest } from '../lib/api.js';
import { saveChallengeTarget } from '../lib/challenge-target.js';
import { challengeCardCopy, type ChallengeView } from '../lib/challenges.js';
import type { FriendPresence, SocialCandidate, SocialFriend, SocialSnapshot, SocialUser } from '../lib/social.js';

const EMPTY_SNAPSHOT: SocialSnapshot = {
  friendLimit: 200, friends: [], incoming: [], incomingNextCursor: null, outgoing: [], outgoingNextCursor: null,
};
const PRESENCE_LABELS: Record<FriendPresence, string> = {
  IN_MATCH: 'Em partida',
  MATCHMAKING: 'Procurando partida',
  OFFLINE: 'Offline',
  ONLINE: 'Online',
  RECONNECTING: 'Reconectando',
};
const PRESENCE_ORDER: Record<FriendPresence, number> = {
  IN_MATCH: 2,
  MATCHMAKING: 1,
  OFFLINE: 4,
  ONLINE: 0,
  RECONNECTING: 3,
};

interface InviteProfile {
  customAvatarUrl: string | null;
  displayName: string;
  equippedFrameId: string | null;
  photoUrl: string | null;
  publicId: string;
}

/** Cartão de convite: o ID público em destaque e um jeito rápido de chamar a galera. */
function InviteCard({ lonely, profile }: { lonely: boolean; profile: InviteProfile }) {
  const [copied, setCopied] = useState<'id' | 'invite' | null>(null);
  const resetTimer = useRef<number | null>(null);
  useEffect(() => () => { if (resetTimer.current !== null) window.clearTimeout(resetTimer.current); }, []);

  async function copy(text: string, kind: 'id' | 'invite') {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
      resetTimer.current = window.setTimeout(() => setCopied(null), 2_000);
    } catch {
      setCopied(null);
    }
  }

  async function invite() {
    const text = `Bora duelar no Quiz Gomes? Me adiciona: ${profile.publicId}`;
    const url = window.location.origin;
    const touch = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    if (touch && typeof navigator.share === 'function') {
      try {
        await navigator.share({ text, title: 'Quiz Gomes', url });
      } catch {
        // Fechar a folha de compartilhamento não é erro.
      }
      return;
    }
    await copy(`${text} ${url}`, 'invite');
  }

  return (
    <section aria-label="Seu cartão de jogador" className={`invite-card${lonely ? ' invite-card--lonely' : ''}`}>
      {lonely && (
        <div aria-hidden="true" className="invite-orbit">
          <span className="invite-orbit__ring">
            {[0, 1, 2, 3].map((slot) => <i className="invite-orbit__slot" key={slot}><Icon name="add" /></i>)}
          </span>
          <span className="invite-orbit__center">
            <AvatarFrame frameId={profile.equippedFrameId}>
              <Avatar customUrl={profile.customAvatarUrl} googleUrl={profile.photoUrl} name={profile.displayName} size="large" />
            </AvatarFrame>
          </span>
        </div>
      )}
      <div className="invite-card__copy">
        {lonely ? <h2>Sua roda está esperando</h2> : <small>Seu ID público</small>}
        <button
          aria-label={`Copiar seu ID público ${profile.publicId}`}
          className="invite-card__id"
          onClick={() => void copy(profile.publicId, 'id')}
          type="button"
        >
          {profile.publicId}
          <Icon name={copied === 'id' ? 'check' : 'copy'} />
        </button>
        <p>{lonely
          ? 'Passe esse código pra galera te achar na busca e desafiar você.'
          : 'Toque no código para copiar e mandar pra quem quiser duelar.'}</p>
      </div>
      <Button className="invite-card__action" onClick={() => void invite()} variant={lonely ? 'primary' : 'secondary'}>
        <Icon name={copied === 'invite' ? 'check' : 'share'} />
        {copied === 'invite' ? 'Convite copiado!' : 'Chamar amigos'}
      </Button>
      <span aria-live="polite" className="sr-only">{copied === 'id' ? 'ID copiado' : copied === 'invite' ? 'Convite copiado' : ''}</span>
    </section>
  );
}

function SocialIdentity({ presence, user }: { presence?: FriendPresence; user: SocialUser }) {
  return (
    <div className="social-person__identity">
      <span className="social-person__portrait">
        <AvatarFrame frameId={user.frameId}>
          <Avatar customUrl={user.customAvatarUrl} googleUrl={user.photoUrl} name={user.displayName} size="medium" />
        </AvatarFrame>
        {presence !== undefined ? (
          <span aria-hidden="true" className="friend-presence-dot" data-presence={presence} key={presence} />
        ) : null}
      </span>
      <div className="social-person__copy">
        <strong>{user.displayName}</strong>
        <span className="social-person__public-id">{user.publicId}</span>
        {presence !== undefined ? (
          <span
            aria-label={`${user.displayName} está ${PRESENCE_LABELS[presence].toLocaleLowerCase('pt-BR')}`}
            className="friend-presence-label"
            data-presence={presence}
            key={presence}
          >{PRESENCE_LABELS[presence]}</span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Ações raras e destrutivas ficam num menu: o card mostra só o que a pessoa
 * quer fazer quase sempre (desafiar).
 */
function FriendMenu({
  disabled,
  onBlock,
  onRemove,
  onToggleMute,
  user,
}: {
  disabled: boolean;
  onBlock: (user: SocialUser) => void;
  onRemove: (user: SocialUser) => void;
  onToggleMute: (user: SocialFriend) => void;
  user: SocialFriend;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && root.current?.contains(event.target) !== true) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    root.current?.querySelector<HTMLButtonElement>('.friend-menu__list button')?.focus();
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const run = (action: () => void) => { setOpen(false); action(); };
  return (
    <div className="friend-menu" ref={root}>
      <button
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={`Mais opções para ${user.displayName}`}
        className="friend-menu__trigger"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        type="button"
      ><span aria-hidden="true">⋯</span></button>
      {open && (
        <div className="friend-menu__list">
          <button aria-pressed={user.muted} onClick={() => run(() => onToggleMute(user))} type="button">
            <Icon name="sound" />{user.muted ? 'Reativar avisos' : 'Silenciar'}
          </button>
          <button onClick={() => run(() => onRemove(user))} type="button"><Icon name="close" />Remover amigo</button>
          <button
            aria-label={`Bloquear ${user.displayName}`}
            className="friend-menu__danger"
            onClick={() => run(() => onBlock(user))}
            type="button"
          ><Icon name="flag" />Bloquear</button>
        </div>
      )}
    </div>
  );
}

const FriendCard = memo(function FriendCard({
  disabled,
  index,
  onBlock,
  onChallenge,
  onRemove,
  onToggleMute,
  presence,
  user,
}: {
  disabled: boolean;
  index: number;
  onBlock: (user: SocialUser) => void;
  onChallenge: (user: SocialFriend) => void;
  onRemove: (user: SocialUser) => void;
  onToggleMute: (user: SocialFriend) => void;
  presence: FriendPresence;
  user: SocialFriend;
}) {
  return (
    <article
      className="social-person social-friend"
      data-friend-id={user.publicId}
      data-presence={presence}
      style={{ '--card-index': Math.min(index, 12) } as CSSProperties}
    >
      <SocialIdentity presence={presence} user={user} />
      <div className="social-friend__actions">
        <Button
          className="social-friend__challenge"
          disabled={disabled}
          onClick={() => onChallenge(user)}
          variant={presence === 'ONLINE' ? 'primary' : 'secondary'}
        ><Icon name="bolt" />Desafiar</Button>
        <FriendMenu disabled={disabled} onBlock={onBlock} onRemove={onRemove} onToggleMute={onToggleMute} user={user} />
      </div>
    </article>
  );
});

type FriendRow =
  | { key: string; kind: 'heading'; label: string; total: number }
  | { key: string; kind: 'friend'; presence: FriendPresence; user: SocialFriend };

function useFriendLayoutMotion(key: string) {
  const list = useRef<HTMLDivElement | null>(null);
  const previous = useRef(new Map<string, DOMRect>());

  useLayoutEffect(() => {
    const container = list.current;
    if (container === null) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const current = new Map<string, DOMRect>();
    for (const element of container.querySelectorAll<HTMLElement>('[data-friend-id]')) {
      const id = element.dataset.friendId;
      if (id === undefined) continue;
      const next = element.getBoundingClientRect();
      const former = previous.current.get(id);
      current.set(id, next);
      if (!reduced && former !== undefined && typeof element.animate === 'function') {
        const deltaX = former.left - next.left;
        const deltaY = former.top - next.top;
        if (Math.abs(deltaX) > 1 || Math.abs(deltaY) > 1) {
          element.animate([
            { opacity: .86, transform: `translate(${deltaX}px, ${deltaY}px)` },
            { opacity: 1, transform: 'translate(0, 0)' },
          ], { duration: 390, easing: 'cubic-bezier(.2,.72,.18,1)' });
        }
      }
    }
    previous.current = current;
  }, [key]);

  return list;
}

function FriendsSection({
  disabled,
  friendLimit,
  friends,
  onBlock,
  onChallenge,
  onRemove,
  onToggleMute,
}: {
  disabled: boolean;
  friendLimit: number;
  friends: SocialFriend[];
  onBlock: (user: SocialUser) => void;
  onChallenge: (user: SocialFriend) => void;
  onRemove: (user: SocialUser) => void;
  onToggleMute: (user: SocialFriend) => void;
}) {
  const friendPresence = useFriendPresence();
  const organizedFriends = useMemo(() => {
    const resolved = friends.map((user) => ({
      presence: friendPresence.get(user.publicId)?.presence ?? 'OFFLINE',
      user,
    }));
    const alphabetic = (first: typeof resolved[number], second: typeof resolved[number]) => (
      first.user.displayName.localeCompare(second.user.displayName, 'pt-BR', { sensitivity: 'base' }) ||
      first.user.publicId.localeCompare(second.user.publicId)
    );
    const online = resolved.filter((friend) => friend.presence !== 'OFFLINE')
      .sort((first, second) => PRESENCE_ORDER[first.presence] - PRESENCE_ORDER[second.presence] ||
        alphabetic(first, second));
    const offline = resolved.filter((friend) => friend.presence === 'OFFLINE').sort(alphabetic);
    const rows: FriendRow[] = [];
    if (online.length > 0) {
      rows.push({ key: 'heading-online', kind: 'heading', label: 'Online', total: online.length });
      rows.push(...online.map(({ presence, user }) => ({
        key: user.publicId,
        kind: 'friend' as const,
        presence,
        user,
      })));
    }
    if (offline.length > 0) {
      rows.push({ key: 'heading-offline', kind: 'heading', label: 'Offline', total: offline.length });
      rows.push(...offline.map(({ presence, user }) => ({
        key: user.publicId,
        kind: 'friend' as const,
        presence,
        user,
      })));
    }
    return {
      // "Procurando partida" não pode receber DIRECT: disponibilidade é ONLINE
      // exclusivamente. A fila continua visível separadamente na lista.
      available: online.filter(({ presence }) => presence === 'ONLINE').length,
      busy: online.filter(({ presence }) => presence === 'IN_MATCH' || presence === 'RECONNECTING').length,
      rows,
    };
  }, [friendPresence, friends]);
  const layoutKey = organizedFriends.rows.map((row) => row.key +
    (row.kind === 'friend' ? `:${row.presence}` : '')).join('|');
  const friendList = useFriendLayoutMotion(layoutKey);

  return (
    <section aria-label="Amigos" className="social-section social-friends">
      <div className="section-heading social-friends__heading">
        <div><h2>Amigos</h2><span className="social-friends__total">{friends.length} / {friendLimit}</span></div>
        {friends.length > 0 ? (
          <div className="social-friends__summary">
            <span className="social-chip"><i aria-hidden="true" data-presence="ONLINE" />{organizedFriends.available} {organizedFriends.available === 1 ? 'disponível' : 'disponíveis'}</span>
            <span className="social-chip"><i aria-hidden="true" data-presence="IN_MATCH" />{organizedFriends.busy} em partida</span>
          </div>
        ) : null}
      </div>
      {friends.length === 0 ? (
        <p className="social-section__empty">Busque um jogador pelo nome ou pelo ID público para começar.</p>
      ) : null}
      {organizedFriends.rows.length > 0 ? (
        <div className="social-friends__list" ref={friendList}>
          {organizedFriends.rows.map((row, index) => row.kind === 'heading' ? (
            <h3 className="social-friends__group" key={row.key}>
              {row.label}<span>{row.total}</span>
            </h3>
          ) : (
            <FriendCard
              disabled={disabled}
              index={index}
              key={row.key}
              onBlock={onBlock}
              onChallenge={onChallenge}
              onRemove={onRemove}
              onToggleMute={onToggleMute}
              presence={row.presence}
              user={row.user}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ChallengesSection({
  busy,
  challenges,
  onAccept,
  onCancel,
  onDecline,
  onResume,
}: {
  busy: boolean;
  challenges: ChallengeView[];
  onAccept: (challenge: ChallengeView) => void;
  onCancel: (challenge: ChallengeView) => void;
  onDecline: (challenge: ChallengeView) => void;
  onResume: (challenge: ChallengeView) => void;
}) {
  const friendPresence = useFriendPresence();
  if (challenges.length === 0) return null;
  return (
    <section aria-label="Desafios" className="social-section">
      <div className="section-heading"><div><h2>Desafios</h2></div></div>
      <div className="social-list">
        {challenges.map((challenge) => {
          const other = challenge.role === 'CHALLENGER' ? challenge.challenged : challenge.challenger;
          const copy = challengeCardCopy(challenge);
          // Presença é somente indicativa: as ações acima continuam derivadas do
          // status autoritativo do desafio, nunca de ONLINE/IN_MATCH local.
          const presence = friendPresence.get(other.publicId)?.presence ?? 'OFFLINE';
          return (
            <article className="social-person social-challenge" key={challenge.id}>
              <div className="social-challenge__summary">
                <div className="social-person__identity social-challenge__identity">
                  <AvatarFrame frameId={other.frameId}>
                    <Avatar
                      customUrl={other.customAvatarUrl}
                      googleUrl={other.photoUrl}
                      name={other.displayName}
                      size="small"
                    />
                  </AvatarFrame>
                  <span className="social-challenge__copy">
                  <strong>{copy.headline}</strong>
                    <small title={copy.subtitle}>{copy.subtitle}</small>
                  </span>
                </div>
                <span
                  aria-label={`${other.displayName} está ${PRESENCE_LABELS[presence].toLocaleLowerCase('pt-BR')}`}
                  className="friend-presence-label social-challenge__presence"
                  data-presence={presence}
                ><i aria-hidden="true" />{PRESENCE_LABELS[presence]}</span>
              </div>
              <div className="social-person__actions social-challenge__actions">
                {copy.canResume && <Button disabled={busy} onClick={() => onResume(challenge)}>Continuar</Button>}
                {copy.canPlay && <Button disabled={busy} onClick={() => onAccept(challenge)}>Jogar</Button>}
                {copy.canDecline && (
                  <button
                    className="social-person__quiet-action"
                    disabled={busy}
                    onClick={() => onDecline(challenge)}
                    type="button"
                  >Recusar</button>
                )}
                {copy.canCancel && (
                  <button
                    className="social-person__quiet-action"
                    disabled={busy}
                    onClick={() => onCancel(challenge)}
                    type="button"
                  >Cancelar</button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function SocialPage() {
  const { getToken, profile, signIn } = useAuth();
  const { refresh, revision } = useSocial();
  const { challenges, enterDirectRoom, refreshChallenges } = useChallenges();
  // Trava síncrona: independente do ciclo de render do `busy`, um segundo clique
  // (double tap, multiaba do mesmo dispositivo) no mesmo desafio nunca chega a
  // montar uma segunda requisição.
  const pendingActionsRef = useRef<Set<string>>(new Set());
  const navigate = useNavigate();
  const [snapshot, setSnapshot] = useState<SocialSnapshot>(EMPTY_SNAPSHOT);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<SocialCandidate[]>([]);
  const [loading, setLoading] = useState(profile !== null);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blocking, setBlocking] = useState<SocialUser | null>(null);

  const [loadingMoreRequests, setLoadingMoreRequests] = useState<'incoming' | 'outgoing' | null>(null);

  const load = useCallback(async () => {
    if (profile === null) return;
    try {
      const response = await apiRequest<SocialSnapshot>('/api/social', { getToken });
      setSnapshot(response);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível carregar o Social.');
    } finally {
      setLoading(false);
    }
  }, [getToken, profile]);

  useEffect(() => { queueMicrotask(() => { void load(); }); }, [load, revision]);

  async function loadMoreRequests(direction: 'incoming' | 'outgoing') {
    const cursor = direction === 'incoming' ? snapshot.incomingNextCursor : snapshot.outgoingNextCursor;
    if (cursor === null) return;
    setLoadingMoreRequests(direction);
    try {
      const response = await apiRequest<{ nextCursor: string | null; requests: SocialSnapshot['incoming'] }>(
        `/api/social/requests?direction=${direction}&cursor=${encodeURIComponent(cursor)}`, { getToken },
      );
      setSnapshot((current) => direction === 'incoming'
        ? { ...current, incoming: [...current.incoming, ...response.requests], incomingNextCursor: response.nextCursor }
        : { ...current, outgoing: [...current.outgoing, ...response.requests], outgoingNextCursor: response.nextCursor });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível carregar mais solicitações.');
    } finally {
      setLoadingMoreRequests(null);
    }
  }

  const challengeAction = useCallback((challenge: ChallengeView, action: 'accept' | 'cancel' | 'decline') => {
    if (pendingActionsRef.current.has(challenge.id)) return;
    pendingActionsRef.current.add(challenge.id);
    void (async () => {
      setBusy(challenge.id);
      setError(null);
      try {
        const response = await apiRequest<{ half?: string; roomId?: string }>(
          `/api/challenges/${challenge.id}/${action}`,
          { getToken, method: 'POST' },
        );
        if (action === 'accept' && typeof response.roomId === 'string') {
          enterDirectRoom(response.roomId, challenge.id);
          return;
        }
        if (action === 'accept' && response.half === 'SECOND') {
          void navigate(`/desafio/${challenge.id}`);
          return;
        }
        await refreshChallenges();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Não foi possível concluir esta ação.');
        await refreshChallenges();
      } finally {
        pendingActionsRef.current.delete(challenge.id);
        setBusy(null);
      }
    })();
  }, [enterDirectRoom, getToken, navigate, refreshChallenges]);

  useEffect(() => {
    const value = search.trim();
    if (profile === null || value.length < 2) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setSearching(true);
      void apiRequest<{ users: SocialCandidate[] }>(`/api/social/search?q=${encodeURIComponent(value)}`, {
        getToken,
        signal: controller.signal,
      }).then(({ users }) => setResults(users)).catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : 'Não foi possível buscar jogadores.');
        }
      }).finally(() => { if (!controller.signal.aborted) setSearching(false); });
    }, 220);
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [getToken, profile, revision, search]);

  const mutate = useCallback(async (
    key: string,
    path: string,
    options: { body?: unknown; method?: 'DELETE' | 'POST' } = {},
  ) => {
    setBusy(key);
    setError(null);
    try {
      await apiRequest(path, { ...options, getToken, method: options.method ?? 'POST' });
      await Promise.all([load(), refresh()]);
      setResults((current) => current.filter((candidate) => candidate.publicId !== key));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível concluir esta ação.');
    } finally {
      setBusy(null);
    }
  }, [getToken, load, refresh]);

  const toggleMute = useCallback((user: SocialFriend) => {
    void mutate(user.publicId, '/api/social/mutes', {
      body: { publicId: user.publicId },
      method: user.muted ? 'DELETE' : 'POST',
    });
  }, [mutate]);

  const removeFriend = useCallback((user: SocialUser) => {
    void mutate(user.publicId, '/api/social/friends', {
      body: { publicId: user.publicId },
      method: 'DELETE',
    });
  }, [mutate]);

  const visibleResults = search.trim().length >= 2 ? results : [];

  return (
    <section className="page social-page">
      <div className="page-heading social-page__heading">
        <div><span className="eyebrow">Sua roda</span><h1>Social</h1><p>Encontre jogadores e mantenha suas amizades por perto.</p></div>
      </div>
      {profile === null ? (
        <EmptyState
          action={{ label: 'Entrar com Google', onClick: () => void signIn() }}
          description="Entre na sua conta para encontrar jogadores e receber pedidos de amizade."
          title="Suas amizades começam aqui"
        />
      ) : (
        <>
          {!loading && <InviteCard lonely={snapshot.friends.length === 0} profile={profile} />}
          <label className="search-field">
            <Icon name="search" />
            <span className="sr-only">Buscar jogador por nome ou ID público</span>
            <input
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por nome ou #QG..."
              type="search"
              value={search}
            />
          </label>
          {error !== null ? <p className="form-message form-message--error" role="alert">{error}</p> : null}
          {search.trim().length >= 2 ? (
            <section aria-label="Resultados da busca" className="social-section">
              <div className="section-heading"><h2>Resultados</h2><span>{visibleResults.length}</span></div>
              {searching ? <LoadingState label="Buscando jogadores" /> : null}
              {!searching && visibleResults.length === 0 ? <p className="social-section__empty">Nenhum jogador disponível encontrado.</p> : null}
              {visibleResults.map((user) => (
                <article className="social-person" key={user.publicId}>
                  <SocialIdentity user={user} />
                  <div className="social-person__actions">
                    {user.relationship === 'NONE' && user.availableAt === null ? (
                      <Button disabled={busy !== null} onClick={() => void mutate(user.publicId, '/api/social/requests', {
                        body: { publicId: user.publicId },
                      })}>Adicionar</Button>
                    ) : null}
                    {user.relationship === 'NONE' && user.availableAt !== null ? (
                      <small>Disponível em {new Intl.DateTimeFormat('pt-BR').format(new Date(user.availableAt))}</small>
                    ) : null}
                    {user.relationship === 'OUTGOING' ? <small>Solicitação enviada</small> : null}
                    {user.relationship === 'FRIEND' ? <small>Vocês são amigos</small> : null}
                    {user.relationship === 'INCOMING' && user.requestId !== null ? (
                      <>
                        <Button className="button--accept" disabled={busy !== null} onClick={() => void mutate(
                          user.requestId ?? '', `/api/social/requests/${user.requestId}/accept`,
                        )}>Aceitar</Button>
                        <Button disabled={busy !== null} onClick={() => void mutate(
                          user.requestId ?? '', `/api/social/requests/${user.requestId}/reject`,
                        )}>Recusar</Button>
                      </>
                    ) : null}
                    <button
                      aria-label={`Bloquear ${user.displayName}`}
                      className="social-person__quiet-action"
                      disabled={busy !== null}
                      onClick={() => setBlocking(user)}
                      type="button"
                    >Bloquear</button>
                  </div>
                </article>
              ))}
            </section>
          ) : null}

          {loading ? <LoadingState label="Carregando amizades" /> : (
            <>
              <section aria-label="Pedidos recebidos" className={`social-section${snapshot.incoming.length === 0 ? ' social-section--quiet' : ' social-section--incoming'}`} id="pedidos">
                <div className="section-heading"><h2>Pedidos</h2><span>{snapshot.incoming.length}</span></div>
                {snapshot.incoming.length === 0 ? <p className="social-section__empty">Nenhuma solicitação recebida.</p> : null}
                {snapshot.incoming.map((item) => (
                  <article className="social-person" key={item.id}>
                    <SocialIdentity user={item.user} />
                    <p className="social-person__message">quer adicionar você</p>
                    <div className="social-person__actions">
                      <Button className="button--accept" disabled={busy !== null} onClick={() => void mutate(
                        item.id, `/api/social/requests/${item.id}/accept`,
                      )}>Aceitar</Button>
                      <Button disabled={busy !== null} onClick={() => void mutate(
                        item.id, `/api/social/requests/${item.id}/reject`,
                      )}>Recusar</Button>
                    </div>
                  </article>
                ))}
                {snapshot.incomingNextCursor !== null ? (
                  <Button disabled={loadingMoreRequests !== null} onClick={() => void loadMoreRequests('incoming')} type="button" variant="ghost">
                    {loadingMoreRequests === 'incoming' ? 'Carregando…' : 'Carregar mais'}
                  </Button>
                ) : null}
              </section>

              <ChallengesSection
                busy={busy !== null}
                challenges={challenges}
                onAccept={(challenge) => challengeAction(challenge, 'accept')}
                onCancel={(challenge) => challengeAction(challenge, 'cancel')}
                onDecline={(challenge) => challengeAction(challenge, 'decline')}
                onResume={(challenge) => void navigate(`/desafio/${challenge.id}`)}
              />

              <FriendsSection
                disabled={busy !== null}
                onChallenge={(friend) => {
                  saveChallengeTarget({ displayName: friend.displayName, publicId: friend.publicId });
                  void navigate('/');
                }}
                friendLimit={snapshot.friendLimit}
                friends={snapshot.friends}
                onBlock={setBlocking}
                onRemove={removeFriend}
                onToggleMute={toggleMute}
              />
              {snapshot.outgoing.length > 0 ? (
                <section aria-label="Pedidos enviados" className="social-section social-outgoing">
                  <div className="section-heading"><h2>Enviados</h2><span>{snapshot.outgoing.length}</span></div>
                  <div className="social-outgoing__list">
                    {snapshot.outgoing.map((item) => (
                      <article className="social-outgoing__item" key={item.id}>
                        <AvatarFrame frameId={item.user.frameId}>
                          <Avatar customUrl={item.user.customAvatarUrl} googleUrl={item.user.photoUrl} name={item.user.displayName} size="small" />
                        </AvatarFrame>
                        <span className="social-outgoing__copy">
                          <strong>{item.user.displayName}</strong>
                          <small><span aria-hidden="true" className="social-outgoing__pending" />Aguardando resposta</small>
                        </span>
                        <Button
                          aria-label={`Cancelar solicitação para ${item.user.displayName}`}
                          className="social-outgoing__cancel"
                          disabled={busy !== null}
                          onClick={() => void mutate(item.id, `/api/social/requests/${item.id}/cancel`)}
                          type="button"
                          variant="ghost"
                        >Cancelar</Button>
                      </article>
                    ))}
                  </div>
                  {snapshot.outgoingNextCursor !== null ? (
                    <Button disabled={loadingMoreRequests !== null} onClick={() => void loadMoreRequests('outgoing')} type="button" variant="ghost">
                      {loadingMoreRequests === 'outgoing' ? 'Carregando…' : 'Carregar mais'}
                    </Button>
                  ) : null}
                </section>
              ) : null}
            </>
          )}
        </>
      )}
      {blocking !== null ? (
        <SocialConfirmDialog
          actionLabel="Bloquear usuário"
          description="Bloquear esta pessoa impedirá que vocês se encontrem nas buscas, solicitações e futuras partidas."
          onCancel={() => setBlocking(null)}
          onConfirm={() => {
            const target = blocking;
            setBlocking(null);
            void mutate(target.publicId, '/api/social/blocks', { body: { publicId: target.publicId } });
          }}
          title={`Bloquear ${blocking.displayName}?`}
        />
      ) : null}
    </section>
  );
}
