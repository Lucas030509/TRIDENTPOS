/**
 * TRIDENTPOS WP-025: DEC-013 / OQ-SSOT-04 Mobile Void with Manager PIN Service
 * Enforces manager PIN validation and mandatory reason catalog before voiding an active or printed table account.
 */

import type { MobileVoidRequest, MobileVoidResult } from '../types.js';
import { MobileLanClient } from '../network/lan-client.js';

export interface ManagerPinValidator {
  verifyManagerPin: (plainPin: string) => Promise<{ valid: boolean; managerId?: string }>;
}

export const CANCELLATION_REASONS = [
  { code: 'CLIENT_LEFT', label: 'Cliente se retiró sin consumir' },
  { code: 'ORDER_ERROR', label: 'Error en captura de comanda' },
  { code: 'KITCHEN_DELAY', label: 'Demora excesiva en cocina' },
  { code: 'DUPLICATE_ORDER', label: 'Orden duplicada accidentalmente' },
  { code: 'FOOD_QUALITY', label: 'Inconformidad con la preparación' },
] as const;

export class MobileVoidService {
  private readonly lanClient: MobileLanClient;
  private readonly managerValidator: ManagerPinValidator;

  constructor(lanClient: MobileLanClient, managerValidator: ManagerPinValidator) {
    this.lanClient = lanClient;
    this.managerValidator = managerValidator;
  }

  public getCancellationReasons(): readonly { code: string; label: string }[] {
    return CANCELLATION_REASONS;
  }

  /**
   * DEC-013: Cancels an active or printed table account requiring manager PIN and reason code.
   */
  public async voidAccount(request: MobileVoidRequest): Promise<MobileVoidResult> {
    if (!request.reasonCode) {
      return {
        success: false,
        accountId: request.accountId,
        voidedAt: new Date().toISOString(),
        authorizedByManagerId: '',
        voidReason: '',
        error: 'MANDATORY_REASON_REQUIRED: A valid cancellation reason code is required.',
      };
    }

    // Verify manager PIN
    const auth = await this.managerValidator.verifyManagerPin(request.managerPin);
    if (!auth.valid || !auth.managerId) {
      return {
        success: false,
        accountId: request.accountId,
        voidedAt: new Date().toISOString(),
        authorizedByManagerId: '',
        voidReason: request.reasonCode,
        error: 'MANAGER_PIN_REJECTED: Supervisor authorization failed. Account void denied.',
      };
    }

    // Dispatch void mutation
    const res = await this.lanClient.executeMutation<MobileVoidRequest, MobileVoidResult>({
      endpoint: `/api/v1/dining/accounts/${request.accountId}/void`,
      method: 'POST',
      body: request,
      mutationType: 'VOID_ACCOUNT',
    });

    if (res.ok) {
      return {
        success: true,
        accountId: request.accountId,
        voidedAt: new Date().toISOString(),
        authorizedByManagerId: auth.managerId,
        voidReason: request.reasonCode,
        folioAnnulled: request.hadPrecuentaPrinted ? `FOLIO-VOID-${request.accountId}` : undefined,
      };
    }

    return {
      success: false,
      accountId: request.accountId,
      voidedAt: new Date().toISOString(),
      authorizedByManagerId: auth.managerId,
      voidReason: request.reasonCode,
      error: res.error,
    };
  }
}
