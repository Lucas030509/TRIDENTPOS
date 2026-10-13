import * as React from 'react';
import { getTridentBridge, SessionView, TridentApi } from '../bridge/trident-bridge.js';

export interface SessionContextValue {
  readonly session: SessionView | null;
  readonly isAuthenticated: boolean;
  readonly isLoading: boolean;
  readonly login: (
    userCode: string,
    pin: string,
  ) => Promise<{ readonly success: boolean; readonly error?: string }>;
  readonly logout: () => Promise<void>;
  readonly authorizeStepUp: (commandRef: string, pin: string) => Promise<boolean>;
  readonly hasPermission: (permission: string) => boolean;
}

const SessionContext = React.createContext<SessionContextValue | null>(null);

export interface SessionProviderProps {
  readonly children: React.ReactNode;
  readonly bridge?: TridentApi;
  readonly onSessionPurge?: () => void;
}

export function SessionProvider({
  children,
  bridge: injectedBridge,
  onSessionPurge,
}: SessionProviderProps): React.JSX.Element {
  const bridge = injectedBridge ?? getTridentBridge();
  const [session, setSession] = React.useState<SessionView | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);

  // Initial check on mount
  React.useEffect(() => {
    let mounted = true;
    bridge.session
      .getCurrentSession()
      .then((res) => {
        if (mounted && res.ok) {
          setSession(res.data);
        }
      })
      .catch(() => {
        if (mounted) setSession(null);
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [bridge]);

  const login = React.useCallback(
    async (userCode: string, pin: string) => {
      setIsLoading(true);
      try {
        const res = await bridge.session.login({ userCode, pin });
        if (res.ok) {
          setSession(res.data);
          return { success: true };
        }
        return { success: false, error: res.error.message };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      } finally {
        setIsLoading(false);
      }
    },
    [bridge],
  );

  const logout = React.useCallback(async () => {
    setIsLoading(true);
    try {
      await bridge.session.logout();
    } finally {
      setSession(null);
      setIsLoading(false);
      // Immediate query cache purge on operator switch/logout (ADV-01)
      onSessionPurge?.();
    }
  }, [bridge, onSessionPurge]);

  const authorizeStepUp = React.useCallback(
    async (commandRef: string, pin: string) => {
      try {
        const res = await bridge.session.authorize({ commandRef, pin });
        return res.ok && res.data.authorized;
      } catch {
        return false;
      }
    },
    [bridge],
  );

  const hasPermission = React.useCallback(
    (permission: string) => {
      if (!session) return false;
      return session.permissions.includes(permission);
    },
    [session],
  );

  const value = React.useMemo<SessionContextValue>(
    () => ({
      session,
      isAuthenticated: Boolean(session),
      isLoading,
      login,
      logout,
      authorizeStepUp,
      hasPermission,
    }),
    [session, isLoading, login, logout, authorizeStepUp, hasPermission],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = React.useContext(SessionContext);
  if (!ctx) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return ctx;
}
