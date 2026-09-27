import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { clearRematchInvite, currentRematchInvite, REMATCH_INVITE_EVENT, rematchNavigationState, type RematchInvite } from '../lib/rematch.js';
import { feedback } from '../lib/feedback.js';
import { Button } from './button.js';

/**
 * Convite de revanche quando a pessoa já saiu da tela de resultado (está em
 * Temas, Social ou Perfil). Some sozinho quando os 30 s do convite acabam.
 */
export function RematchToast() {
  const navigate = useNavigate();
  const [invite, setInvite] = useState<RematchInvite | null>(() => currentRematchInvite());

  useEffect(() => {
    const onInvite = (event: Event) => {
      setInvite((event as CustomEvent<RematchInvite>).detail);
      feedback('tap');
    };
    window.addEventListener(REMATCH_INVITE_EVENT, onInvite);
    return () => window.removeEventListener(REMATCH_INVITE_EVENT, onInvite);
  }, []);

  useEffect(() => {
    if (invite === null) return undefined;
    const timer = window.setTimeout(() => setInvite(null), Math.max(0, invite.expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [invite]);

  if (invite === null) return null;
  const dismiss = () => {
    clearRematchInvite(invite.matchId);
    setInvite(null);
  };
  return (
    <aside aria-live="polite" className="rematch-toast" role="status">
      <span aria-hidden="true" className="rematch-invite__icon">⚔</span>
      <p><strong>{invite.fromName}</strong> quer revanche{invite.themeName === '' ? '' : ` em ${invite.themeName}`}!</p>
      <div className="rematch-toast__actions">
        <Button onClick={() => {
          dismiss();
          void navigate(`/temas/${encodeURIComponent(invite.themeSlug)}`, { state: rematchNavigationState(invite) });
        }}>Aceitar</Button>
        <Button aria-label="Recusar revanche" onClick={dismiss} variant="ghost">Agora não</Button>
      </div>
    </aside>
  );
}
