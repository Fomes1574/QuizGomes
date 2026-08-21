import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Avatar } from '../components/avatar.js';
import { AvatarFrame } from '../components/avatar-frame.js';
import { EmptyState, LoadingState } from '../components/async-state.js';
import { Button } from '../components/button.js';
import { Icon } from '../components/icons.js';
import { SocialConfirmDialog } from '../components/social-confirm-dialog.js';
import { useAuth } from '../features/auth-context.js';
import { useFriendPresence, useSocial } from '../features/social-context.js';
import { apiRequest } from '../lib/api.js';
import type { FriendPresence, SocialCandidate, SocialSnapshot, SocialUser } from '../lib/social.js';

const EMPTY_SNAPSHOT: SocialSnapshot = { friends: [], incoming: [], outgoing: [] };
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

const FriendCard = memo(function FriendCard({
  disabled,
  onBlock,
  onRemove,
  presence,
  user,
}: {
  disabled: boolean;
  onBlock: (user: SocialUser) => void;
  onRemove: (user: SocialUser) => void;
  presence: FriendPresence;
  user: SocialUser;
}) {
  return (
    <article
      className="social-person social-friend"
      data-friend-id={user.publicId}
      data-presence={presence}
    >
      <SocialIdentity presence={presence} user={user} />
      <div className="social-person__actions social-friend__actions">
        <button
          className="social-person__quiet-action"
          disabled={disabled}
          onClick={() => onRemove(user)}
          type="button"
        >Remover amigo</button>
        <button
          aria-label={`Bloquear ${user.displayName}`}
          className="social-person__quiet-action"
          disabled={disabled}
          onClick={() => onBlock(user)}
          type="button"
        >Bloquear</button>
      </div>
    </article>
  );
});

type FriendRow =
  | { key: string; kind: 'heading'; label: string; total: number }
  | { key: string; kind: 'friend'; presence: FriendPresence; user: SocialUser };

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
  friends,
  onBlock,
  onRemove,
}: {
  disabled: boolean;
  friends: SocialUser[];
  onBlock: (user: SocialUser) => void;
  onRemove: (user: SocialUser) => void;
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
      available: online.filter(({ presence }) => presence === 'ONLINE' || presence === 'MATCHMAKING').length,
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
        <div><h2>Amigos</h2><span className="social-friends__total">{friends.length}</span></div>
        {friends.length > 0 ? (
          <div className="social-friends__summary">
            <span><i aria-hidden="true" data-presence="ONLINE" />{organizedFriends.available} disponíveis</span>
            <span><i aria-hidden="true" data-presence="IN_MATCH" />{organizedFriends.busy} em partida</span>
          </div>
        ) : null}
      </div>
      {friends.length === 0 ? (
        <EmptyState
          description="Busque um jogador pelo nome ou pelo ID público para começar."
          title="Sua lista está pronta para crescer"
        />
      ) : null}
      {organizedFriends.rows.length > 0 ? (
        <div className="social-friends__list" ref={friendList}>
          {organizedFriends.rows.map((row) => row.kind === 'heading' ? (
            <h3 className="social-friends__group" key={row.key}>
              {row.label}<span>{row.total}</span>
            </h3>
          ) : (
            <FriendCard
              disabled={disabled}
              key={row.key}
              onBlock={onBlock}
              onRemove={onRemove}
              presence={row.presence}
              user={row.user}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function SocialPage() {
  const { getToken, profile, signIn } = useAuth();
  const { refresh, revision } = useSocial();
  const [snapshot, setSnapshot] = useState<SocialSnapshot>(EMPTY_SNAPSHOT);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<SocialCandidate[]>([]);
  const [loading, setLoading] = useState(profile !== null);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blocking, setBlocking] = useState<SocialUser | null>(null);

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
              <section aria-label="Pedidos recebidos" className="social-section" id="pedidos">
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
              </section>

              {snapshot.outgoing.length > 0 ? (
                <section aria-label="Pedidos enviados" className="social-section">
                  <div className="section-heading"><h2>Enviados</h2><span>{snapshot.outgoing.length}</span></div>
                  {snapshot.outgoing.map((item) => (
                    <article className="social-person" key={item.id}>
                      <SocialIdentity user={item.user} />
                      <small className="social-person__message">Aguardando resposta</small>
                      <button className="social-person__quiet-action" disabled={busy !== null} onClick={() => void mutate(
                        item.id, `/api/social/requests/${item.id}/cancel`,
                      )} type="button">Cancelar solicitação</button>
                    </article>
                  ))}
                </section>
              ) : null}

              <FriendsSection
                disabled={busy !== null}
                friends={snapshot.friends}
                onBlock={setBlocking}
                onRemove={removeFriend}
              />
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
