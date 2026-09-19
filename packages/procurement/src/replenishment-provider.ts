/**
 * TRIDENTPOS Procurement Replenishment Provider Interface
 *
 * NOTE: OQ-SSOT-05 (Replenishment Suggestion Algorithm) remains OPEN.
 * This file defines ONLY the neutral domain contract.
 * Zero concrete algorithms (min/max, EOQ, reorder point, days of stock, etc.) are implemented.
 */

export interface ReplenishmentSuggestionContext {
  organizationId: string;
  branchId: string;
  warehouseId?: string;
  asOfDate?: string;
}

export interface ReplenishmentSuggestionItem {
  ingredientId: string;
  suggestedQuantity: string;
  suggestedSupplierId?: string;
  rationale?: string;
}

export interface ReplenishmentSuggestionResult {
  generatedAt: string;
  items: ReplenishmentSuggestionItem[];
}

export interface ReplenishmentSuggestionProvider {
  getSuggestions(context: ReplenishmentSuggestionContext): Promise<ReplenishmentSuggestionResult>;
}
