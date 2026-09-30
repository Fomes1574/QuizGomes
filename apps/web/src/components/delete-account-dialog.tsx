import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './button.js';

const CONFIRMATION = 'EXCLUIR';

/**
 * Exclusão de conta: diz com clareza o que some e o que fica, e só libera o
 * botão depois de digitar EXCLUIR. Mesmo padrão acessível do ConfirmDialog.
 */
export function DeleteAccountDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => Promise<void> }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    dialog.querySelector<HTMLElement>('input')?.focus();
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

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Não foi possível excluir a conta agora.');
      setBusy(false);
    }
  }

  return createPortal(
    <dialog
      aria-labelledby="delete-account-title"
      aria-modal="true"
      className="dialog-backdrop"
      onCancel={(event) => { event.preventDefault(); if (!busy) onCancel(); }}
      ref={dialogRef}
    >
      <section className="dialog delete-account-dialog">
        <h1 id="delete-account-title">Excluir sua conta?</h1>
        <p>Isto não pode ser desfeito. Somem seu nome, foto, código, amigos, pedidos, bloqueios, notificações e sua posição nos rankings.</p>
        <p>As partidas que você já jogou continuam no histórico de quem jogou contra você, como “Jogador removido”. Se entrar de novo com o mesmo Google, começa uma conta nova, do zero.</p>
        <label className="field">
          <span>Digite {CONFIRMATION} para confirmar</span>
          <input autoCapitalize="characters" autoComplete="off" disabled={busy} onChange={(event) => setTyped(event.target.value)} spellCheck={false} value={typed} />
        </label>
        {error !== null ? <p className="form-message form-message--error" role="alert">{error}</p> : null}
        <div className="dialog__actions">
          <Button disabled={busy} onClick={onCancel} variant="ghost">Cancelar</Button>
          <Button className="button--danger" disabled={busy || typed.trim().toUpperCase() !== CONFIRMATION} onClick={() => void confirm()}>
            {busy ? 'Excluindo…' : 'Excluir conta'}
          </Button>
        </div>
      </section>
    </dialog>,
    document.body,
  );
}
