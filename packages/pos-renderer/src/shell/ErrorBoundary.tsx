import * as React from 'react';
import { Button } from '@trident/ui';
import { getTridentBridge } from '../bridge/trident-bridge.js';

export interface ErrorBoundaryProps {
  readonly children: React.ReactNode;
  readonly fallbackTitle?: string;
  readonly onReset?: () => void;
}

interface ErrorBoundaryState {
  readonly hasError: boolean;
  readonly error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // Sanitized reporting: message only, zero payloads or customer tokens
    const bridge = getTridentBridge();
    bridge.diagnostics
      .report({
        message: error.message || 'Render Error',
        context: errorInfo.componentStack?.slice(0, 300) ?? undefined,
      })
      .catch(() => {
        // fail-safe ignore
      });
  }

  private handleRetry = () => {
    this.props.onReset?.();
    this.setState({ hasError: false, error: null });
  };

  private handleReload = () => {
    if (typeof window !== 'undefined' && window.location) {
      window.location.reload();
    }
  };

  override render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          aria-live="assertive"
          className="flex-1 flex items-center justify-center p-8 bg-surface"
        >
          <div className="max-w-md w-full p-6 rounded-xl border-2 border-danger bg-danger-soft text-danger-strong flex flex-col items-center text-center gap-4 shadow-2">
            <svg
              className="w-12 h-12 stroke-current"
              viewBox="0 0 24 24"
              fill="none"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>

            <h2 className="text-xl font-bold text-danger-strong">
              {this.props.fallbackTitle ?? 'Error en la Terminal'}
            </h2>

            <p className="text-sm font-medium text-text">
              {this.state.error?.message ||
                'Ocurrió una excepción inesperada al renderizar la interfaz.'}
            </p>

            <div className="flex items-center gap-3 pt-2">
              <Button intent="neutral" tone="outline" size="md" onClick={this.handleReload}>
                Reiniciar terminal
              </Button>
              <Button intent="danger" size="md" onClick={this.handleRetry}>
                Reintentar
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
