import { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useFriendPresence } from '../features/social-context.js';
import type { FriendPresence, SocialFriend } from '../lib/social.js';
import { Avatar } from './avatar.js';
import { AvatarFrame } from './avatar-frame.js';
import { Button } from './button.js';

const PRESENCE_LABEL: Record<FriendPresence, string> = {
  IN_MATCH: 'Em partida',
  MATCHMAKING: 'Procurando partida',
  OFFLINE: 'Offline',
  ONLINE: 'Online',
  RECONNECTING: 'Reconectando',
};

/** Disponíveis primeiro, ocupados depois, offline por último. */
const PRESENCE_ORDER: Record<FriendPresence, number> = {
  IN_MATCH: 2,
  MATCHMAKING: 1,
  OFFLINE: 4,
  ONLINE: 0,
  RECONNECTING: 3,
};

export function FriendChallengeDialog({
  busy,
  friends,
  onAsync,
  onClose,
  onDirect,
  themeName,
}: {
  busy: boolean;
  friends: SocialFriend[];
  onAsync: (friend: SocialFriend) => void;
  onClose: () => void;
  onDirect: (friend: SocialFriend) => void;
  themeName: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const presence = useFriendPresence();

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
    dialog.querySelector<HTMLElement>('button')?.focus();
    return () => {
      try {
        if (dialog.open && typeof dialog.close === 'function') dialog.close();
      } catch {
        dialog.removeAttribute('open');
      }
      if (returnFocus?.isConnected) returnFocus.focus();
    };
  }, []);

  const ordered = useMemo(() => [...friends]
    .map((friend) => ({
      friend,
      presence: presence.get(friend.publicId)?.presence ?? 'OFFLINE',
    }))
    .sort((first, second) => PRESENCE_ORDER[first.presence] - PRESENCE_ORDER[second.presence] ||
      first.friend.displayName.localeCompare(second.friend.displayName, 'pt-BR', { sensitivity: 'base' })),
  [friends, presence]);

  return createPortal(
    <dialog
      aria-labelledby="friend-challenge-title"
      aria-modal="true"
      className="dialog-backdrop"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      ref={dialogRef}
    >
      <section className="dialog dialog--challenge">
        <div className="dialog__intro">
          <h1 id="friend-challenge-title">Desafiar amigo</h1>
          <p>{themeName} · desafios entre amigos são sempre Casual, com 7 perguntas, e não alteram seu Conhecimento.</p>
        </div>

        {ordered.length === 0 ? (
          <p className="challenge-empty">Você ainda não tem amigos para desafiar. Adicione alguém no Social.</p>
        ) : (
          <ul className="challenge-friends">
            {ordered.map(({ friend, presence: friendPresence }) => {
              const available = friendPresence === 'ONLINE';
              return (
                <li className="challenge-friend" data-presence={friendPresence} key={friend.publicId}>
                  <AvatarFrame frameId={friend.frameId}>
                    <Avatar
                      customUrl={friend.customAvatarUrl}
                      googleUrl={friend.photoUrl}
                      name={friend.displayName}
                      size="small"
                    />
                  </AvatarFrame>
                  <span className="challenge-friend__identity">
                    <strong>{friend.displayName}</strong>
                    <small><i aria-hidden="true" data-presence={friendPresence} />{PRESENCE_LABEL[friendPresence]}</small>
                  </span>
                  <span className="challenge-friend__actions">
                    <button
                      className="challenge-friend__action"
                      disabled={busy || !available}
                      onClick={() => onDirect(friend)}
                      title={available ? undefined : 'Este amigo não está disponível agora.'}
                      type="button"
                    >Agora</button>
                    {/* "Depois" vale para qualquer presença: quem desafia joga a metade dele na hora. */}
                    <button
                      className="challenge-friend__action challenge-friend__action--quiet"
                      disabled={busy}
                      onClick={() => onAsync(friend)}
                      type="button"
                    >Depois</button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        <div className="dialog__actions">
          <Button onClick={onClose} variant="ghost">Fechar</Button>
        </div>
      </section>
    </dialog>,
    document.body,
  );
}
