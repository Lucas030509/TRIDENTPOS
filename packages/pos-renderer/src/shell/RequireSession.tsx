import * as React from 'react';
import { useSession } from '../context/SessionContext.js';
import { Skeleton } from '@trident/ui';

export interface RequireSessionProps {
  readonly children: React.ReactNode;
  readonly fallbackLogin: React.ReactNode;
}

export function RequireSession({
  children,
  fallbackLogin,
}: RequireSessionProps): React.JSX.Element {
  const { session, isAuthenticated, isLoading } = useSession();

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[300px] p-8 gap-4 w-full">
        <Skeleton width="200px" height="32px" />
        <Skeleton width="300px" height="48px" />
        <Skeleton width="180px" height="24px" />
      </div>
    );
  }

  if (!isAuthenticated || !session) {
    return <>{fallbackLogin}</>;
  }

  return <>{children}</>;
}
