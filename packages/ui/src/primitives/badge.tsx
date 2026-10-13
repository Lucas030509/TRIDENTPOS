import * as React from 'react';
import { SEMANTIC_STATES, SemanticStateKey } from '../tokens/tokens.js';

export interface BadgeProps {
  readonly state?: SemanticStateKey;
  readonly intent?: 'success' | 'warning' | 'danger' | 'info' | 'brand' | 'neutral';
  readonly label?: string;
  readonly children?: React.ReactNode;
  readonly size?: 'sm' | 'md' | 'lg';
  readonly showIcon?: boolean;
  readonly className?: string;
}

function renderStatusIcon(iconName: string): React.JSX.Element {
  switch (iconName) {
    case 'circle-check':
      return (
        <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      );
    case 'users':
      return (
        <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case 'receipt':
      return (
        <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
          <path d="M16 8h-8" />
          <path d="M16 12h-8" />
          <path d="M10 16H8" />
        </svg>
      );
    case 'lock':
      return (
        <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      );
    case 'clock':
      return (
        <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      );
    case 'alert-triangle':
      return (
        <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      );
    case 'alarm-clock':
      return (
        <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="13" r="8" />
          <path d="M12 9v4l2 2" />
          <path d="m5 3 2 2" />
          <path d="m19 3-2 2" />
        </svg>
      );
    case 'check':
    case 'check-circle':
      return (
        <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      );
    case 'refresh':
      return (
        <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
          <path d="M3 3v5h5" />
          <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
          <path d="M16 21h5v-5" />
        </svg>
      );
    case 'x-octagon':
    default:
      return (
        <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2" />
          <line x1="15" y1="9" x2="9" y2="15" />
          <line x1="9" y1="9" x2="15" y2="15" />
        </svg>
      );
  }
}

export function Badge({
  state,
  intent = 'neutral',
  label: explicitLabel,
  children,
  size = 'md',
  showIcon = true,
  className,
}: BadgeProps): React.JSX.Element {
  const semanticDef = state ? SEMANTIC_STATES[state] : undefined;
  const effectiveIntent = semanticDef ? semanticDef.baseIntent : intent;
  const displayText = explicitLabel ?? semanticDef?.label ?? children;

  const sizeClass =
    size === 'sm'
      ? 'text-xs px-2 py-0.5 gap-1 min-h-[24px]'
      : size === 'lg'
        ? 'text-md px-3.5 py-1.5 gap-2 min-h-[36px] font-semibold'
        : 'text-sm px-2.5 py-1 gap-1.5 min-h-[28px] font-medium'; // md

  // Strict opaque token pairs (bg: *-soft, text: *-strong) per VISUAL_SYSTEM.md
  let intentClass = '';
  switch (effectiveIntent) {
    case 'success':
      intentClass = 'bg-success-soft text-success-strong border border-success-strong/30';
      break;
    case 'warning':
      intentClass = 'bg-warning-soft text-warning-strong border border-warning-strong/30';
      break;
    case 'danger':
      intentClass = 'bg-danger-soft text-danger-strong border border-danger-strong/30';
      break;
    case 'info':
      intentClass = 'bg-info-soft text-info-strong border border-info-strong/30';
      break;
    case 'brand':
      intentClass = 'bg-brand-soft text-brand-strong border border-brand-strong/30';
      break;
    case 'neutral':
    default:
      intentClass = 'bg-surface-raised text-text-muted border border-border-control';
      break;
  }

  const iconElement =
    showIcon && semanticDef ? renderStatusIcon(semanticDef.iconName) : null;

  return (
    <span
      className={`inline-flex items-center rounded-full select-none ${sizeClass} ${intentClass} ${
        className ?? ''
      }`}
    >
      {iconElement}
      <span>{displayText}</span>
    </span>
  );
}

export const StatusChip = Badge;
