import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './button.js';

export function SocialConfirmDialog({
  actionLabel,
  description,
  onCancel,
  onConfirm,
  title,
}: {
  actionLabel: string;
  description: string;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
}) {
  const reference = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = reference.current;
    if (dialog === null) return undefined;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    dialog.querySelector<HTMLElement>('[data-social-dialog-cancel]')?.focus();
    return () => {
      if (dialog.open && typeof dialog.close === 'function') dialog.close();
      previousFocus?.focus();
    };
  }, []);

  return createPortal(
    <dialog
      aria-describedby="social-confirm-description"
      aria-labelledby="social-confirm-title"
      className="social-confirm-dialog"
      onCancel={(event) => { event.preventDefault(); onCancel(); }}
      ref={reference}
    >
      <h2 id="social-confirm-title">{title}</h2>
      <p id="social-confirm-description">{description}</p>
      <div className="social-confirm-dialog__actions">
        <Button data-social-dialog-cancel onClick={onCancel} variant="secondary">Cancelar</Button>
        <Button onClick={onConfirm}>{actionLabel}</Button>
      </div>
    </dialog>,
    document.body,
  );
}
