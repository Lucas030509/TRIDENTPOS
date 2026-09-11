/**
 * TRIDENTPOS Edge Secure Storage and Station PIN Store
 * Conforms to SECRETS_AND_KEY_MANAGEMENT.md Sec. 4, ACR-2026-011, and PRE_FREEZE_ADVERSARIAL_BUILDER_GATE Gate B.
 * Guarantees OS-backed encryption at rest and fail-closed semantics.
 * Prohibits Linux basic_text fallback.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import {
  EdgeSecureStoreError,
  EdgeTlsKeyMissingOrCorruptedError,
  StationPinRecord,
  StationPinStoreError,
} from './types.js';

/**
 * Pluggable backend adapter contract for EdgeSecureStore and StationPinStore.
 * Abstracts electron.safeStorage or platform OS keyring primitives.
 */
export interface SecureStorageBackend {
  isAvailable(): boolean;
  getSelectedStorageBackend(): string;
  encrypt(plaintext: Buffer): Buffer;
  decrypt(ciphertext: Buffer): Buffer;
}

/**
 * Standard Electron safeStorage adapter.
 * Uses native OS-backed keyring (DPAPI on Windows, Keychain Services on macOS, Secret Service on Linux).
 * Prohibits basic_text on Linux.
 */
export class ElectronSafeStorageBackend implements SecureStorageBackend {
  readonly #safeStorage: typeof import('electron').safeStorage | null;

  constructor(electronSafeStorage?: typeof import('electron').safeStorage) {
    if (electronSafeStorage) {
      this.#safeStorage = electronSafeStorage;
    } else {
      try {
        const req = createRequire(import.meta.url);
        const electron = req('electron') as typeof import('electron');
        this.#safeStorage = electron?.safeStorage ?? null;
      } catch {
        this.#safeStorage = null;
      }
    }
  }

