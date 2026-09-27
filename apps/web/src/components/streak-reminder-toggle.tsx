import { useState } from 'react';
import { apiRequest } from '../lib/api.js';
import { Icon } from './icons.js';

type GetToken = (forceRefresh?: boolean) => Promise<string | null>;

/**
 * Opcional e desligado por padrão: às ~20h, "sua ofensiva acaba hoje" para
 * quem jogou ontem e ainda não hoje. No máximo um aviso por dia.
 */
export function StreakReminderToggle({ getToken, initial }: { getToken: GetToken; initial: boolean | null }) {
  const [enabled, setEnabled] = useState<boolean | null>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [synced, setSynced] = useState(initial);
  // O resumo do perfil chega depois: acompanha o valor do servidor até a pessoa mexer.
  if (initial !== synced) {
    setSynced(initial);
    setEnabled(initial);
  }

  async function toggle() {
    if (enabled === null) return;
    const next = !enabled;
    setBusy(true);
    setError(null);
    setEnabled(next);
    try {
      await apiRequest('/api/profile/streak-reminder', { body: { enabled: next }, getToken, method: 'PUT' });
    } catch {
      setEnabled(!next);
      setError('Não foi possível salvar. Tente de novo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="friend-queue-alert">
      <button
        aria-checked={enabled === true}
        className="toggle"
        disabled={enabled === null || busy}
        onClick={() => void toggle()}
        role="switch"
        type="button"
      ><Icon name="flame" /><span>Avisar quando minha ofensiva estiver para acabar</span><i aria-hidden="true" /></button>
      <small>Às 20h, só se você ainda não jogou no dia. No máximo um aviso por dia.</small>
      {error !== null && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}
