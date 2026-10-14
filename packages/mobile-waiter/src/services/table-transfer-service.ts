/**
 * TRIDENTPOS WP-025: DEC-011 / OQ-SSOT-02 Table Transfer with Receiver PIN Service
 * Enforces that table transfer applies strictly when the receiving waiter authenticates with their PIN.
 */

import type { TableTransferRequest, TableTransferResult, WaiterProfile } from '../types.js';
import { MobileLanClient } from '../network/lan-client.js';

export interface WaiterPinValidator {
  verifyWaiterPin: (waiterId: string, plainPin: string) => boolean | Promise<boolean>;
}

export class TableTransferService {
  private readonly lanClient: MobileLanClient;
  private readonly pinValidator: WaiterPinValidator;
  private readonly waiters: Map<string, WaiterProfile> = new Map();

  constructor(
    lanClient: MobileLanClient,
    pinValidator: WaiterPinValidator,
    initialWaiters?: readonly WaiterProfile[],
  ) {
    this.lanClient = lanClient;
    this.pinValidator = pinValidator;
    if (initialWaiters) {
      for (const w of initialWaiters) {
        this.waiters.set(w.id, w);
      }
    }
  }

  public getAvailableWaiters(currentWaiterId?: string): readonly WaiterProfile[] {
    const all = Array.from(this.waiters.values());
    if (currentWaiterId) {
      return all.filter((w) => w.id !== currentWaiterId);
    }
    return all;
  }

  /**
   * DEC-011: Executes table transfer only if the receiving waiter enters their valid PIN.
   */
  public async transferTable(request: TableTransferRequest): Promise<TableTransferResult> {
    if (request.fromWaiterId === request.toWaiterId) {
      return {
        success: false,
        tableId: request.tableId,
        transferredAt: new Date().toISOString(),
        previousWaiterId: request.fromWaiterId,
        newWaiterId: request.fromWaiterId,
        error: 'INVALID_TRANSFER: Source and target waiters must be different.',
      };
    }

    // DEC-011: Verify receiver PIN
    const isPinValid = await this.pinValidator.verifyWaiterPin(
      request.toWaiterId,
      request.receiverPin,
    );

    if (!isPinValid) {
      // Fail-closed: Account remains with current waiter
      return {
        success: false,
        tableId: request.tableId,
        transferredAt: new Date().toISOString(),
        previousWaiterId: request.fromWaiterId,
        newWaiterId: request.fromWaiterId,
        error:
          'RECEIVER_PIN_REJECTED: Receiving waiter PIN authentication failed. Account retained by original waiter.',
      };
    }

    // Dispatch transfer mutation via LAN client
    const res = await this.lanClient.executeMutation<TableTransferRequest, TableTransferResult>({
      endpoint: `/api/v1/dining/tables/${request.tableId}/transfer`,
      method: 'POST',
      body: request,
      mutationType: 'TRANSFER_TABLE',
    });

    if (res.ok) {
      return {
        success: true,
        tableId: request.tableId,
        transferredAt: new Date().toISOString(),
        previousWaiterId: request.fromWaiterId,
        newWaiterId: request.toWaiterId,
      };
    }

    return {
      success: false,
      tableId: request.tableId,
      transferredAt: new Date().toISOString(),
      previousWaiterId: request.fromWaiterId,
      newWaiterId: request.fromWaiterId,
      error: res.error,
    };
  }
}
