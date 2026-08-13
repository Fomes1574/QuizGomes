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
  const presenting = status === 'presenting-opponent' || status === 'leaving-opponent';
  const searchLeaving = presenting || status === 'cancelling' || status === 'timed-out';
  return (
    <div className={`dialog-backdrop${status === 'cancelling' ? ' dialog-backdrop--leaving' : ''}`}>
      <section aria-live="polite" aria-modal="true" className="dialog dialog--matchmaking" role="dialog">
        <ThemeArtwork artwork={theme.artwork} className="matchmaking-theme-artwork" eager name={theme.name} />
        <div aria-hidden={searchLeaving || undefined} className={`matchmaking-search${searchLeaving ? ' matchmaking-search--leaving' : ''}`}>
          <MatchmakingGlobe />
          <span className="eyebrow">{theme.name}</span>
          <h2>PROCURANDO ADVERSÁRIO</h2>
          <strong aria-label={`${elapsedSeconds} segundos de 60`} className="matchmaking-clock" role="timer">{searchTimer(elapsedSeconds)}</strong>
          <Button disabled={status === 'cancelling'} onClick={onCancel}>Cancelar</Button>
        </div>

        {presenting && opponent !== null ? (
          <div className={`match-found${status === 'leaving-opponent' ? ' match-found--leaving' : ''}`}>
            <span className="eyebrow">JOGADOR ENCONTRADO</span>
            <AvatarFrame frameId={opponent.frameId} variant="result">
              <Avatar customUrl={opponent.customAvatarUrl} googleUrl={opponent.photoUrl} name={opponent.displayName} size="large" />
            </AvatarFrame>
            <h2>{opponent.displayName}</h2>
            <RankBadge knowledge={opponent.knowledge} />
            {preparing ? <small className="match-found__preparing">Preparando partida...</small> : null}
          </div>
        ) : null}

        {status === 'timed-out' ? (
          <div className="matchmaking-timeout">
            <span className="state-card__orb">…</span>
            <h2>Nenhum jogador neste tema no momento</h2>
            <p>A busca terminou após 60 segundos. Você pode tentar novamente quando quiser.</p>
            <Button onClick={onClose}>Voltar ao tema</Button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
