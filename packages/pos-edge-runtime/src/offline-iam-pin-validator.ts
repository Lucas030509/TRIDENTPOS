/**
 * TRIDENTPOS Offline IAM PIN Validator Adapter (WP-016 / WP-010 / DEC-017)
 * Implements IamPinValidatorPort from @trident/pos using OfflineIamService from @trident/edge.
 */

import { OfflineIamService } from '@trident/edge';
import type { IamPinValidatorPort } from '@trident/pos';

export class OfflineIamPinValidatorAdapter implements IamPinValidatorPort {
  readonly #iamService: OfflineIamService;

  constructor(iamService: OfflineIamService) {
    this.#iamService = iamService;
  }

  public async validatePin(userId: string, pin: string, stationId?: string): Promise<boolean> {
    try {
      const result = await this.#iamService.authenticateWithPin({
        userId,
        pin,
        stationId: stationId ?? 'POS-DEFAULT-STATION',
      });
      return result.success && result.session.userId === userId;
    } catch {
      return false;
    }
  }
}
