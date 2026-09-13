/**
 * TRIDENTPOS Modifier Recipe Resolver Contract
 *
 * GOVERNANCE NOTICE (OQ-SSOT-07):
 * Modifier recipe resolution semantics remain PENDING PRODUCT OWNER DECISION.
 * This file defines the neutral contract/hook only.
 * Hardcoding any concrete business logic, substitution heuristics, or default
 * inventory deduction algorithms here is STRICTLY PROHIBITED.
 */

export interface ModifierRecipeResolutionContext {
  readonly organizationId: string;
  readonly recipeId: string;
  readonly modifierId: string;
  readonly quantity: string;
}

export interface ResolvedModifierImpact {
  readonly modifierId: string;
  readonly additionalIngredients: readonly {
    readonly ingredientId: string;
    readonly quantity: string;
    readonly grossQuantity: string;
  }[];
  readonly removedIngredients: readonly {
    readonly ingredientId: string;
  }[];
}

/**
 * Neutral injectable resolver interface.
 * Implementations may be provided by specialized plugins once PO decisions are finalized.
 */
export interface ModifierRecipeResolver {
  resolveModifierImpact(
    context: ModifierRecipeResolutionContext,
  ): Promise<ResolvedModifierImpact | null>;
}
