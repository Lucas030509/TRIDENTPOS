import * as React from 'react';

export interface SkeletonProps {
  readonly className?: string;
  readonly width?: string;
  readonly height?: string;
  readonly rounded?: 'sm' | 'md' | 'lg' | 'full';
}

export function Skeleton({
  className,
  width,
  height,
  rounded = 'md',
}: SkeletonProps): React.JSX.Element {
  const roundedClass =
    rounded === 'full'
      ? 'rounded-full'
      : rounded === 'lg'
        ? 'rounded-lg'
        : rounded === 'sm'
          ? 'rounded-sm'
          : 'rounded-md';

  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Cargando contenido..."
      style={{ width, height }}
      className={`animate-pulse bg-surface-raised border border-border/50 ${roundedClass} ${
        className ?? ''
      }`}
    />
  );
}
