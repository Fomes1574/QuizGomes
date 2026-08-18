import { useEffect, useState } from 'react';

export type MatchConnectionScreenKind = 'local' | 'opponent';

export const LOCAL_CONNECTION_WAIT_COPY_MS = 3_000;

export interface AuthoritativePauseClock {
  graceRemainingMs: number;
  receivedAtMonotonicMs: number;
}

export function authoritativeGraceRemainingMs(
  clock: AuthoritativePauseClock,
  nowMonotonicMs: number,
): number {
  return Math.max(0, clock.graceRemainingMs - (nowMonotonicMs - clock.receivedAtMonotonicMs));
}

export function authoritativeGraceSeconds(
  clock: AuthoritativePauseClock,
  nowMonotonicMs: number,
): number {
  return Math.max(0, Math.min(7, Math.ceil(authoritativeGraceRemainingMs(clock, nowMonotonicMs) / 1_000)));
}

export function MatchConnectionScreen({
  authoritativePause,
  kind,
  leaving = false,
  localLossStartedAtMonotonicMs,
}: {
  authoritativePause?: AuthoritativePauseClock | undefined;
  kind: MatchConnectionScreenKind;
  leaving?: boolean;
  localLossStartedAtMonotonicMs?: number | undefined;
}) {
  const [nowMonotonicMs, setNowMonotonicMs] = useState(() => performance.now());

  useEffect(() => {
    let timer: number | null = null;
    const update = () => {
      const now = performance.now();
      setNowMonotonicMs(now);
      if (authoritativePause === undefined) {
        if (localLossStartedAtMonotonicMs === undefined) return;
        const untilWaitingCopy = LOCAL_CONNECTION_WAIT_COPY_MS - (now - localLossStartedAtMonotonicMs);
        if (untilWaitingCopy > 0) timer = window.setTimeout(update, untilWaitingCopy);
        return;
      }
      const remainingMs = authoritativeGraceRemainingMs(authoritativePause, now);
      if (remainingMs <= 0) return;
      const remainder = remainingMs % 1_000;
      timer = window.setTimeout(update, remainder < 1 ? 1_000 : remainder);
    };
    update();
    return () => {
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [authoritativePause, localLossStartedAtMonotonicMs]);

  const local = kind === 'local';
  const authoritative = authoritativePause !== undefined;
  const visualNowMonotonicMs = authoritativePause === undefined
    ? nowMonotonicMs
    : Math.max(nowMonotonicMs, authoritativePause.receivedAtMonotonicMs);
  const seconds = authoritativePause === undefined
    ? null
    : authoritativeGraceSeconds(authoritativePause, visualNowMonotonicMs);
  const waitingForConnection = !authoritative && localLossStartedAtMonotonicMs !== undefined &&
    visualNowMonotonicMs - localLossStartedAtMonotonicMs >= LOCAL_CONNECTION_WAIT_COPY_MS;
  const heading = local
    ? authoritative ? 'RECONECTANDO' : 'CONEXÃO PERDIDA'
    : 'AGUARDANDO JOGADOR';
  const description = seconds === 0
    ? 'Confirmando encerramento da partida...'
    : local
      ? waitingForConnection ? 'Aguardando conexão para verificar a partida...' : 'Tentando reconectar...'
      : 'A partida está pausada.';
  const headingId = local ? 'local-connection-lost-title' : 'opponent-connection-lost-title';
  return (
    <main
      aria-atomic="true"
      aria-labelledby={headingId}
      aria-live="assertive"
      className={`match-connection-screen${leaving ? ' match-connection-screen--leaving' : ''}`}
      data-connection-view={kind}
      data-pause-authority={authoritative ? 'server' : 'local'}
    >
      <div className="match-connection-card">
        <span aria-hidden="true" className="match-connection-card__signal" />
        <h1 id={headingId}>{heading}</h1>
        <p>{description}</p>
        {seconds !== null && seconds > 0 && (
          <strong
            aria-label={`${seconds} ${seconds === 1 ? 'segundo restante' : 'segundos restantes'}`}
            className="match-connection-countdown"
            role="timer"
          >
            {seconds}
          </strong>
        )}
      </div>
    </main>
  );
}
