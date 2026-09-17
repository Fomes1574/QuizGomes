import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useChallenges } from '../features/challenge-context.js';
import { Button } from './button.js';

const ENDED_FEEDBACK_MS = 4_000;
const ENDED_MESSAGE: Record<'EXPIRED' | 'UNAVAILABLE', string> = {
  EXPIRED: 'O convite venceu antes de uma resposta.',
  UNAVAILABLE: 'Este convite não está mais disponível.',
};

/**
 * Espera bloqueante do convite direto.
 *
 * Enquanto o convite estiver pendente o app inteiro fica inerte: se o desafiante
 * navegasse livremente, o aceite do outro lado chegaria sem ninguém para entrar na
 * sala e a partida terminaria anulada. A contagem deriva do prazo autoritativo do
 * servidor; o cliente nunca declara a expiração.
 *
 * Quando o convite termina sem virar sala, a mesma janela mostra por alguns
 * segundos o porquê em vez de simplesmente desaparecer em silêncio.
 */
export function DirectChallengeWaiting() {
  const { cancelPending, dismissEndedChallenge, endedChallenge, pendingDirect, secondsLeft } = useChallenges();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const active = pendingDirect !== null;

  useEffect(() => {
    if (endedChallenge === null) return undefined;
    const timer = window.setTimeout(dismissEndedChallenge, ENDED_FEEDBACK_MS);
    return () => window.clearTimeout(timer);
  }, [dismissEndedChallenge, endedChallenge]);

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

  if (pendingDirect === null) {
    if (endedChallenge === null) return null;
    // Sem sala para esperar: um aviso breve e não bloqueante, não um modal inerte.
    return createPortal(
      <div aria-live="polite" className="challenge-ended-toast" role="status">
        <span>{ENDED_MESSAGE[endedChallenge.reason]}</span>
        <button aria-label="Dispensar aviso" onClick={dismissEndedChallenge} type="button">×</button>
      </div>,
      document.body,
    );
  }

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
