import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { apiRequest, websocketUrl } from '../lib/api.js';
import { listenForForegroundFriendRequests } from '../lib/social-notifications.js';
import { useAuth } from './auth-context.js';

interface SocialContextValue {
  onlineCount: number | null;
  pendingCount: number;
  pushConfigured: boolean;
  refresh: () => Promise<void>;
  revision: number;
}

export const SOCIAL_HEARTBEAT_INTERVAL_MS = 45_000;
export const SOCIAL_PONG_TIMEOUT_MS = 15_000;
const SOCIAL_RECONNECT_INITIAL_MS = 1_000;
const SOCIAL_RECONNECT_MAX_MS = 30_000;

const SocialContext = createContext<SocialContextValue | null>(null);

export function SocialProvider({ children }: { children: ReactNode }) {
  const { getToken, profile } = useAuth();
  const [pendingCount, setPendingCount] = useState(0);
  const [onlineCount, setOnlineCount] = useState<number | null>(null);
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
    if (profile === null) return undefined;
    let disposed = false;
    let socket: WebSocket | null = null;
    let retryTimer: number | null = null;
    let heartbeatTimer: number | null = null;
    let pongTimer: number | null = null;
    let nextRetryMs = SOCIAL_RECONNECT_INITIAL_MS;
    let connectedOnce = false;

    const clearTimers = () => {
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      if (heartbeatTimer !== null) window.clearInterval(heartbeatTimer);
      if (pongTimer !== null) window.clearTimeout(pongTimer);
      retryTimer = null;
      heartbeatTimer = null;
      pongTimer = null;
    };

    const scheduleReconnect = () => {
      if (disposed || retryTimer !== null) return;
      setOnlineCount(null);
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        void connect();
      }, nextRetryMs);
      nextRetryMs = Math.min(nextRetryMs * 2, SOCIAL_RECONNECT_MAX_MS);
    };

    const connect = async () => {
      if (disposed) return;
      try {
        const ticket = await apiRequest<{ ticket: string }>('/api/realtime/tickets', {
          body: { resource: 'social', scope: 'social' },
          getToken,
          method: 'POST',
        });
        if (disposed) return;
        const current = new WebSocket(websocketUrl(
          `/api/realtime/social?ticket=${encodeURIComponent(ticket.ticket)}`,
        ));
        socket = current;

        current.addEventListener('open', () => {
          if (disposed || socket !== current) return;
          if (connectedOnce) void refresh();
          connectedOnce = true;
          nextRetryMs = SOCIAL_RECONNECT_INITIAL_MS;
          heartbeatTimer = window.setInterval(() => {
            if (current.readyState !== WebSocket.OPEN) return;
            current.send('PING');
            pongTimer = window.setTimeout(() => {
              pongTimer = null;
              current.close(4_001, 'Canal social indisponível');
              scheduleReconnect();
            }, SOCIAL_PONG_TIMEOUT_MS);
          }, SOCIAL_HEARTBEAT_INTERVAL_MS);
        });

        current.addEventListener('message', (event) => {
          if (disposed || socket !== current) return;
          if (event.data === 'PONG') {
            if (pongTimer !== null) window.clearTimeout(pongTimer);
            pongTimer = null;
            return;
          }
          try {
            const message = JSON.parse(String(event.data)) as { count?: number; type?: string };
            if (message.type === 'ONLINE_COUNT' && typeof message.count === 'number') {
              setOnlineCount(message.count);
            } else if (message.type === 'SOCIAL_INVALIDATED') {
              void refresh();
            }
          } catch { /* Mensagens inválidas não afetam a interface social. */ }
        });

        current.addEventListener('close', () => {
          if (disposed || socket !== current) return;
          socket = null;
          if (heartbeatTimer !== null) window.clearInterval(heartbeatTimer);
          if (pongTimer !== null) window.clearTimeout(pongTimer);
          heartbeatTimer = null;
          pongTimer = null;
          scheduleReconnect();
        });
        current.addEventListener('error', () => {
          if (!disposed && socket === current) current.close();
        });
      } catch {
        scheduleReconnect();
      }
    };

    const recover = () => {
      if (disposed || socket !== null) return;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      retryTimer = null;
      void connect();
    };
    window.addEventListener('online', recover);
    void connect();
    return () => {
      disposed = true;
      window.removeEventListener('online', recover);
      clearTimers();
      socket?.close(1_000, 'Sessão social encerrada');
    };
  }, [getToken, profile, refresh]);

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
    onlineCount: profile === null ? null : onlineCount,
    pendingCount: profile === null ? 0 : pendingCount,
    pushConfigured,
    refresh,
    revision,
  }), [onlineCount, pendingCount, profile, pushConfigured, refresh, revision]);

  return <SocialContext value={value}>{children}</SocialContext>;
}

export function useSocial(): SocialContextValue {
  const context = useContext(SocialContext);
  if (context === null) throw new Error('useSocial precisa de SocialProvider.');
  return context;
}
