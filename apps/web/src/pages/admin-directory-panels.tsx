import { useEffect, useState } from 'react';
import { Button } from '../components/button.js';
import { ConfirmDialog } from '../components/confirm-dialog.js';
import { apiRequest } from '../lib/api.js';
import type { AdminUserPage, AdminUserRecord, AuditLogPage } from '../lib/models.js';

type GetToken = (forceRefresh?: boolean) => Promise<string | null>;

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function AdminUsersPanel({ currentUserId, getToken }: { currentUserId: string | null; getToken: GetToken }) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState<AdminUserPage>({ nextCursor: null, users: [] });
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmingRevoke, setConfirmingRevoke] = useState<AdminUserRecord | null>(null);

  function load(search_: string, cursor: string | null, replace: boolean) {
    setLoading(true);
    setMessage(null);
    const params = new URLSearchParams();
    if (search_.trim() !== '') params.set('search', search_.trim());
    if (cursor !== null) params.set('cursor', cursor);
    void apiRequest<AdminUserPage>(`/api/admin/users?${params}`, { getToken })
      .then((result) => setPage((current) => ({
        nextCursor: result.nextCursor, users: replace ? result.users : [...current.users, ...result.users],
      })))
      .catch((loadError: unknown) => setMessage(errorText(loadError, 'Não foi possível abrir os usuários.')))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    const delay = window.setTimeout(() => load(search, null, true), 180);
    return () => window.clearTimeout(delay);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load é recriada a cada render; só a busca decide a chamada.
  }, [getToken, search]);

  async function toggleRole(user: AdminUserRecord) {
    setBusyId(user.userId);
    setMessage(null);
    try {
      await apiRequest(`/api/admin/users/${encodeURIComponent(user.userId)}/roles/admin`, {
        getToken, method: user.role === 'ADMIN' ? 'DELETE' : 'POST',
      });
      setPage((current) => ({
        ...current,
        users: current.users.map((item) => item.userId === user.userId ? { ...item, role: item.role === 'ADMIN' ? 'PLAYER' : 'ADMIN' } : item),
      }));
    } catch (toggleError) {
      setMessage(errorText(toggleError, 'Não foi possível alterar o papel deste usuário.'));
    } finally {
      setBusyId(null);
      setConfirmingRevoke(null);
    }
  }

  return (
    <section className="admin-panel" aria-labelledby="admin-users-title">
      <div className="section-heading"><div><span className="eyebrow">Administração</span><h2 id="admin-users-title">Usuários e papéis</h2></div></div>
      <label className="search-field"><span className="sr-only">Buscar usuário</span><input onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por ID público ou nome" type="search" value={search} /></label>
      {message !== null && <p className="form-message form-message--error" role="status">{message}</p>}
      {loading && page.users.length === 0 ? <p className="inline-notice">Carregando usuários…</p> : null}
      {!loading && page.users.length === 0 && message === null ? <p className="inline-notice">Nenhum usuário encontrado.</p> : null}
      <ul className="admin-list">
        {page.users.map((user) => {
          const isSelf = currentUserId !== null && user.userId === currentUserId;
          return (
            <li className="admin-list__row" key={user.userId}>
              <div><strong>{user.displayName}</strong><small>{user.publicId}</small></div>
              <span>{user.role === 'ADMIN' ? 'ADMIN' : 'Jogador'}</span>
              <Button
                disabled={busyId === user.userId || (user.role === 'ADMIN' && isSelf)}
                onClick={() => user.role === 'ADMIN' ? setConfirmingRevoke(user) : void toggleRole(user)}
                title={user.role === 'ADMIN' && isSelf ? 'Peça a outro ADMIN para revogar o seu próprio acesso.' : undefined}
                type="button"
                variant={user.role === 'ADMIN' ? 'ghost' : 'secondary'}
              >
                {busyId === user.userId ? 'Aguarde…' : user.role === 'ADMIN' ? 'Revogar ADMIN' : 'Conceder ADMIN'}
              </Button>
            </li>
          );
        })}
      </ul>
      {page.nextCursor !== null && (
        <Button disabled={loading} onClick={() => load(search, page.nextCursor, false)} type="button" variant="ghost">
          {loading ? 'Carregando…' : 'Carregar mais'}
        </Button>
      )}
      {confirmingRevoke !== null && (
        <ConfirmDialog
          body={`“${confirmingRevoke.displayName}” perde acesso imediato ao painel administrativo.`}
          busy={busyId === confirmingRevoke.userId}
          confirmLabel="Revogar ADMIN"
          onCancel={() => setConfirmingRevoke(null)}
          onConfirm={() => void toggleRole(confirmingRevoke)}
          title={`Revogar ADMIN de ${confirmingRevoke.displayName}?`}
        />
      )}
    </section>
  );
}

export function AdminAuditLogPanel({ getToken, refreshKey = 0 }: { getToken: GetToken; refreshKey?: number }) {
  const [page, setPage] = useState<AuditLogPage>({ entries: [], nextCursor: null });
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  function load(cursor: string | null, replace: boolean) {
    setLoading(true);
    setMessage(null);
    const params = new URLSearchParams();
    if (cursor !== null) params.set('cursor', cursor);
    void apiRequest<AuditLogPage>(`/api/admin/audit-logs?${params}`, { getToken })
      .then((result) => setPage((current) => ({
        entries: replace ? result.entries : [...current.entries, ...result.entries], nextCursor: result.nextCursor,
      })))
      .catch((loadError: unknown) => setMessage(errorText(loadError, 'Não foi possível abrir a trilha de auditoria.')))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    // Microtask para não chamar setState de forma síncrona no corpo do efeito.
    queueMicrotask(() => load(null, true));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load é recriada a cada render; só getToken/refreshKey decidem a busca.
  }, [getToken, refreshKey]);

  return (
    <section className="admin-panel" aria-labelledby="admin-audit-log-title">
      <div className="section-heading"><div><span className="eyebrow">Administração</span><h2 id="admin-audit-log-title">Trilha de auditoria</h2></div></div>
      {message !== null && <p className="form-message form-message--error" role="status">{message}</p>}
      {loading && page.entries.length === 0 ? <p className="inline-notice">Carregando auditoria…</p> : null}
      {!loading && page.entries.length === 0 && message === null ? <p className="inline-notice">Nenhuma ação registrada ainda.</p> : null}
      <ul className="admin-list admin-list--audit">
        {page.entries.map((entry) => (
          <li className="admin-list__row admin-list__row--audit" key={entry.id}>
            <div>
              <strong>{entry.action}</strong>
              <small>{entry.entityType}{entry.entityId !== null ? ` · ${entry.entityId}` : ''}</small>
            </div>
            <span>{entry.actorDisplayName ?? 'Sistema'}</span>
            <time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString('pt-BR')}</time>
          </li>
        ))}
      </ul>
      {page.nextCursor !== null && (
        <Button disabled={loading} onClick={() => load(page.nextCursor, false)} type="button" variant="ghost">
          {loading ? 'Carregando…' : 'Carregar mais'}
        </Button>
      )}
    </section>
  );
}
