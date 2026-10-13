import * as React from 'react';
import { useStation } from './context/StationContext.js';
import { AppShell } from './shell/AppShell.js';
import { RequireSession } from './shell/RequireSession.js';
import { StationGuard } from './shell/StationGuard.js';
import { ErrorBoundary } from './shell/ErrorBoundary.js';
import { LoginRoute } from './routes/LoginRoute.js';
import { SalonRoute } from './routes/SalonRoute.js';
import { KdsRoute } from './routes/KdsRoute.js';
import { CajaRoute } from './routes/CajaRoute.js';
import { DiagnosticsRoute } from './routes/DiagnosticsRoute.js';

export function getInitialRouteFromHash(): string {
  if (typeof window !== 'undefined' && window.location?.hash) {
    const raw = window.location.hash.replace(/^#\/?/, '/');
    return raw.length > 0 ? raw : '/';
  }
  return '/';
}

export interface PosRouterProps {
  readonly initialPath?: string;
}

export function PosRouter({ initialPath }: PosRouterProps): React.JSX.Element {
  const [currentPath, setCurrentPath] = React.useState<string>(
    () => initialPath ?? getInitialRouteFromHash(),
  );
  const { mode } = useStation();

  // Listen to hash changes in browser / Electron
  React.useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleHashChange = () => {
      setCurrentPath(getInitialRouteFromHash());
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const navigate = React.useCallback((path: string) => {
    if (typeof window !== 'undefined' && window.location) {
      window.location.hash = path;
    }
    setCurrentPath(path);
  }, []);

  // Root redirect per station profile (Decision FE-03)
  const resolvedPath = React.useMemo(() => {
    if (currentPath === '/' || currentPath === '') {
      switch (mode) {
        case 'KDS':
          return '/kds/cocina-1';
        case 'CAJA':
          return '/caja';
        case 'POS':
        case 'POS+CAJA':
        default:
          return '/salon';
      }
    }
    return currentPath;
  }, [currentPath, mode]);

  // Route renderer mapping
  const renderRouteContent = () => {
    if (resolvedPath === '/login') {
      return (
        <LoginRoute
          onLoginSuccess={() => {
            navigate('/');
          }}
        />
      );
    }

    if (resolvedPath === '/sistema') {
      return <DiagnosticsRoute />;
    }

    // Protected Routes requiring Session
    const protectedContent = (() => {
      if (resolvedPath.startsWith('/salon')) {
        return (
          <StationGuard requiredModes={['POS']}>
            <SalonRoute />
          </StationGuard>
        );
      }

      if (resolvedPath.startsWith('/kds')) {
        const parts = resolvedPath.split('/');
        const estacionId = parts[2] || 'cocina-1';
        return (
          <StationGuard requiredModes={['KDS']}>
            <KdsRoute estacionId={estacionId} />
          </StationGuard>
        );
      }

      if (resolvedPath.startsWith('/caja')) {
        return (
          <StationGuard requiredModes={['CAJA']}>
            <CajaRoute />
          </StationGuard>
        );
      }

      // Default fallback
      return (
        <StationGuard requiredModes={['POS']}>
          <SalonRoute />
        </StationGuard>
      );
    })();

    return (
      <RequireSession fallbackLogin={<LoginRoute onLoginSuccess={() => navigate('/')} />}>
        {protectedContent}
      </RequireSession>
    );
  };

  return (
    <ErrorBoundary>
      <AppShell onOpenDiagnostics={() => navigate('/sistema')}>{renderRouteContent()}</AppShell>
    </ErrorBoundary>
  );
}
