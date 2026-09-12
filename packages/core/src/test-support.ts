/**
 * TRIDENTPOS Core Test Support Helpers
 * Strictly for test and verification environments.
 * NOT exported from the production @trident/core root entrypoint.
 */

import crypto from 'node:crypto';
import type {
  CloudReceiptIssuer,
  CloudReceiptVerifier,
  CloudTransactionReceipt,
  ReceiptIssuanceContext,
} from './sync-contracts.js';

export * from './sync-contracts.js';

/**
 * Deterministic Test Cloud Receipt Issuer for test suites.
 * Uses deterministic HMAC-SHA256 over canonical context.
 */
export class TestCloudReceiptIssuer implements CloudReceiptIssuer {
  readonly #testSecret: string;
  public issueCallCount = 0;

  constructor(testSecret = 'trident-test-trust-secret-key-wp012') {
    this.#testSecret = testSecret;
  }

  public issueReceipt(context: ReceiptIssuanceContext): CloudTransactionReceipt {
    this.issueCallCount++;
    const canonical = JSON.stringify([
      context.organizationId,
      context.branchId,
      context.clientOpId,
      context.aggregateSequenceNumber,
      this.#testSecret,
    ]);
    const sig = crypto.createHmac('sha256', this.#testSecret).update(canonical).digest('hex');
    const token = `receipt_${context.organizationId}_${context.clientOpId}_${context.aggregateSequenceNumber}`;
    return {
      receiptId: token,
      appliedAt: new Date().toISOString(),
      serverSignature: sig,
      clientOpId: context.clientOpId,
      aggregateSequenceNumber: context.aggregateSequenceNumber,
    };
  }
}

/**
 * Deterministic Test Cloud Receipt Verifier for test suites.
 * Re-computes and constant-time compares HMAC-SHA256 signature.
 */
export class TestCloudReceiptVerifier implements CloudReceiptVerifier {
  readonly #testSecret: string;

  constructor(testSecret = 'trident-test-trust-secret-key-wp012') {
    this.#testSecret = testSecret;
  }

  public verifyReceipt(
    receipt: CloudTransactionReceipt,
    expectedContext: ReceiptIssuanceContext,
  ): boolean {
    if (!receipt || typeof receipt !== 'object') return false;
    if (!receipt.receiptId || !receipt.serverSignature) return false;
    if (receipt.clientOpId !== expectedContext.clientOpId) return false;
    if (receipt.aggregateSequenceNumber !== expectedContext.aggregateSequenceNumber) return false;

    const canonical = JSON.stringify([
      expectedContext.organizationId,
      expectedContext.branchId,
      expectedContext.clientOpId,
      expectedContext.aggregateSequenceNumber,
      this.#testSecret,
    ]);
    const expectedSig = crypto
      .createHmac('sha256', this.#testSecret)
      .update(canonical)
      .digest('hex');

    try {
      const a = Buffer.from(receipt.serverSignature, 'hex');
      const b = Buffer.from(expectedSig, 'hex');
      if (a.length !== b.length || a.length === 0) return false;
      return crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }
}
