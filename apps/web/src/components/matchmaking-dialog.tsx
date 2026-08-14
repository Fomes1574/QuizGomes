import {
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type SyntheticEvent,
} from 'react';
import { createPortal } from 'react-dom';
import type { ThemeSummary } from '../lib/models.js';
import type { MatchFoundOpponent } from '../lib/preloaded-match-room.js';
import type { MatchmakingStatus } from '../hooks/use-matchmaking.js';
import { Avatar } from './avatar.js';
import { AvatarFrame } from './avatar-frame.js';
import { Button } from './button.js';
import { MatchmakingGlobe } from './matchmaking-globe.js';
import { RankBadge } from './rank-badge.js';
import { ThemeArtwork } from './theme-artwork.js';

function searchTimer(seconds: number): string {
  return `00:${Math.max(0, Math.min(60, seconds)).toString().padStart(2, '0')} / 01:00`;
}

export function MatchmakingDialog({ elapsedSeconds, onCancel, onClose, opponent, preparing, status, theme }: {
  elapsedSeconds: number;
  onCancel: () => void;
  onClose: () => void;
  opponent: MatchFoundOpponent | null;
  preparing: boolean;
  status: Exclude<MatchmakingStatus, 'idle'>;
  theme: ThemeSummary;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const presenting = status === 'presenting-opponent' || status === 'leaving-opponent';
  const searchLeaving = presenting || status === 'cancelling' || status === 'timed-out';

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return undefined;
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const appShell = document.querySelector<HTMLElement>('.app-shell');
    const shellHadInert = appShell?.hasAttribute('inert') ?? false;
    const shellAriaHidden = appShell?.getAttribute('aria-hidden') ?? null;

    const focusInside = () => {
      const candidates = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])')];
      const target = candidates.find((candidate) => candidate.closest('[inert]') === null) ?? dialog;
      target.focus();
    };
    const blockOutsideInteraction = (event: Event) => {
      if (event.target instanceof Node && !dialog.contains(event.target)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    const retainModalFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialog.contains(event.target)) focusInside();
    };
    document.addEventListener('click', blockOutsideInteraction, true);
    document.addEventListener('focusin', retainModalFocus, true);

    try {
      if (!dialog.open && typeof dialog.showModal === 'function') dialog.showModal();
      else if (!dialog.open) dialog.setAttribute('open', '');
    } catch {
      dialog.setAttribute('open', '');
    }
    focusInside();
    appShell?.setAttribute('inert', '');
    appShell?.setAttribute('aria-hidden', 'true');

    return () => {
      document.removeEventListener('click', blockOutsideInteraction, true);
      document.removeEventListener('focusin', retainModalFocus, true);
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
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    const focusTarget = status === 'searching'
      ? dialog.querySelector<HTMLElement>('[data-matchmaking-focus="cancel"]')
      : status === 'timed-out'
        ? dialog.querySelector<HTMLElement>('[data-matchmaking-focus="close"]')
        : dialog;
    focusTarget?.focus();
  }, [status]);

  const handleEscape = (event: SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault();
    if (status === 'searching') onCancel();
    else if (status === 'timed-out') onClose();
  };

  const keepTabInside = (event: ReactKeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== 'Tab') return;
    const candidates = [...event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
    )].filter((candidate) => candidate.closest('[inert]') === null);
    if (candidates.length === 0) {
      event.preventDefault();
      event.currentTarget.focus();
      return;
    }
    const first = candidates[0];
    const last = candidates.at(-1);
    if (first === undefined || last === undefined) return;
    if (candidates.length === 1 || (event.shiftKey && document.activeElement === first) ||
      (!event.shiftKey && document.activeElement === last)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
  };

  const titleId = presenting
    ? 'matchmaking-found-title'
    : status === 'timed-out'
      ? 'matchmaking-timeout-title'
      : 'matchmaking-search-title';

  return createPortal(
    <dialog
      aria-labelledby={titleId}
      aria-modal="true"
      className={`dialog-backdrop matchmaking-modal${status === 'cancelling' ? ' dialog-backdrop--leaving' : ''}`}
      onCancel={handleEscape}
      onKeyDown={keepTabInside}
      ref={dialogRef}
      tabIndex={-1}
    >
      <section aria-live="polite" className="dialog dialog--matchmaking">
        <ThemeArtwork artwork={theme.artwork} className="matchmaking-theme-artwork" eager name={theme.name} />
        <div aria-hidden={searchLeaving || undefined} className={`matchmaking-search${searchLeaving ? ' matchmaking-search--leaving' : ''}`} inert={searchLeaving}>
          <MatchmakingGlobe />
          <span className="eyebrow">{theme.name}</span>
          <h2 id="matchmaking-search-title">PROCURANDO ADVERSÁRIO</h2>
          <strong aria-label={`${elapsedSeconds} segundos de 60`} className="matchmaking-clock" role="timer">{searchTimer(elapsedSeconds)}</strong>
          <Button data-matchmaking-focus="cancel" disabled={status !== 'searching'} onClick={onCancel}>Cancelar</Button>
        </div>

        {presenting && opponent !== null ? (
          <div className={`match-found${status === 'leaving-opponent' ? ' match-found--leaving' : ''}`}>
            <span className="eyebrow">JOGADOR ENCONTRADO</span>
            <AvatarFrame frameId={opponent.frameId} variant="result">
              <Avatar customUrl={opponent.customAvatarUrl} googleUrl={opponent.photoUrl} name={opponent.displayName} size="large" />
            </AvatarFrame>
            <h2 id="matchmaking-found-title">{opponent.displayName}</h2>
            <RankBadge knowledge={opponent.knowledge} />
            {preparing ? <small className="match-found__preparing">Preparando partida...</small> : null}
          </div>
        ) : null}

        {status === 'timed-out' ? (
          <div className="matchmaking-timeout">
            <span className="state-card__orb">…</span>
            <h2 id="matchmaking-timeout-title">Nenhum jogador neste tema no momento</h2>
            <p>A busca terminou após 60 segundos. Você pode tentar novamente quando quiser.</p>
            <Button data-matchmaking-focus="close" onClick={onClose}>Voltar ao tema</Button>
          </div>
        ) : null}
      </section>
    </dialog>,
    document.body,
  );
}
