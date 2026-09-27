import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../features/auth-context.js';
import { presentAchievement, type AchievementItem } from '../lib/achievements.js';
import { apiRequest } from '../lib/api.js';
import { feedback } from '../lib/feedback.js';
import { Avatar } from './avatar.js';
import { AvatarFrame } from './avatar-frame.js';
import { Button } from './button.js';
import { ShareCardButton } from './share-result-button.js';

/** Evento que qualquer tela pode disparar para conferir conquistas novas. */
export const CELEBRATIONS_CHECK_EVENT = 'qg:celebrations-check';
const RECHECK_INTERVAL_MS = 60_000;

/**
 * Cartões de parabéns. Montado no shell do app (fora da partida): ao abrir o
 * app, ao voltar de uma partida e quando outra tela pede, busca conquistas
 * ainda não vistas e mostra uma por vez. "Continuar" marca como vista; nada
 * aparece duas vezes.
 */
export function CelebrationHost() {
  const { getToken, profile, retryProfile } = useAuth();
  const [queue, setQueue] = useState<AchievementItem[]>([]);
  const lastCheck = useRef(0);
  const userId = profile?.userId ?? null;

  useEffect(() => {
    if (userId === null) return undefined;
    let cancelled = false;
    const check = (force: boolean) => {
      const now = Date.now();
      if (!force && now - lastCheck.current < RECHECK_INTERVAL_MS) return;
      lastCheck.current = now;
      void apiRequest<{ celebrations: AchievementItem[] }>('/api/profile/celebrations', { getToken })
        .then((result) => {
          if (cancelled || result.celebrations.length === 0) return;
          setQueue((current) => {
            const known = new Set(current.map((item) => item.achievementId));
            return [...current, ...result.celebrations.filter((item) => !known.has(item.achievementId))];
          });
        })
        .catch(() => undefined);
    };
    check(true);
    const onRequest = () => check(true);
    const onVisible = () => { if (document.visibilityState === 'visible') check(false); };
    window.addEventListener(CELEBRATIONS_CHECK_EVENT, onRequest);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.removeEventListener(CELEBRATIONS_CHECK_EVENT, onRequest);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [getToken, userId]);

  const current = queue[0];
  if (current === undefined || profile === null) return null;

  const dismiss = () => {
    const seen = current.achievementId;
    setQueue((items) => items.slice(1));
    void apiRequest('/api/profile/celebrations', { body: { achievementIds: [seen] }, getToken, method: 'POST' }).catch(() => undefined);
  };

  return createPortal(
    <CelebrationCard
      achievement={current}
      equipped={profile.equippedFrameId === current.frameId}
      key={current.achievementId}
      onDismiss={dismiss}
      onEquip={async (frameId) => {
        await apiRequest('/api/profile/frame', { body: { frameId }, getToken, method: 'PUT' });
        await retryProfile();
      }}
      profile={profile}
      remaining={queue.length - 1}
    />,
    document.body,
  );
}

export function CelebrationCard({
  achievement,
  equipped,
  onDismiss,
  onEquip,
  profile,
  remaining,
}: {
  achievement: AchievementItem;
  equipped: boolean;
  onDismiss: () => void;
  onEquip: (frameId: string) => Promise<void>;
  profile: { customAvatarUrl: string | null; displayName: string; photoUrl: string | null };
  remaining: number;
}) {
  const view = presentAchievement(achievement);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [equipState, setEquipState] = useState<'done' | 'error' | 'idle' | 'saving'>(equipped ? 'done' : 'idle');

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return undefined;
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    try {
      if (!dialog.open && typeof dialog.showModal === 'function') dialog.showModal();
      else if (!dialog.open) dialog.setAttribute('open', '');
    } catch {
      dialog.setAttribute('open', '');
    }
    dialog.querySelector<HTMLElement>('[data-celebration-primary]')?.focus();
    feedback('win');
    return () => {
      try { if (dialog.open) dialog.close(); } catch { /* Já fechado. */ }
      returnFocus?.focus();
    };
  }, []);

  async function equip() {
    if (achievement.frameId === null) return;
    setEquipState('saving');
    try {
      await onEquip(achievement.frameId);
      setEquipState('done');
    } catch {
      setEquipState('error');
    }
  }

  return (
    <dialog
      aria-labelledby="celebration-title"
      className={`celebration celebration--${view.tier}`}
      onCancel={(event) => { event.preventDefault(); onDismiss(); }}
      ref={dialogRef}
    >
      <div className="celebration__card" style={{ '--sparkles': view.tier === 'legend' || view.tier === 'year' ? 18 : 10 } as CSSProperties}>
        <span aria-hidden="true" className="celebration__rays" />
        <span aria-hidden="true" className="celebration__sparkles">
          {Array.from({ length: 12 }, (_, index) => <i key={index} style={{ '--i': index } as CSSProperties} />)}
        </span>
        <p className="celebration__kicker">Conquista desbloqueada</p>
        <div aria-hidden="true" className="celebration__big">
          <strong>{view.big}</strong>
          {view.bigCaption !== '' && <span>{view.bigCaption}</span>}
        </div>
        <h2 id="celebration-title">{view.title}</h2>
        <p className="celebration__description">{view.description}</p>
        {achievement.frameId !== null && (
          <div className="celebration__frame">
            <AvatarFrame frameId={achievement.frameId} variant="result">
              <Avatar customUrl={profile.customAvatarUrl} googleUrl={profile.photoUrl} name={profile.displayName} size="large" />
            </AvatarFrame>
            <span>Nova moldura</span>
          </div>
        )}
        <div className="celebration__actions">
          {achievement.frameId !== null && equipState !== 'done' && (
            <Button data-celebration-primary disabled={equipState === 'saving'} onClick={() => void equip()}>
              {equipState === 'saving' ? 'Colocando…' : equipState === 'error' ? 'Tentar de novo' : 'Usar moldura'}
            </Button>
          )}
          <ShareCardButton
            card={{
              input: {
                big: view.big, bigCaption: view.bigCaption, description: view.description,
                name: profile.displayName, tier: view.tier, title: view.title,
              },
              kind: 'milestone',
            }}
            label="Compartilhar"
            message={{ text: `${view.title} no QUIZ GOMES! Consegue chegar aqui?`, url: window.location.origin }}
          />
          <Button
            {...(achievement.frameId === null || equipState === 'done' ? { 'data-celebration-primary': true } : {})}
            onClick={onDismiss}
            variant="ghost"
          >
            {remaining > 0 ? `Continuar (+${remaining})` : 'Continuar'}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
