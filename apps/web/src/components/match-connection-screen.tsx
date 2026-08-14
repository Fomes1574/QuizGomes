import { useEffect, useState } from 'react';

export type MatchConnectionScreenKind = 'local' | 'opponent';

export function connectionCountdownSeconds(deadlineMs: number, nowMs = Date.now()): number {
  return Math.max(0, Math.min(7, Math.ceil((deadlineMs - nowMs) / 1_000)));
}

export function MatchConnectionScreen({ deadlineMs, kind, leaving = false }: {
  deadlineMs: number;
  kind: MatchConnectionScreenKind;
  leaving?: boolean;
}) {
  const [seconds, setSeconds] = useState(() => connectionCountdownSeconds(deadlineMs));

  useEffect(() => {
    let timer: number | null = null;
    const update = () => {
      const next = connectionCountdownSeconds(deadlineMs);
      setSeconds((current) => current === next ? current : next);
      if (next <= 0) return;
      const remainingMs = Math.max(0, deadlineMs - Date.now());
      const remainder = remainingMs % 1_000;
      timer = window.setTimeout(update, remainder === 0 ? 1_000 : remainder);
    };
    update();
    return () => {
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [deadlineMs]);

  const local = kind === 'local';
  const headingId = local ? 'local-connection-lost-title' : 'opponent-connection-lost-title';
  return (
    <main
      aria-atomic="true"
      aria-labelledby={headingId}
      aria-live="assertive"
      className={`match-connection-screen${leaving ? ' match-connection-screen--leaving' : ''}`}
      data-connection-view={kind}
    >
      <div className="match-connection-card">
        <span aria-hidden="true" className="match-connection-card__signal"><i /><i /><i /></span>
        <h1 id={headingId}>{local ? 'CONEXÃO PERDIDA' : 'AGUARDANDO JOGADOR'}</h1>
        <p>{local ? 'Tentando reconectar...' : 'A partida está pausada.'}</p>
        <strong
          aria-label={`${seconds} ${seconds === 1 ? 'segundo restante' : 'segundos restantes'}`}
          className="match-connection-countdown"
          role="timer"
        >
          {seconds}
        </strong>
      </div>
    </main>
  );
}
