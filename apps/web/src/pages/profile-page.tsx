import { levelProgress, rankForKnowledge } from '@quiz-gomes/domain';
import '../styles/profile.css';
import { lazy, Suspense, useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { NavLink } from 'react-router-dom';
import { Avatar } from '../components/avatar.js';
import { AvatarFrame } from '../components/avatar-frame.js';
import { LoadingState } from '../components/async-state.js';
import { Button } from '../components/button.js';
import { Icon } from '../components/icons.js';
import {
  AchievementsCard,
  MissionsCard,
  ModeStatsCard,
  RecentMatchesCard,
  StreakCard,
  ThemeRecordsCard,
  type MissionSummary,
  type RecentMatch,
  type StreakSummary,
  type ThemeRecord,
} from '../components/profile-sections.js';
import { ShareCardButton } from '../components/share-result-button.js';
import { StreakReminderToggle } from '../components/streak-reminder-toggle.js';
import { FRAME_RING_COLORS, type AchievementItem, type FrameItem } from '../lib/achievements.js';
import { RankBadge } from '../components/rank-badge.js';
import { SocialConfirmDialog } from '../components/social-confirm-dialog.js';
import { useAuth } from '../features/auth-context.js';
import { useSocial } from '../features/social-context.js';
import { useThemeMode, type ThemeMode } from '../hooks/use-theme-mode.js';
import { apiRequest } from '../lib/api.js';
import { FriendQueueAlertToggle } from '../components/friend-queue-alert-toggle.js';
import { feedback, setFeedbackPreference, useFeedbackPreferences } from '../lib/feedback.js';
import type { CategoryAverage, MatchSummary } from '../lib/models.js';
import { activateFriendNotifications, browserNotificationState, publicVapidKey } from '../lib/social-notifications.js';
import type { SocialUser } from '../lib/social.js';

const AvatarEditor = lazy(() => import('../components/avatar-editor.js'));

interface ProfileSummaryResponse {
  achievements?: AchievementItem[];
  activeStreak: StreakSummary | null;
  bestTheme: { knowledge: number; name: string; rankedMatches: number; slug: string } | null;
  casualSummary?: MatchSummary;
  categoryAverages: CategoryAverage[];
  frames?: FrameItem[];
  matchSummary?: MatchSummary;
  missions: MissionSummary[];
  missionsResetAt?: string;
  recentMatches?: RecentMatch[];
  streakReminder?: boolean;
  themeRecords?: ThemeRecord[];
}

export function ProfilePage() {
  const {
    error,
    firebaseUser,
    getToken,
    profile,
    removeCustomAvatar,
    retryProfile,
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
  const [summary, setSummary] = useState<ProfileSummaryResponse | null>(null);
  const [busyFrame, setBusyFrame] = useState<string | null>(null);
  const progress = levelProgress(profile?.totalXp ?? 0);
  const feedbackPreferences = useFeedbackPreferences();

  useEffect(() => {
    if (profile === null) return;
    let active = true;
    void apiRequest<ProfileSummaryResponse>('/api/profile/summary', { getToken })
      .then((response) => { if (active) setSummary(response); })
      .catch(() => { if (active) setSummary(null); });
    return () => { active = false; };
    // A troca de moldura atualiza o perfil, mas não precisa recarregar o resumo.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recarrega por pessoa, não por campo do perfil.
  }, [getToken, profile?.userId]);

  async function equipFrame(frameId: string | null) {
    setBusyFrame(frameId ?? 'none');
    setSettingsError(null);
    try {
      await apiRequest('/api/profile/frame', { body: { frameId }, getToken, method: 'PUT' });
      setSummary((current) => current === null ? current : {
        ...current,
        frames: (current.frames ?? []).map((frame) => ({ ...frame, equipped: frame.id === frameId })),
      });
      await retryProfile();
    } catch (reason) {
      setSettingsError(reason instanceof Error ? reason.message : 'Não foi possível trocar a moldura.');
    } finally {
      setBusyFrame(null);
    }
  }

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
        <div className="profile-welcome"><span className="profile-welcome__halo"><Avatar name="Visitante" size="large" /></span><span className="eyebrow">Seu espaço</span><h1>Entre no QUIZ GOMES</h1><p>Entre com o Google, escolha um nome e comece a duelar.</p><Button onClick={() => void signIn()}>Continuar com Google</Button>{error && <p className="form-error">{error}</p>}</div>
      </section>
    );
  }

  return (
    <section className="page page--profile">
      <div className="profile-hero">
        <span className="xp-ring xp-ring--large" style={{ '--xp-progress': progress.progress } as CSSProperties}>
          <AvatarFrame frameId={profile?.equippedFrameId} variant="result">
            <Avatar customUrl={profile?.customAvatarUrl} googleUrl={profile?.photoUrl ?? firebaseUser.photoURL} name={profile?.displayName ?? firebaseUser.displayName ?? 'Jogador'} size="large" />
          </AvatarFrame>
          <span aria-hidden="true" className="xp-ring__level">{progress.level}</span>
        </span>
        <div><span className="eyebrow">{role === 'ADMIN' ? 'Jogador · ADMIN' : 'Jogador'}</span><h1>{profile?.displayName ?? firebaseUser.displayName}</h1><p>{profile?.publicId ?? 'Criando ID público…'}</p></div>
        {profile && (
          <div className="profile-hero__actions">
            <ShareCardButton
              card={{
                input: {
                  avatarUrl: profile.customAvatarUrl ?? profile.photoUrl ?? null,
                  bestTheme: summary?.bestTheme == null ? null : {
                    name: summary.bestTheme.name,
                    rankLabel: `${rankForKnowledge(summary.bestTheme.knowledge).tier} ${rankForKnowledge(summary.bestTheme.knowledge).division}`,
                  },
                  frameColors: profile.equippedFrameId === null ? null : FRAME_RING_COLORS[profile.equippedFrameId] ?? null,
                  level: progress.level,
                  name: profile.displayName,
                  publicId: profile.publicId,
                  streak: summary?.activeStreak?.currentStreak ?? 0,
                  wins: (summary?.matchSummary?.wins ?? 0) + (summary?.casualSummary?.wins ?? 0),
                },
                kind: 'profile',
              }}
              label="Compartilhar perfil"
              message={{ text: `Me desafia no QUIZ GOMES! Me adiciona: ${profile.publicId}`, url: window.location.origin }}
              variant="primary"
            />
            <Button onClick={() => setEditingAvatar((value) => !value)} variant="secondary">Trocar avatar</Button>
            <Button onClick={() => { setName(profile.displayName); setEditing((value) => !value); }} variant="ghost">Editar nome</Button>
          </div>
        )}
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
        <article className="level-card"><span>Nível</span><strong>{progress.level}</strong><div className="progress-track"><span style={{ transform: `scaleX(${progress.progress})` }} /></div><small>{progress.nextLevelXp === null ? 'Nível máximo' : `${progress.currentLevelXp} / ${progress.nextLevelXp} XP`}</small></article>
        <StreakCard streak={summary?.activeStreak ?? null} />
        <MissionsCard missions={summary?.missions ?? []} resetAt={summary?.missionsResetAt ?? null} />
        <ModeStatsCard casual={summary?.casualSummary ?? null} ranked={summary?.matchSummary ?? null} />
        <RecentMatchesCard matches={summary?.recentMatches ?? []} />
        <ThemeRecordsCard records={summary?.themeRecords ?? []} />
        <AchievementsCard
          achievements={summary?.achievements ?? []}
          busyFrame={busyFrame}
          frames={summary?.frames ?? []}
          onEquip={(frameId) => void equipFrame(frameId)}
        />
        <article className="profile-card"><span className="eyebrow">Melhor tema</span>{summary?.bestTheme == null ? <p>Sua primeira Rankeada aparece aqui.</p> : <><h2>{summary.bestTheme.name}</h2><RankBadge knowledge={summary.bestTheme.knowledge} showKnowledge /><p>{summary.bestTheme.rankedMatches} {summary.bestTheme.rankedMatches === 1 ? 'partida Rankeada' : 'partidas Rankeadas'}</p></>}</article>
        <article className="profile-card">
          <span className="eyebrow">Média por categoria</span>
          {(summary?.categoryAverages ?? []).length === 0 ? <p>Jogue Rankeadas em mais de um tema da mesma categoria para ver sua média.</p> : (
            <ul className="category-average-list">
              {(summary?.categoryAverages ?? []).map((entry) => (
                <li key={entry.categoryId}>
                  <span>{entry.categoryName}</span>
                  <RankBadge knowledge={entry.average.rank.knowledge} />
                </li>
              ))}
            </ul>
          )}
        </article>
      </div>
      <section className="settings-card settings-card--feedback">
        <div><h2>Sons e vibração</h2><p>Pequenos toques de acerto, erro e vitória. Ficam salvos neste aparelho.</p></div>
        <div className="toggle-list">
          <button aria-checked={feedbackPreferences.sound} className="toggle" onClick={() => {
            setFeedbackPreference('sound', !feedbackPreferences.sound);
            if (!feedbackPreferences.sound) window.setTimeout(() => feedback('correct'), 0);
          }} role="switch" type="button"><Icon name="sound" /><span>Sons</span><i aria-hidden="true" /></button>
          <button aria-checked={feedbackPreferences.vibration} className="toggle" onClick={() => {
            setFeedbackPreference('vibration', !feedbackPreferences.vibration);
            if (!feedbackPreferences.vibration) window.setTimeout(() => feedback('tap'), 0);
          }} role="switch" type="button"><Icon name="vibrate" /><span>Vibração</span><i aria-hidden="true" /></button>
        </div>
      </section>
      <section className="settings-card"><div><h2>Aparência</h2><p>Vale só neste aparelho.</p></div><div className="segmented" role="radiogroup" aria-label="Aparência">{(['light', 'dark', 'system'] as ThemeMode[]).map((value) => <button aria-checked={mode === value} className={mode === value ? 'segmented__active' : ''} key={value} onClick={() => setMode(value)} role="radio" type="button">{{ light: 'Claro', dark: 'Escuro', system: 'Sistema' }[value]}</button>)}</div></section>
      <section className="settings-card">
        <div><h2>Notificações</h2><p>Pedidos de amizade e avisos que você escolher, neste aparelho.</p></div>
        {notificationState === 'denied' ? (
          <span className="settings-card__status">Notificações bloqueadas pelo navegador</span>
        ) : notificationState === 'unsupported' ? (
          <span className="settings-card__status">Notificações indisponíveis neste navegador</span>
        ) : notificationState === 'granted' ? (
          <div className="settings-card__stack">
            <span className="settings-card__status settings-card__status--enabled">Pedidos de amizade ativados</span>
            {pushConfigured && <FriendQueueAlertToggle getToken={getToken} />}
            {pushConfigured && <StreakReminderToggle getToken={getToken} initial={summary?.streakReminder ?? null} />}
          </div>
        ) : !pushConfigured || publicVapidKey() === '' ? (
          <span className="settings-card__status">Notificações ainda não configuradas</span>
        ) : (
          <Button disabled={notificationBusy} onClick={() => void activateNotifications()} variant="secondary">
            {notificationBusy ? 'Ativando...' : 'Ativar notificações'}
          </Button>
        )}
      </section>
      <section className="settings-card settings-card--privacy">
        <div><h2>Privacidade e Segurança</h2><p>Quem você bloqueou fica aqui.</p></div>
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
      <section className="settings-card"><div><h2>Créditos</h2><p>QUIZ GOMES foi criado por Gomes.</p></div></section>
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
