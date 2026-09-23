import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './button.js';

/**
 * Confirmação genérica para ações administrativas destrutivas (revogar
 * ADMIN, desativar/rejeitar tema ou pergunta, aprovar lote grande). Mesmo
 * padrão acessível de `report-question-dialog.tsx`/`direct-challenge-waiting.tsx`:
 * `showModal`, foco inicial no botão de confirmação e devolução de foco ao
 * elemento que abriu o diálogo quando ele fecha.
 */
export function ConfirmDialog({
  body,
  busy = false,
  confirmLabel,
  onCancel,
  onConfirm,
  title,
}: {
  body: string;
  busy?: boolean;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

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
    dialog.querySelector<HTMLElement>('[data-confirm-action]')?.focus();
    return () => {
      try {
        if (dialog.open && typeof dialog.close === 'function') dialog.close();
        else dialog.removeAttribute('open');
      } catch {
        dialog.removeAttribute('open');
      }
      if (returnFocus?.isConnected) returnFocus.focus();
    };
  }, []);

  return createPortal(
    <dialog
      aria-labelledby="confirm-dialog-title"
      aria-modal="true"
      className="dialog-backdrop"
      onCancel={(event) => { event.preventDefault(); if (!busy) onCancel(); }}
      ref={dialogRef}
    >
      <section className="dialog">
        <h1 id="confirm-dialog-title">{title}</h1>
        <p>{body}</p>
        <div className="dialog__actions">
          <Button disabled={busy} onClick={onCancel} variant="ghost">Cancelar</Button>
          <Button className="button--danger" data-confirm-action disabled={busy} onClick={onConfirm}>
            {busy ? 'Aguarde…' : confirmLabel}
          </Button>
        </div>
      </section>
    </dialog>,
    document.body,
  );
}
