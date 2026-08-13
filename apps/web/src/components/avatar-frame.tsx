import type { ReactNode } from 'react';

export function AvatarFrame({ children, frameId, variant = 'default' }: {
  children: ReactNode;
  frameId?: string | null | undefined;
  variant?: 'choice' | 'default' | 'result';
}) {
  return (
    <span
      className={`avatar-frame avatar-frame--${variant}${frameId === null || frameId === undefined ? '' : ' avatar-frame--equipped'}`}
      data-frame-id={frameId ?? undefined}
    >
      {children}
    </span>
  );
}
