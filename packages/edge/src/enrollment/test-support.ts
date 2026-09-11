/**
 * TRIDENTPOS Edge Enrollment Test Support Doubles
 *
 * TEST DOUBLE ONLY:
 * This module is strictly isolated inside the test boundary for headless unit tests.
 * It is NEVER exported by the production package (@trident/edge).
 * Conforms to QI-SEC-01 and QI-TEST-06.
 */

import crypto from 'node:crypto';
import { SecureStorageBackend } from './secure-store.js';
import { EdgeSecureStoreError } from './types.js';

/**
 * TestIsolatedSecureStorageBackend
 * Isolated in-memory/crypto test double implementing SecureStorageBackend.
 * Explicitly labeled as a test double and provides fault injection hooks for unit testing.
 */
export class TestIsolatedSecureStorageBackend implements SecureStorageBackend {
  readonly #masterKey: Buffer;
  #simulatedBackendName: string;
  #available: boolean;
  #simulateEncryptFailure = false;
  #simulateDecryptFailure = false;

  constructor(
    options: {
      masterKey?: Buffer;
      simulatedBackendName?: string;
      available?: boolean;
    } = {},
  ) {
    this.#available = options.available ?? true;
    this.#simulatedBackendName = options.simulatedBackendName ?? 'test_isolated_double';

    if (options.masterKey) {
      if (options.masterKey.length !== 32) {
        throw new EdgeSecureStoreError(
          'TestIsolatedSecureStorageBackend masterKey must be 32 bytes',
        );
      }
      this.#masterKey = options.masterKey;
    } else {
      // In-memory unique random master key per instance
      this.#masterKey = crypto.randomBytes(32);
    }
  }

  public isAvailable(): boolean {
    return this.#available;
  }

  public setAvailable(available: boolean): void {
    this.#available = available;
  }

  public getSelectedStorageBackend(): string {
    return this.#simulatedBackendName;
  }

  public setSimulatedBackendName(name: string): void {
    this.#simulatedBackendName = name;
  }

  public setSimulateEncryptFailure(fail: boolean): void {
    this.#simulateEncryptFailure = fail;
  }

  public setSimulateDecryptFailure(fail: boolean): void {
    this.#simulateDecryptFailure = fail;
  }

  public encrypt(plaintext: Buffer): Buffer {
    if (this.#simulateEncryptFailure) {
      throw new EdgeSecureStoreError('Simulated secure storage encryption failure');
    }
    if (!this.#available) {
      throw new EdgeSecureStoreError('Secure storage encryption is not available on this host');
    }
    if (this.#simulatedBackendName === 'basic_text') {
      throw new EdgeSecureStoreError(
        "Insecure storage backend 'basic_text' on Linux is strictly prohibited. Failing closed.",
      );
    }

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.#masterKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();

    // Wire format: [12 bytes IV] + [16 bytes Tag] + [Ciphertext]
    return Buffer.concat([iv, tag, ciphertext]);
  }

  public decrypt(data: Buffer): Buffer {
    if (this.#simulateDecryptFailure) {
      throw new EdgeSecureStoreError('Simulated secure storage decryption failure');
    }
    if (!this.#available) {
      throw new EdgeSecureStoreError('Secure storage encryption is not available on this host');
    }
    if (this.#simulatedBackendName === 'basic_text') {
      throw new EdgeSecureStoreError(
        "Insecure storage backend 'basic_text' on Linux is strictly prohibited. Failing closed.",
      );
    }

    if (data.length < 28) {
      throw new EdgeSecureStoreError('Ciphertext data too short or corrupt');
    }

    const iv = data.subarray(0, 12);
    const tag = data.subarray(12, 28);
    const ciphertext = data.subarray(28);

    const decipher = crypto.createDecipheriv('aes-256-gcm', this.#masterKey, iv);
    decipher.setAuthTag(tag);

    try {
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch (err) {
      throw new EdgeSecureStoreError(
        `Secure storage decryption failed: ${(err as Error).message}`,
        { cause: err },
      );
    }
  }
}
