import * as React from 'react';

export interface TimerProps {
  readonly elapsedSeconds?: number;
  readonly startedAt?: string | number | Date;
  readonly targetSeconds?: number;
  readonly isRunning?: boolean;
  readonly size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';
  readonly className?: string;
}

export function formatElapsedSeconds(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  const mm = minutes.toString().padStart(2, '0');
  const ss = seconds.toString().padStart(2, '0');

  if (hours > 0) {
    const hh = hours.toString().padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}

export function Timer({
  elapsedSeconds: initialSeconds,
  startedAt,
  targetSeconds,
  isRunning = true,
  size = 'md',
  className,
}: TimerProps): React.JSX.Element {
  const [seconds, setSeconds] = React.useState<number>(() => {
    if (initialSeconds !== undefined) return initialSeconds;
    if (startedAt !== undefined) {
      const startMs = typeof startedAt === 'object' ? startedAt.getTime() : new Date(startedAt).getTime();
      return Math.max(0, Math.floor((Date.now() - startMs) / 1000));
    }
    return 0;
  });

  React.useEffect(() => {
    if (!isRunning) return;

    if (startedAt !== undefined) {
      const interval = setInterval(() => {
        const startMs = typeof startedAt === 'object' ? startedAt.getTime() : new Date(startedAt).getTime();
        setSeconds(Math.max(0, Math.floor((Date.now() - startMs) / 1000)));
      }, 1000);
      return () => clearInterval(interval);
    } else if (initialSeconds !== undefined) {
      const interval = setInterval(() => {
        setSeconds((s) => s + 1);
      }, 1000);
      return () => clearInterval(interval);
    }
    return undefined;
  }, [isRunning, startedAt, initialSeconds]);

  const formatted = formatElapsedSeconds(seconds);

  // KDS SLA state determination per VISUAL_SYSTEM.md Sec 2.3
  let stateClass = 'text-text';
  if (targetSeconds && targetSeconds > 0) {
    if (seconds >= targetSeconds) {
      // Late (> target)
      stateClass = 'text-danger-strong bg-danger-soft px-2 py-0.5 rounded border border-danger font-bold';
    } else if (seconds >= targetSeconds * 0.75) {
      // Nearing SLA (>= 75%)
      stateClass = 'text-warning-strong bg-warning-soft px-2 py-0.5 rounded border border-warning font-semibold';
    }
  }

  const sizeClasses: Record<string, string> = {
    sm: 'text-sm font-medium',
    md: 'text-md font-medium',
    lg: 'text-lg font-semibold',
    xl: 'text-xl font-bold',
    '2xl': 'text-2xl font-bold',
    '3xl': 'text-3xl font-extrabold',
  };

  return (
    <span
      role="timer"
      aria-label={`Tiempo transcurrido: ${formatted}`}
      className={`inline-flex items-center font-mono [font-variant-numeric:tabular-nums] select-none ${
        sizeClasses[size] ?? 'text-md'
      } ${stateClass} ${className ?? ''}`}
    >
      {formatted}
    </span>
  );
}
