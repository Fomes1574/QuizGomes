import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { safeAppUpdate } from '../lib/app-update.js';

/** Aplica uma atualização já preparada assim que a navegação estiver segura. */
export function AppUpdateController(): null {
  const location = useLocation();

  useEffect(() => {
    safeAppUpdate.onRoute(location.pathname, () => window.location.reload());
  }, [location.pathname]);

  return null;
}
