import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useChallenges } from '../features/challenge-context.js';
import { Button } from './button.js';

/**
 * Espera bloqueante do convite direto.
 *
 * Enquanto o convite estiver pendente o app inteiro fica inerte: se o desafiante
 * navegasse livremente, o aceite do outro lado chegaria sem ninguém para entrar na
 * sala e a partida terminaria anulada. A contagem deriva do prazo autoritativo do
 * servidor; o cliente nunca declara a expiração.
 */
export function DirectChallengeWaiting() {
  const { cancelPending, pendingDirect, secondsLeft } = useChallenges();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const active = pendingDirect !== null;

  useEffect(() => {
    if (!active) return undefined;
    const dialog = dialogRef.current;
    if (dialog === null) return undefined;
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const appShell = document.querySelector<HTMLElement>('.app-shell');
    const shellHadInert = appShell?.hasAttribute('inert') ?? false;
    const shellAriaHidden = appShell?.getAttribute('aria-hidden') ?? null;

    try {
      if (!dialog.open && typeof dialog.showModal === 'function') dialog.showModal();
      else if (!dialog.open) dialog.setAttribute('open', '');
    } catch {
      dialog.setAttribute('open', '');
    }
    dialog.querySelector<HTMLElement>('button')?.focus();
    appShell?.setAttribute('inert', '');
    appShell?.setAttribute('aria-hidden', 'true');

    return () => {
      try {
        if (dialog.open && typeof dialog.close === 'function') dialog.close();
        else dialog.removeAttribute('open');
      } catch {
        dialog.removeAttribute('open');
      }
      if (appShell !== null) {
        if (!shellHadInert) appShell.removeAttribute('inert');
        if (shellAriaHidden === null) appShell.removeAttribute('aria-hidden');
        else appShell.setAttribute('aria-hidden', shellAriaHidden);
      }
      if (returnFocus?.isConnected) returnFocus.focus();
    };
  }, [active]);

  if (pendingDirect === null) return null;

  return createPortal(
    <dialog
      aria-labelledby="direct-waiting-title"
      aria-modal="true"
      className="dialog-backdrop"
      onCancel={(event) => { event.preventDefault(); void cancelPending(); }}
      ref={dialogRef}
    >
      <section aria-live="polite" className="dialog dialog--waiting">
        <span aria-hidden="true" className="spinner" />
        <div>
          <h1 id="direct-waiting-title">Aguardando {pendingDirect.displayName}</h1>
          <p>O convite vale por pouco tempo. Fique aqui para entrar na partida assim que houver resposta.</p>
        </div>
        <strong aria-label={`${secondsLeft} segundos restantes`} className="dialog--waiting__clock" role="timer">
          {secondsLeft}s
        </strong>
        <div className="dialog__actions">
          <Button onClick={() => void cancelPending()} variant="ghost">Cancelar convite</Button>
        </div>
      </section>
    </dialog>,
    document.body,
  );
}