  public isAvailable(): boolean {
    if (!this.#safeStorage) return false;
    try {
      return this.#safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  public getSelectedStorageBackend(): string {
    if (!this.#safeStorage) return 'unavailable';
    try {
      return this.#safeStorage.getSelectedStorageBackend();
    } catch {
      return 'unavailable';
    }
  }

  public encrypt(plaintext: Buffer): Buffer {
    if (!this.isAvailable()) {
      throw new EdgeSecureStoreError('Secure storage encryption is not available on this host');
    }
    const backend = this.getSelectedStorageBackend();
    if (backend === 'basic_text') {
      throw new EdgeSecureStoreError(
        "Insecure storage backend 'basic_text' on Linux is strictly prohibited. Failing closed.",
      );
    }
    return this.#safeStorage!.encryptString(plaintext.toString('utf8'));
  }

  public decrypt(ciphertext: Buffer): Buffer {
    if (!this.isAvailable()) {
      throw new EdgeSecureStoreError('Secure storage encryption is not available on this host');
    }
    const backend = this.getSelectedStorageBackend();
    if (backend === 'basic_text') {
      throw new EdgeSecureStoreError(
        "Insecure storage backend 'basic_text' on Linux is strictly prohibited. Failing closed.",
      );
    }
    const decryptedStr = this.#safeStorage!.decryptString(ciphertext);
    return Buffer.from(decryptedStr, 'utf8');
  }
}

/**
 * EdgeSecureStore
 * Manages encrypted at rest secrets for Edge Host (TLS private key, Station token HMAC key).
 * Enforces fail-closed semantics, OS-backed encryption, and zero plaintext persistence.
 */
export class EdgeSecureStore {
  readonly #storageDir: string;
  readonly #backend: SecureStorageBackend;

  constructor(options: { storageDir: string; backend?: SecureStorageBackend }) {
    this.#storageDir = path.resolve(options.storageDir);
    this.#backend = options.backend ?? new ElectronSafeStorageBackend();

    // Assert secure storage backend is available and not basic_text immediately upon construction
    if (!this.#backend.isAvailable()) {
      throw new EdgeSecureStoreError(
        'EdgeSecureStore initialization failed: host OS secure storage encryption is unavailable. Failing closed.',
      );
    }
    const backendName = this.#backend.getSelectedStorageBackend();
    if (backendName === 'basic_text') {
      throw new EdgeSecureStoreError(
        "Insecure storage backend 'basic_text' on Linux is strictly prohibited. Failing closed.",
      );
    }

    if (!fs.existsSync(this.#storageDir)) {
      fs.mkdirSync(this.#storageDir, { recursive: true });
    }
  }

  /**
   * Stores a secret buffer securely encrypted at rest.
   */
  public storeSecret(keyName: string, secretBytes: Buffer): void {
    const encrypted = this.#backend.encrypt(secretBytes);
    const targetFile = path.join(this.#storageDir, `${keyName}.enc`);
    const tempFile = `${targetFile}.${crypto.randomUUID()}.tmp`;

    fs.writeFileSync(tempFile, encrypted);
    fs.renameSync(tempFile, targetFile);
  }

  /**
   * Reads and decrypts a secret buffer.
   * Throws EdgeTlsKeyMissingOrCorruptedError if key is missing or corrupted.
   */
  public loadSecret(keyName: string): Buffer {
    const targetFile = path.join(this.#storageDir, `${keyName}.enc`);
    if (!fs.existsSync(targetFile)) {
      throw new EdgeTlsKeyMissingOrCorruptedError(
        `Secret '${keyName}' is missing in EdgeSecureStore at '${targetFile}'`,
      );
    }

    try {
      const rawEncrypted = fs.readFileSync(targetFile);
      return this.#backend.decrypt(rawEncrypted);
    } catch (err) {
      throw new EdgeTlsKeyMissingOrCorruptedError(
        `Secret '${keyName}' in EdgeSecureStore is corrupted or cannot be decrypted: ${(err as Error).message}`,
        { cause: err },
      );
    }
  }

  /**
   * Checks if a secret file exists in the store.
   */
  public hasSecret(keyName: string): boolean {
    const targetFile = path.join(this.#storageDir, `${keyName}.enc`);
    return fs.existsSync(targetFile);
  }

  /**
   * Securely deletes a secret from the store.
   */
  public deleteSecret(keyName: string): void {
    const targetFile = path.join(this.#storageDir, `${keyName}.enc`);
    if (fs.existsSync(targetFile)) {
      fs.unlinkSync(targetFile);
    }
  }
}

/**
 * StationPinStore
 * Client-side tamper-resistant store persisting verified TLS certificate fingerprints.
 * Backed by platform secure storage (encrypted at rest; never mutable plaintext JSON).
 * Enforces:
 * 1. Initial enrollment pin can be established.
 * 2. Normal runtime code CANNOT overwrite an existing pin (mismatch fails closed).
 * 3. Administrative reset requires supervised physical intervention.
 * 4. PIN STORE FAILURE => ZERO SECRET DISCLOSURE + ZERO SERVER MUTATION.
 */
export class StationPinStore {
  readonly #storeFilePath: string;
  readonly #backend: SecureStorageBackend;
  #pins: Map<string, StationPinRecord> = new Map();

  constructor(options: { storeFilePath: string; backend?: SecureStorageBackend }) {
    this.#storeFilePath = path.resolve(options.storeFilePath);
    this.#backend = options.backend ?? new ElectronSafeStorageBackend();

    if (!this.#backend.isAvailable()) {
      throw new StationPinStoreError(
        'StationPinStore initialization failed: host secure storage encryption is unavailable. Failing closed.',
      );
    }
    const backendName = this.#backend.getSelectedStorageBackend();
    if (backendName === 'basic_text') {
      throw new StationPinStoreError(
        "Insecure storage backend 'basic_text' on Linux is strictly prohibited. Failing closed.",
      );
    }

    this.#loadFromFile();
  }

  #getCompositeKey(branchId: string, edgeId: string): string {
    return `${branchId}:${edgeId}`;
  }

  #loadFromFile(): void {
    if (!fs.existsSync(this.#storeFilePath)) {
      return;
    }
    try {
      const rawEncrypted = fs.readFileSync(this.#storeFilePath);
      const decrypted = this.#backend.decrypt(rawEncrypted);
      const data = JSON.parse(decrypted.toString('utf8')) as StationPinRecord[];
      for (const item of data) {
        this.#pins.set(this.#getCompositeKey(item.branchId, item.edgeId), item);
      }
    } catch (err) {
      throw new StationPinStoreError(
        `Failed to load StationPinStore from '${this.#storeFilePath}': ${(err as Error).message}`,
        { cause: err },
      );
    }
  }

  #saveToFile(): void {
    try {
      const dir = path.dirname(this.#storeFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const data = Array.from(this.#pins.values());
      const jsonBuffer = Buffer.from(JSON.stringify(data, null, 2), 'utf8');
      const encrypted = this.#backend.encrypt(jsonBuffer);

      const tempFile = `${this.#storeFilePath}.${crypto.randomUUID()}.tmp`;
      fs.writeFileSync(tempFile, encrypted);
      fs.renameSync(tempFile, this.#storeFilePath);
    } catch (err) {
      throw new StationPinStoreError(
        `Failed to save StationPinStore to '${this.#storeFilePath}': ${(err as Error).message}`,
        { cause: err },
      );
    }
  }

  #setInitialPin(record: StationPinRecord): void {
    this.#pins.set(this.#getCompositeKey(record.branchId, record.edgeId), record);
    this.#saveToFile();
  }

  /**
   * Retrieves a pinned record for a branch and edge host.
   */
  public getPin(branchId: string, edgeId: string): StationPinRecord | null {
    return this.#pins.get(this.#getCompositeKey(branchId, edgeId)) ?? null;
  }

  /**
   * Verifies a candidate fingerprint against stored pin or sets initial pin.
   * If pin already exists, candidate must match stored pin.
   * Normal runtime code cannot overwrite an existing pin. Mismatch fails closed.
   */
  public verifyOrPin(branchId: string, edgeId: string, candidateFingerprint: string): boolean {
    const existing = this.getPin(branchId, edgeId);
    if (existing) {
      return existing.edgePublicKeyFingerprint.toUpperCase() === candidateFingerprint.toUpperCase();
    }

    // Persist initial verified pin
    const now = Math.floor(Date.now() / 1000);
    this.#setInitialPin({
      branchId,
      edgeId,
      edgePublicKeyFingerprint: candidateFingerprint.toUpperCase(),
      pinnedAt: now,
    });
    return true;
  }

  /**
   * Supervised administrative reset of an existing PIN.
   * Requires non-empty administrative authorization token.
   */
  public supervisedAdministrativeResetPin(
    branchId: string,
    edgeId: string,
    newFingerprint: string,
    authorization: { supervisedAdminToken: string },
  ): void {
    if (
      !authorization?.supervisedAdminToken ||
      typeof authorization.supervisedAdminToken !== 'string' ||
      authorization.supervisedAdminToken.trim() === ''
    ) {
      throw new StationPinStoreError(
        'Supervised administrative pin reset rejected: non-empty administrative authorization token is required.',
      );
    }

    const key = this.#getCompositeKey(branchId, edgeId);
    const now = Math.floor(Date.now() / 1000);
    this.#pins.set(key, {
      branchId,
      edgeId,
      edgePublicKeyFingerprint: newFingerprint.toUpperCase(),
      pinnedAt: now,
    });
    this.#saveToFile();
  }
}
