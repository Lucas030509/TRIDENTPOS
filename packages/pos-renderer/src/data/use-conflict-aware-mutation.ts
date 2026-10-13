import * as React from 'react';
import { BridgeResult, ConflictInfo } from '../bridge/trident-bridge.js';

export interface UseConflictAwareMutationOptions<TVariables, TData> {
  readonly mutationFn: (variables: TVariables) => Promise<BridgeResult<TData>>;
  readonly onSuccess?: (data: TData) => void;
  readonly onConflict?: (conflict: ConflictInfo) => void;
  readonly onError?: (error: { code: string; message: string }) => void;
}

export interface UseConflictAwareMutationResult<TVariables, TData> {
  readonly mutate: (variables: TVariables) => Promise<TData | null>;
  readonly isLoading: boolean;
  readonly error: { code: string; message: string } | null;
  readonly conflict: ConflictInfo | null;
  readonly clearConflict: () => void;
  readonly reset: () => void;
}

export function useConflictAwareMutation<TVariables, TData>({
  mutationFn,
  onSuccess,
  onConflict,
  onError,
}: UseConflictAwareMutationOptions<TVariables, TData>): UseConflictAwareMutationResult<
  TVariables,
  TData
> {
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<{ code: string; message: string } | null>(null);
  const [conflict, setConflict] = React.useState<ConflictInfo | null>(null);

  const clearConflict = React.useCallback(() => {
    setConflict(null);
  }, []);

  const reset = React.useCallback(() => {
    setIsLoading(false);
    setError(null);
    setConflict(null);
  }, []);

  const mutate = React.useCallback(
    async (variables: TVariables): Promise<TData | null> => {
      setIsLoading(true);
      setError(null);
      setConflict(null);

      try {
        const result = await mutationFn(variables);

        if (result.ok) {
          onSuccess?.(result.data);
          return result.data;
        }

        // Check for OCC 409 / CONFLICT_VERSION
        if (result.error.code === 'CONFLICT_VERSION' && result.error.conflict) {
          setConflict(result.error.conflict);
          onConflict?.(result.error.conflict);
        } else {
          setError({ code: result.error.code, message: result.error.message });
          onError?.({ code: result.error.code, message: result.error.message });
        }
        return null;
      } catch (err) {
        const fallbackErr = {
          code: 'INTERNAL',
          message: (err as Error).message || 'Error inesperado al ejecutar la operación',
        };
        setError(fallbackErr);
        onError?.(fallbackErr);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [mutationFn, onSuccess, onConflict, onError],
  );

  return {
    mutate,
    isLoading,
    error,
    conflict,
    clearConflict,
    reset,
  };
}
