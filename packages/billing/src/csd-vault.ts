/**
 * TRIDENTPOS Billing: CSD Vault Interface & Fail-Closed / In-Memory Implementations
 * Governed by WP-021 SEC-VAL-05 and QI-BLK-021-R1-01.
 * Ensures zero secrets logged, persisted in plain text, or exposed in APIs.
 */

import { CsdCredentialsMissingError } from './errors.js';
import type { CsdCredentials } from './types.js';

export interface ICsdVault {
  getPrivateKeyPem(organizationId: string, vaultId: string): Promise<string | null>;
  getCsdCredentials?(organizationId: string): Promise<CsdCredentials | null>;
  storePrivateKeyPem?(
    organizationId: string,
    vaultId: string,
    privateKeyPem: string,
  ): Promise<void>;
  storeCsdCredentials?(organizationId: string, credentials: CsdCredentials): Promise<void>;
}

/**
 * Fail-closed CSD Vault for production runtime when no secure hardware/cloud KMS vault is configured.
 */
export class UnavailableCsdVault implements ICsdVault {
  async getPrivateKeyPem(_organizationId: string, _vaultId: string): Promise<string | null> {
    throw new CsdCredentialsMissingError(
      'No CSD Vault configured in runtime composition. Fiscal signing is fail-closed.',
    );
  }

  async getCsdCredentials(_organizationId: string): Promise<CsdCredentials | null> {
    throw new CsdCredentialsMissingError(
      'No CSD Vault configured in runtime composition. Fiscal signing is fail-closed.',
    );
  }
}

/**
 * In-Memory CSD Vault for test fixtures and simulated environments.
 * Must NEVER be used as default production runtime.
 */
export class InMemoryCsdVault implements ICsdVault {
  private readonly keyStore = new Map<string, string>();
  private readonly credStore = new Map<string, CsdCredentials>();

  private makeKey(organizationId: string, vaultId: string): string {
    return `${organizationId}:${vaultId}`;
  }

  async getPrivateKeyPem(organizationId: string, vaultId: string): Promise<string | null> {
    const directKey = this.keyStore.get(this.makeKey(organizationId, vaultId));
    if (directKey) return directKey;

    const cred = this.credStore.get(organizationId);
    if (cred?.privateKeyPem) return cred.privateKeyPem;

    return null;
  }

  async storePrivateKeyPem(
    organizationId: string,
    vaultId: string,
    privateKeyPem: string,
  ): Promise<void> {
    this.keyStore.set(this.makeKey(organizationId, vaultId), privateKeyPem);
  }

  async getCsdCredentials(organizationId: string): Promise<CsdCredentials | null> {
    return this.credStore.get(organizationId) ?? null;
  }

  async storeCsdCredentials(organizationId: string, credentials: CsdCredentials): Promise<void> {
    this.credStore.set(organizationId, credentials);
    if (credentials.privateKeyPem) {
      this.keyStore.set(this.makeKey(organizationId, 'default'), credentials.privateKeyPem);
    }
  }
}
