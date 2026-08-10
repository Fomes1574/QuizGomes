import { Button } from './button.js';
import { Logo } from './logo.js';

export function MatchmakingDialog({ onCancel, onClose, status, themeName }: {
  onCancel: () => void;
  onClose: () => void;
  status: 'searching' | 'timed-out';
  themeName: string;
}) {
  return (
    <div className="dialog-backdrop">
      <section aria-live="polite" aria-modal="true" className="dialog dialog--matchmaking" role="dialog">
        <Logo compact />
        {status === 'searching' ? (
          <>
            <span className="matchmaking-radar"><span /><span /><i /></span>
            <span className="eyebrow">{themeName}</span>
            <h2>Procurando adversário</h2>
            <p>Buscando alguém nesta mesma dificuldade e modo.</p>
            <Button onClick={onCancel} variant="secondary">Cancelar</Button>
          </>
        ) : (
          <>
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
