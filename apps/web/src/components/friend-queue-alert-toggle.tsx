import { useEffect, useState } from 'react';
import { apiRequest } from '../lib/api.js';
import { Icon } from './icons.js';

type GetToken = (forceRefresh?: boolean) => Promise<string | null>;

/**
 * Opcional e desligado por padrão: "seu amigo está na fila de X agora". O
 * servidor limita a no máximo um aviso desses por hora e respeita amigos
 * silenciados.
 */
export function FriendQueueAlertToggle({ getToken }: { getToken: GetToken }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void apiRequest<{ enabled: boolean }>('/api/social/push/queue-alerts', { getToken })
      .then((result) => { if (!cancelled) setEnabled(result.enabled); })
      .catch(() => { if (!cancelled) setEnabled(false); });
    return () => { cancelled = true; };
  }, [getToken]);

  async function toggle() {
    if (enabled === null) return;
    const next = !enabled;
    setBusy(true);
    setError(null);
    setEnabled(next);
    try {
      await apiRequest('/api/social/push/queue-alerts', { body: { enabled: next }, getToken, method: 'PUT' });
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
      ><Icon name="bolt" /><span>Avisar quando um amigo entrar na fila</span><i aria-hidden="true" /></button>
      <small>No máximo um aviso por hora. Amigos silenciados não avisam.</small>
      {error !== null && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}
