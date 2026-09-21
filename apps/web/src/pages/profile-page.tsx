import { levelProgress } from '@quiz-gomes/domain';
import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react';
import { NavLink } from 'react-router-dom';
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
import type { CategoryAverage, MatchSummary } from '../lib/models.js';
import { activateFriendNotifications, browserNotificationState, publicVapidKey } from '../lib/social-notifications.js';
import type { SocialUser } from '../lib/social.js';

const AvatarEditor = lazy(() => import('../components/avatar-editor.js'));

interface MissionSummary {
  completedAt: string | null;
  progress: number;
  target: number;
  type: 'ANSWER_QUESTIONS' | 'CORRECT_ANSWERS' | 'PLAY_MATCH';
}

interface StreakSummary {
  bestStreak: number;
  currentStreak: number;
  themeName: string;
}

const MISSION_LABELS: Record<MissionSummary['type'], string> = {
  ANSWER_QUESTIONS: 'Responda perguntas',
  CORRECT_ANSWERS: 'Acerte perguntas',
  PLAY_MATCH: 'Jogue uma partida válida',
};

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
  const [blockedUsersCursor, setBlockedUsersCursor] = useState<string | null>(null);
  const [privacyLoading, setPrivacyLoading] = useState(false);
  const [loadingMoreBlocked, setLoadingMoreBlocked] = useState(false);
  const [unblocking, setUnblocking] = useState<SocialUser | null>(null);
  const [notificationState, setNotificationState] = useState(browserNotificationState);
  const [notificationBusy, setNotificationBusy] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [bestTheme, setBestTheme] = useState<{ knowledge: number; name: string; rankedMatches: number; slug: string } | null>(null);
  const [missions, setMissions] = useState<MissionSummary[]>([]);
  const [activeStreak, setActiveStreak] = useState<StreakSummary | null>(null);
  const [matchSummary, setMatchSummary] = useState<MatchSummary | null>(null);
  const [categoryAverages, setCategoryAverages] = useState<CategoryAverage[]>([]);
  const progress = levelProgress(profile?.totalXp ?? 0);

  useEffect(() => {
    if (profile === null) return;
    let active = true;
    void apiRequest<{
      activeStreak: StreakSummary | null; bestTheme: typeof bestTheme; categoryAverages: CategoryAverage[];
      matchSummary: MatchSummary; missions: MissionSummary[];
    }>('/api/profile/summary', { getToken })
      .then((response) => {
        if (!active) return;
        setBestTheme(response.bestTheme ?? null);
        setMissions(response.missions ?? []);
        setActiveStreak(response.activeStreak ?? null);
        setMatchSummary(response.matchSummary ?? null);
        setCategoryAverages(response.categoryAverages ?? []);
      })
      .catch(() => {
        if (!active) return;
        setBestTheme(null);
        setMissions([]);
        setActiveStreak(null);
        setMatchSummary(null);
        setCategoryAverages([]);
      });
    return () => { active = false; };
  }, [getToken, profile]);

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
      const response = await apiRequest<{ nextCursor: string | null; users: SocialUser[] }>('/api/social/blocks', { getToken });
      setBlockedUsers(response.users);
      setBlockedUsersCursor(response.nextCursor);
    } catch (reason) {
      setSettingsError(reason instanceof Error ? reason.message : 'Não foi possível carregar usuários bloqueados.');
    } finally {
      setPrivacyLoading(false);
    }
  }

  async function loadMoreBlocked() {
    if (blockedUsersCursor === null) return;
    setLoadingMoreBlocked(true);
    try {
      const response = await apiRequest<{ nextCursor: string | null; users: SocialUser[] }>(
        `/api/social/blocks?cursor=${encodeURIComponent(blockedUsersCursor)}`, { getToken },
      );
      setBlockedUsers((current) => [...current, ...response.users]);
      setBlockedUsersCursor(response.nextCursor);
    } catch (reason) {
      setSettingsError(reason instanceof Error ? reason.message : 'Não foi possível carregar mais usuários bloqueados.');
    } finally {
      setLoadingMoreBlocked(false);
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
        <article className="profile-card"><span className="eyebrow">Melhor tema</span>{bestTheme === null ? <p>Jogue sua primeira Ranqueada para preencher este espaço.</p> : <><h2>{bestTheme.name}</h2><RankBadge knowledge={bestTheme.knowledge} showKnowledge /><p>{bestTheme.rankedMatches} {bestTheme.rankedMatches === 1 ? 'partida Ranqueada' : 'partidas Ranqueadas'}</p></>}</article>
        <article className="profile-card">
          <span className="eyebrow">Missões de hoje</span>
          <ul className="missions-list">
            {missions.map((mission) => (
              <li className="missions-list__item" data-done={mission.completedAt !== null} key={mission.type}>
                <div className="missions-list__row"><span>{MISSION_LABELS[mission.type]}</span><span>{Math.min(mission.progress, mission.target)}/{mission.target}</span></div>
                <div className="progress-track"><span style={{ transform: `scaleX(${mission.target === 0 ? 0 : Math.min(1, mission.progress / mission.target)})` }} /></div>
              </li>
            ))}
            {missions.length === 0 && <li>Sem missões disponíveis hoje.</li>}
          </ul>
        </article>
        <article className="profile-card"><span className="eyebrow">Sequência</span>{activeStreak === null ? <p>Jogue uma partida válida em qualquer tema para começar sua sequência.</p> : <><h2>{activeStreak.currentStreak} {activeStreak.currentStreak === 1 ? 'dia' : 'dias'}</h2><p>{activeStreak.themeName} · recorde de {activeStreak.bestStreak} {activeStreak.bestStreak === 1 ? 'dia' : 'dias'}</p></>}</article>
        <article className="profile-card">
          <span className="eyebrow">Partidas Ranqueadas</span>
          {matchSummary === null || matchSummary.matches === 0 ? <p>Jogue sua primeira Ranqueada para preencher este espaço.</p> : (
            <ul className="match-summary">
              <li><strong>{matchSummary.matches}</strong><span>Partidas</span></li>
              <li><strong>{matchSummary.wins}</strong><span>Vitórias</span></li>
              <li><strong>{matchSummary.losses}</strong><span>Derrotas</span></li>
              <li><strong>{matchSummary.draws}</strong><span>Empates</span></li>
            </ul>
          )}
        </article>
        <article className="profile-card">
          <span className="eyebrow">Média por categoria</span>
          {categoryAverages.length === 0 ? <p>Jogue Ranqueadas em mais de um tema da mesma categoria para ver sua média.</p> : (
            <ul className="category-average-list">
              {categoryAverages.map((entry) => (
                <li key={entry.categoryId}>
                  <span>{entry.categoryName}</span>
                  <RankBadge knowledge={entry.average.rank.knowledge} />
                </li>
              ))}
            </ul>
          )}
        </article>
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
            {blockedUsersCursor !== null ? (
              <Button disabled={loadingMoreBlocked} onClick={() => void loadMoreBlocked()} variant="ghost">
                {loadingMoreBlocked ? 'Carregando…' : 'Carregar mais'}
              </Button>
            ) : null}
          </div>
        ) : null}
      </section>
      {settingsError !== null ? <p className="form-message form-message--error" role="alert">{settingsError}</p> : null}
      {role === 'ADMIN' ? <section className="settings-card"><div><h2>Administração</h2><p>Gerencie conteúdo, moderação, usuários e auditoria.</p></div><NavLink className="button button--secondary" to="/admin">Abrir administração</NavLink></section> : null}
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
