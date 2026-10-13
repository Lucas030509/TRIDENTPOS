import * as React from 'react';
import {
  getTridentBridge,
  StationProfile,
  StationMode,
  ConnectivityStatus,
  TridentApi,
} from '../bridge/trident-bridge.js';

export interface StationContextValue {
  readonly profile: StationProfile | null;
  readonly mode: StationMode;
  readonly connectivity: ConnectivityStatus;
  readonly isLoading: boolean;
  readonly refreshConnectivity: () => Promise<void>;
}

const defaultConnectivity: ConnectivityStatus = {
  edge: 'online',
  lan: 'online',
  cloud: 'online',
};

const StationContext = React.createContext<StationContextValue | null>(null);

export interface StationProviderProps {
  readonly children: React.ReactNode;
  readonly bridge?: TridentApi;
  readonly onReconnectResync?: () => void;
}

export function StationProvider({
  children,
  bridge: injectedBridge,
  onReconnectResync,
}: StationProviderProps): React.JSX.Element {
  const bridge = injectedBridge ?? getTridentBridge();
  const [profile, setProfile] = React.useState<StationProfile | null>(null);
  const [connectivity, setConnectivity] = React.useState<ConnectivityStatus>(defaultConnectivity);
  const [isLoading, setIsLoading] = React.useState(true);

  const prevEdgeRef = React.useRef(connectivity.edge);

  const refreshConnectivity = React.useCallback(async () => {
    try {
      const res = await bridge.station.getConnectivityStatus();
      if (res.ok) {
        setConnectivity(res.data);
        // ADR-005 Full resync on reconnect (when transitioning from offline -> online)
        if (prevEdgeRef.current === 'offline' && res.data.edge === 'online') {
          onReconnectResync?.();
        }
        prevEdgeRef.current = res.data.edge;
      }
    } catch {
      setConnectivity((prev) => ({ ...prev, edge: 'offline' }));
    }
  }, [bridge, onReconnectResync]);

  React.useEffect(() => {
    let mounted = true;
    Promise.all([bridge.station.getStationProfile(), bridge.station.getConnectivityStatus()])
      .then(([profRes, connRes]) => {
        if (!mounted) return;
        if (profRes.ok) setProfile(profRes.data);
        if (connRes.ok) {
          setConnectivity(connRes.data);
          prevEdgeRef.current = connRes.data.edge;
        }
      })
      .catch(() => {
        // Fallback default
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });

    // Heartbeat polling for connectivity (5s per ADR-005)
    const interval = setInterval(refreshConnectivity, 5000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [bridge, refreshConnectivity]);

  const value = React.useMemo<StationContextValue>(
    () => ({
      profile,
      mode: profile?.mode ?? 'POS',
      connectivity,
      isLoading,
      refreshConnectivity,
    }),
    [profile, connectivity, isLoading, refreshConnectivity],
  );

  return <StationContext.Provider value={value}>{children}</StationContext.Provider>;
}

export function useStation(): StationContextValue {
  const ctx = React.useContext(StationContext);
  if (!ctx) {
    throw new Error('useStation must be used within a StationProvider');
  }
  return ctx;
}
