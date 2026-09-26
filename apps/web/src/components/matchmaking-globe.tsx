import type { CSSProperties } from 'react';
import type { ThemeSummary } from '../lib/models.js';
import { ThemeArtwork } from './theme-artwork.js';

interface SeatStyle extends CSSProperties {
  '--seat-angle': string;
  '--seat-delay': string;
}

/** Posições das cartas-silhueta em volta do tema: ângulo (graus) e atraso da piscada. */
const SEATS = [
  { angle: -58, delay: 0 },
  { angle: 18, delay: 900 },
  { angle: 96, delay: 1_800 },
  { angle: 162, delay: 450 },
  { angle: 232, delay: 1_350 },
] as const;

/**
 * Radar da busca: a carta do tema no centro, ondas saindo dela e cartas de
 * jogador em volta sendo "escaneadas" pelo feixe. Quando há mais gente na
 * mesma fila, uma das cartas acende, porque o par está a caminho.
 * Puramente decorativo (aria-hidden); a informação real está no texto.
 */
export function MatchmakingRadar({ others, theme }: { others: number; theme: ThemeSummary }) {
  return (
    <div aria-hidden="true" className={`matchmaking-radar${others > 0 ? ' matchmaking-radar--warm' : ''}`}>
      <span className="matchmaking-radar__sweep" />
      <span className="matchmaking-radar__wave" />
      <span className="matchmaking-radar__wave matchmaking-radar__wave--two" />
      <span className="matchmaking-radar__wave matchmaking-radar__wave--three" />
      <span className="matchmaking-radar__orbit" />
      {SEATS.map((seat, index) => (
        <span
          className={`matchmaking-radar__seat${others > 0 && index === 1 ? ' matchmaking-radar__seat--lit' : ''}`}
          key={seat.angle}
          style={{ '--seat-angle': `${seat.angle}deg`, '--seat-delay': `${seat.delay}ms` } as SeatStyle}
        >
          <svg viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="4" /><path d="M4.5 21c.8-4.6 3.8-7 7.5-7s6.7 2.4 7.5 7" /></svg>
        </span>
      ))}
      <span className="matchmaking-radar__card">
        <ThemeArtwork artwork={theme.artwork} eager name={theme.name} />
      </span>
    </div>
  );
}
