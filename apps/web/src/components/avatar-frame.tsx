import type { ReactNode } from 'react';
import type { DuelSeat } from '../lib/match-handoff.js';

export function AvatarFrame({ children, flipId, frameId, variant = 'default' }: {
  children: ReactNode;
  /** Marca o retrato como âncora da continuidade visual entre telas da mesma partida. */
  flipId?: DuelSeat | undefined;
  frameId?: string | null | undefined;
  variant?: 'choice' | 'default' | 'result';
}) {
  return (
    <span
      className={`avatar-frame avatar-frame--${variant}${frameId === null || frameId === undefined ? '' : ' avatar-frame--equipped'}`}
      data-duel-flip={flipId ?? undefined}
      data-frame-id={frameId ?? undefined}
    >
      {children}
    </span>
  );
}
