import { Button } from './button.js';
import type { ThemeSummary } from '../lib/models.js';
import { ThemeArtwork } from './theme-artwork.js';

export function MatchmakingDialog({ onCancel, onClose, status, theme }: {
  onCancel: () => void;
  onClose: () => void;
  status: 'searching' | 'timed-out';
  theme: ThemeSummary;
}) {
  return (
    <div className="dialog-backdrop">
      <section aria-live="polite" aria-modal="true" className="dialog dialog--matchmaking" role="dialog">
        {status === 'searching' ? (
          <>
            <ThemeArtwork artwork={theme.artwork} className="matchmaking-theme-artwork" eager name={theme.name} />
            <span className="matchmaking-radar"><span /><span /><i /></span>
            <span className="eyebrow">{theme.name}</span>
            <h2>Procurando adversário</h2>
            <p>Buscando alguém nesta mesma dificuldade e modo.</p>
            <Button onClick={onCancel} variant="secondary">Cancelar</Button>
          </>
        ) : (
          <>
            <ThemeArtwork artwork={theme.artwork} className="matchmaking-theme-artwork" eager name={theme.name} />
            <span className="state-card__orb">…</span>
            <h2>Nenhum jogador neste tema no momento</h2>
            <p>A busca terminou após 60 segundos. Você pode tentar novamente quando quiser.</p>
            <Button onClick={onClose}>Voltar ao tema</Button>
          </>
        )}
      </section>
    </div>
  );
}
