import { useCallback, useEffect, useState } from 'react';
import { Avatar } from '../components/avatar.js';
import { AvatarFrame } from '../components/avatar-frame.js';
import { EmptyState, LoadingState } from '../components/async-state.js';
import { Button } from '../components/button.js';
import { Icon } from '../components/icons.js';
import { SocialConfirmDialog } from '../components/social-confirm-dialog.js';
import { useAuth } from '../features/auth-context.js';
import { useSocial } from '../features/social-context.js';
import { apiRequest } from '../lib/api.js';
import type { SocialCandidate, SocialSnapshot, SocialUser } from '../lib/social.js';

const EMPTY_SNAPSHOT: SocialSnapshot = { friends: [], incoming: [], outgoing: [] };

function SocialIdentity({ user }: { user: SocialUser }) {
  return (
    <div className="social-person__identity">
      <AvatarFrame frameId={user.frameId}>
        <Avatar customUrl={user.customAvatarUrl} googleUrl={user.photoUrl} name={user.displayName} size="medium" />
      </AvatarFrame>
      <div><strong>{user.displayName}</strong><span>{user.publicId}</span></div>
    </div>
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

  async function mutate(key: string, path: string, options: { body?: unknown; method?: 'DELETE' | 'POST' } = {}) {
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
  }

  const visibleResults = search.trim().length >= 2 ? results : [];

  return (
    <section className="page">
      <div className="page-heading">
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

              <section aria-label="Amigos" className="social-section">
                <div className="section-heading"><h2>Amigos</h2><span>{snapshot.friends.length}</span></div>
                {snapshot.friends.length === 0 ? (
                  <EmptyState
                    description="Busque um jogador pelo nome ou pelo ID público para começar."
                    title="Sua lista está pronta para crescer"
                  />
                ) : null}
                {snapshot.friends.map((user) => (
                  <article className="social-person" key={user.publicId}>
                    <SocialIdentity user={user} />
                    <div className="social-person__actions">
                      <button className="social-person__quiet-action" disabled={busy !== null} onClick={() => void mutate(
                        user.publicId, '/api/social/friends', { body: { publicId: user.publicId }, method: 'DELETE' },
                      )} type="button">Remover amigo</button>
                      <button aria-label={`Bloquear ${user.displayName}`} className="social-person__quiet-action" disabled={busy !== null} onClick={() => setBlocking(user)} type="button">Bloquear</button>
                    </div>
                  </article>
                ))}
              </section>
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
