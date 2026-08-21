import { levelProgress } from '@quiz-gomes/domain';
import { lazy, Suspense, useState, type FormEvent } from 'react';
import { Avatar } from '../components/avatar.js';
import { AvatarFrame } from '../components/avatar-frame.js';
import { LoadingState } from '../components/async-state.js';
import { Button } from '../components/button.js';
import { RankBadge } from '../components/rank-badge.js';
import { SocialConfirmDialog } from '../components/social-confirm-dialog.js';
import { useAuth } from '../features/auth-context.js';
import { useSocial } from '../features/social-context.js';
import { useThemeMode, type ThemeMode } from '../hooks/use-theme-mode.js';
import { apiRequest } from '../lib/api.js';
import { activateFriendNotifications, browserNotificationState, publicVapidKey } from '../lib/social-notifications.js';
import type { SocialUser } from '../lib/social.js';

const AvatarEditor = lazy(() => import('../components/avatar-editor.js'));

export function ProfilePage() {
  const {
    error,
    firebaseUser,
    getToken,
    profile,
    removeCustomAvatar,
    role,
    signIn,
    signOut,
    updateDisplayName,
    uploadCustomAvatar,
  } = useAuth();
  const { pushConfigured, refresh } = useSocial();
  const { mode, setMode } = useThemeMode();
  const [editing, setEditing] = useState(false);
  const [editingAvatar, setEditingAvatar] = useState(false);
  const [name, setName] = useState(profile?.displayName ?? '');
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [blockedUsers, setBlockedUsers] = useState<SocialUser[]>([]);
  const [privacyLoading, setPrivacyLoading] = useState(false);
  const [unblocking, setUnblocking] = useState<SocialUser | null>(null);
  const [notificationState, setNotificationState] = useState(browserNotificationState);
  const [notificationBusy, setNotificationBusy] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const progress = levelProgress(profile?.totalXp ?? 0);

  async function submit(event: FormEvent) {
    event.preventDefault();
    await updateDisplayName(name);
    setEditing(false);
  }

  async function togglePrivacy() {
    if (privacyOpen) {
      setPrivacyOpen(false);
      return;
    }
    setPrivacyOpen(true);
    setPrivacyLoading(true);
    try {
      const response = await apiRequest<{ users: SocialUser[] }>('/api/social/blocks', { getToken });
      setBlockedUsers(response.users);
    } catch (reason) {
      setSettingsError(reason instanceof Error ? reason.message : 'Não foi possível carregar usuários bloqueados.');
    } finally {
      setPrivacyLoading(false);
    }
  }

  async function unblock(user: SocialUser) {
    setUnblocking(null);
    try {
      await apiRequest('/api/social/blocks', {
        body: { publicId: user.publicId },
        getToken,
        method: 'DELETE',
      });
      setBlockedUsers((current) => current.filter((item) => item.publicId !== user.publicId));
      await refresh();
    } catch (reason) {
      setSettingsError(reason instanceof Error ? reason.message : 'Não foi possível desbloquear este usuário.');
    }
  }

  async function activateNotifications() {
    setNotificationBusy(true);
    setSettingsError(null);
    try {
      const state = await activateFriendNotifications(getToken, () => void refresh());
      setNotificationState(state);
    } catch (reason) {
      setSettingsError(reason instanceof Error ? reason.message : 'Não foi possível ativar notificações.');
    } finally {
      setNotificationBusy(false);
    }
  }

  if (firebaseUser === null) {
    return (
      <section className="page page--narrow">
        <div className="profile-welcome"><span className="profile-welcome__halo"><Avatar name="Visitante" size="large" /></span><span className="eyebrow">Seu espaço</span><h1>Entre no Quiz Gomes</h1><p>Crie seu ID permanente, encontre amigos e construa rankings diferentes em cada tema.</p><Button onClick={() => void signIn()}>Continuar com Google</Button>{error && <p className="form-error">{error}</p>}</div>
      </section>
    );
  }

  return (
    <section className="page page--profile">
      <div className="profile-hero">
        <AvatarFrame frameId={profile?.equippedFrameId} variant="result">
          <Avatar customUrl={profile?.customAvatarUrl} googleUrl={profile?.photoUrl ?? firebaseUser.photoURL} name={profile?.displayName ?? firebaseUser.displayName ?? 'Jogador'} size="large" />
        </AvatarFrame>
        <div><span className="eyebrow">{role === 'ADMIN' ? 'Jogador · ADMIN' : 'Jogador'}</span><h1>{profile?.displayName ?? firebaseUser.displayName}</h1><p>{profile?.publicId ?? 'Criando ID público…'}</p></div>
        {profile && <div className="profile-hero__actions"><Button onClick={() => setEditingAvatar((value) => !value)} variant="secondary">Trocar avatar</Button><Button onClick={() => { setName(profile.displayName); setEditing((value) => !value); }} variant="ghost">Editar nome</Button></div>}
      </div>
      {editingAvatar && profile ? (
        <Suspense fallback={<LoadingState label="Abrindo editor de avatar" />}>
          <AvatarEditor
            hasCustomAvatar={profile.customAvatarUrl !== null}
            onClose={() => setEditingAvatar(false)}
            onRemove={removeCustomAvatar}
            onSave={uploadCustomAvatar}
          />
        </Suspense>
      ) : null}
      {editing && <form className="inline-edit" onSubmit={(event) => void submit(event)}><label className="field"><span>Novo nome</span><input maxLength={32} minLength={2} onChange={(event) => setName(event.target.value)} value={name} /></label><Button type="submit">Salvar</Button></form>}
      <div className="profile-grid">
        <article className="level-card"><span>Nível</span><strong>{progress.level}</strong><div className="progress-track"><span style={{ transform: `scaleX(${progress.progress})` }} /></div><small>{progress.nextLevelXp === null ? 'MAX' : `${progress.currentLevelXp} / ${progress.nextLevelXp} XP`}</small></article>
        <article className="profile-card"><span className="eyebrow">Melhor tema</span><RankBadge knowledge={0} showKnowledge /><p>Jogue sua primeira Ranqueada para preencher este espaço.</p></article>
      </div>
      <section className="settings-card"><div><h2>Aparência</h2><p>A preferência acompanha este dispositivo.</p></div><div className="segmented" role="radiogroup" aria-label="Aparência">{(['light', 'dark', 'system'] as ThemeMode[]).map((value) => <button aria-checked={mode === value} className={mode === value ? 'segmented__active' : ''} key={value} onClick={() => setMode(value)} role="radio" type="button">{{ light: 'Claro', dark: 'Escuro', system: 'Sistema' }[value]}</button>)}</div></section>
      <section className="settings-card">
        <div><h2>Notificações</h2><p>Receba pedidos de amizade neste dispositivo.</p></div>
        {notificationState === 'denied' ? (
          <span className="settings-card__status">Notificações bloqueadas pelo navegador</span>
        ) : notificationState === 'unsupported' ? (
          <span className="settings-card__status">Notificações indisponíveis neste navegador</span>
        ) : notificationState === 'granted' ? (
          <span className="settings-card__status settings-card__status--enabled">Pedidos de amizade ativados</span>
        ) : !pushConfigured || publicVapidKey() === '' ? (
          <span className="settings-card__status">Notificações ainda não configuradas</span>
        ) : (
          <Button disabled={notificationBusy} onClick={() => void activateNotifications()} variant="secondary">
            {notificationBusy ? 'Ativando...' : 'Ativar notificações'}
          </Button>
        )}
      </section>
      <section className="settings-card settings-card--privacy">
        <div><h2>Privacidade e Segurança</h2><p>Gerencie quem não pode encontrar você.</p></div>
        <Button aria-expanded={privacyOpen} onClick={() => void togglePrivacy()} variant="secondary">
          {privacyOpen ? 'Fechar usuários bloqueados' : 'Usuários bloqueados'}
        </Button>
        {privacyOpen ? (
          <div className="blocked-users-list">
            <h3>Usuários bloqueados</h3>
            {privacyLoading ? <LoadingState label="Carregando usuários bloqueados" /> : null}
            {!privacyLoading && blockedUsers.length === 0 ? <p>Nenhum usuário bloqueado.</p> : null}
            {blockedUsers.map((user) => (
              <article className="social-person" key={user.publicId}>
                <div className="social-person__identity">
                  <AvatarFrame frameId={user.frameId}>
                    <Avatar customUrl={user.customAvatarUrl} googleUrl={user.photoUrl} name={user.displayName} size="medium" />
                  </AvatarFrame>
                  <div><strong>{user.displayName}</strong><span>{user.publicId}</span></div>
                </div>
                <Button onClick={() => setUnblocking(user)} variant="secondary">Desbloquear</Button>
              </article>
            ))}
          </div>
        ) : null}
      </section>
      {settingsError !== null ? <p className="form-message form-message--error" role="alert">{settingsError}</p> : null}
      <section className="settings-card"><div><h2>Créditos</h2><p>Quiz Gomes foi criado por Gomes.</p></div></section>
      <Button onClick={() => void signOut()} variant="ghost">Sair da conta</Button>
      {unblocking !== null ? (
        <SocialConfirmDialog
          actionLabel="Desbloquear"
          description="Vocês poderão voltar a se encontrar nas buscas e em futuras partidas."
          onCancel={() => setUnblocking(null)}
          onConfirm={() => void unblock(unblocking)}
          title={`Desbloquear ${unblocking.displayName}?`}
        />
      ) : null}
    </section>
  );
}
