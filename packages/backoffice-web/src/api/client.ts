/**
 * TRIDENTPOS WP-024: Backoffice Cloud API Client & Optimistic Mutation Engine
 * Handles tenant-isolated HTTP requests, correlation tracing, and optimistic state with automated rollback.
 */

import type { ApiResponse } from '../types.js';

export interface ApiClientConfig {
  baseUrl: string;
  getAuthToken?: () => string | undefined;
  getOrgId?: () => string | undefined;
  getBranchId?: () => string | undefined;
}

export class BackofficeApiClient {
  private readonly config: ApiClientConfig;

  constructor(config: ApiClientConfig) {
    this.config = config;
  }

  public async request<T>(
    endpoint: string,
    options: {
      method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
      body?: unknown;
      headers?: Record<string, string>;
    } = {},
  ): Promise<ApiResponse<T>> {
    const method = options.method || 'GET';
    const correlationId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-correlation-id': correlationId,
      ...options.headers,
    };

    const token = this.config.getAuthToken?.();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const orgId = this.config.getOrgId?.();
    if (orgId) {
      headers['x-tenant-org-id'] = orgId;
    }

    const branchId = this.config.getBranchId?.();
    if (branchId) {
      headers['x-branch-id'] = branchId;
    }

    try {
      const url = `${this.config.baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
      const response = await fetch(url, {
        method,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
      });

      if (!response.ok) {
        let errorData: { code?: string; message?: string } = {};
        try {
          errorData = await response.json();
        } catch {
          errorData = { message: response.statusText };
        }

        return {
          ok: false,
          error: {
            code: errorData.code || `HTTP_${response.status}`,
            message: errorData.message || 'API request failed',
            retryable: response.status >= 500 || response.status === 429,
          },
        };
      }

      const data = (await response.json()) as T;
      return { ok: true, data };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Network error';
      return {
        ok: false,
        error: {
          code: 'NETWORK_ERROR',
          message,
          retryable: true,
        },
      };
    }
  }

  /**
   * Optimistically applies a local state mutation, kicks off the remote API call,
   * and rolls back to previous state if the API fails.
   */
  public async executeOptimisticMutation<TState, TResult>(params: {
    currentState: TState;
    applyOptimistic: (state: TState) => TState;
    apiCall: () => Promise<ApiResponse<TResult>>;
    onUpdate: (newState: TState) => void;
    onError?: (error: { code: string; message: string }) => void;
  }): Promise<ApiResponse<TResult>> {
    const previousState = params.currentState;
    const optimisticState = params.applyOptimistic(previousState);

    // 1. Immediately apply optimistic state
    params.onUpdate(optimisticState);

    // 2. Perform async remote call
    const result = await params.apiCall();

    // 3. Rollback on failure
    if (!result.ok) {
      params.onUpdate(previousState);
      if (params.onError && result.error) {
        params.onError(result.error);
      }
    }

    return result;
  }
}
