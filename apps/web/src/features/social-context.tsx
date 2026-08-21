import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { apiRequest } from '../lib/api.js';
import { listenForForegroundFriendRequests } from '../lib/social-notifications.js';
import { useAuth } from './auth-context.js';

interface SocialContextValue {
  pendingCount: number;
  pushConfigured: boolean;
  refresh: () => Promise<void>;
  revision: number;
}

const SocialContext = createContext<SocialContextValue | null>(null);

export function SocialProvider({ children }: { children: ReactNode }) {
  const { getToken, profile } = useAuth();
  const [pendingCount, setPendingCount] = useState(0);
  const [pushConfigured, setPushConfigured] = useState(false);
  const [revision, setRevision] = useState(0);

  const refresh = useCallback(async () => {
    if (profile === null) return;
    try {
      const summary = await apiRequest<{ pendingCount: number; pushConfigured: boolean }>(
        '/api/social/summary',
        { getToken },
      );
      setPendingCount(summary.pendingCount);
      setPushConfigured(summary.pushConfigured);
      setRevision((current) => current + 1);
    } catch {
      // Social opcional não deve impedir o shell ou o gameplay aprovado.
    }
  }, [getToken, profile]);

  useEffect(() => {
    if (profile === null) return;
    queueMicrotask(() => { void refresh(); });
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    let unsubscribe: (() => void) | undefined;
    void listenForForegroundFriendRequests(onFocus, getToken)
      .then((listener) => { unsubscribe = listener; })
      .catch(() => undefined);
    return () => {
      window.removeEventListener('focus', onFocus);
      unsubscribe?.();
    };
  }, [getToken, profile, refresh]);

  const value = useMemo<SocialContextValue>(() => ({
    pendingCount: profile === null ? 0 : pendingCount,
    pushConfigured,
    refresh,
    revision,
  }), [pendingCount, profile, pushConfigured, refresh, revision]);

  return <SocialContext value={value}>{children}</SocialContext>;
}

export function useSocial(): SocialContextValue {
  const context = useContext(SocialContext);
  if (context === null) throw new Error('useSocial precisa de SocialProvider.');
  return context;
}
