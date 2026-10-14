/**
 * TRIDENTPOS WP-024: Backoffice Multi-Tenant Session Store
 * Manages active session state, branch context switching, and token expiration.
 */

import type { BackofficeSession } from '../types.js';
import { canAccessBranch } from './rbac-guard.js';

export class BackofficeSessionStore {
  private currentSession: BackofficeSession | null = null;
  private readonly listeners: Set<(session: BackofficeSession | null) => void> = new Set();

  constructor(initialSession?: BackofficeSession) {
    if (initialSession) {
      this.currentSession = initialSession;
    }
  }

  public getSession(): BackofficeSession | null {
    if (!this.currentSession) return null;

    // Check expiry
    if (this.currentSession.expiresAt <= Date.now()) {
      this.clearSession();
      return null;
    }

    return this.currentSession;
  }

  public setSession(session: BackofficeSession): void {
    this.currentSession = session;
    this.notifyListeners();
  }

  public clearSession(): void {
    this.currentSession = null;
    this.notifyListeners();
  }

  public switchBranch(newBranchId: string): boolean {
    if (!this.currentSession) return false;

    if (!canAccessBranch(this.currentSession.user, newBranchId)) {
      return false; // User not allowed on this branch
    }

    this.currentSession = {
      ...this.currentSession,
      activeBranchId: newBranchId,
    };
    this.notifyListeners();
    return true;
  }

  public subscribe(listener: (session: BackofficeSession | null) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener(this.currentSession);
    }
  }
}
