/**
 * TRIDENTPOS Cloud Server Composition Root
 *
 * Provides Cloud-tier application services wiring PostgreSQL repositories
 * to pure domain calculation engines under strict tenant context (RLS).
 *
 * Implements:
 * - Recipe lookup & explosion (WP-017)
 * - Theoretical recipe costing (WP-017)
 * - Real-time Kárdex stock query (WP-018)
 * - Waste registration with mandatory evidence (WP-018)
 * - KDS recipe depletion consumer with transactional outbox (WP-018)
 * - Modifier quarantine & replay capabilities (WP-018)
 *
 * Architectural governance: Layer 4 Composition Root.
 * Zero dependency on @trident/pos per WP-017 / WP-018 / ACR-2026-013 / ACR-2026-017.
 */

import type pg from 'pg';
import {
  RecipeEngine,
  type Recipe,
  type RecipeItem,
  type ExplodedIngredient,
  type RecipeCostCalculationResult,
  type StockLedgerEntry,
  type RegisterWasteCommand,
  type WasteRecord,
  type NegativeStockSignal,
  type KdsOrderProducedEventDTO,
  type KdsDepletionResult,
  type QuarantineRecord,
  type ModifierRecipeResolver,
  type ResolvedModifierImpact,
  type InventarioDescontadoPorRecetaPayload,
  type InventarioDescontadoMovementItem,
  RecipeNotFoundError,
  parseDecimal12x4,
  formatDecimal12x4,
  multiplyScale4,
  divideScale4,
  addScale4,
  negateScale4,
  validateWasteCommand,
  aggregateIngredientQuantities,
} from '@trident/inventory';
import { getPool, withTenantTransaction, CloudIntegrationOutboxService } from '@trident/database';

export interface CloudInventoryCompositionService {
  getRecipe(organizationId: string, recipeId: string): Promise<Recipe | null>;
  getRecipeByProductId(organizationId: string, productId: string): Promise<Recipe | null>;
  getIngredientAverageCost(organizationId: string, ingredientId: string): Promise<string>;
  explodeRecipeIngredients(
    organizationId: string,
    recipeId: string,
  ): Promise<readonly ExplodedIngredient[]>;
  calculateRecipeCost(
    organizationId: string,
    recipeId: string,
  ): Promise<RecipeCostCalculationResult>;
  getCurrentStock(
    organizationId: string,
    branchId: string,
    warehouseId: string,
    ingredientId: string,
  ): Promise<string>;
  registerWaste(command: RegisterWasteCommand): Promise<{
    movement: StockLedgerEntry;
    wasteRecord: WasteRecord;
    negativeStockAlert: NegativeStockSignal | null;
  }>;
  onKdsOrderProduced(
    event: KdsOrderProducedEventDTO,
    customResolver?: ModifierRecipeResolver,
  ): Promise<KdsDepletionResult>;
  replayQuarantinedDepletion(
    organizationId: string,
    quarantineId: string,
    resolver: ModifierRecipeResolver,
  ): Promise<KdsDepletionResult>;
  getQuarantineRecords(
    organizationId: string,
    status?: 'PENDING' | 'REPLAYED' | 'REJECTED',
  ): Promise<readonly QuarantineRecord[]>;
}

export class PostgresCloudInventoryService implements CloudInventoryCompositionService {
  private readonly pool: pg.Pool;
  private readonly outboxService: CloudIntegrationOutboxService;

  public constructor(pool?: pg.Pool, outboxService?: CloudIntegrationOutboxService) {
    this.pool = pool ?? getPool();
    this.outboxService = outboxService ?? new CloudIntegrationOutboxService();
  }

  /**
   * Fetches a Recipe with its RecipeItems within a tenant transaction boundary.
   */
  public async getRecipe(organizationId: string, recipeId: string): Promise<Recipe | null> {
    return withTenantTransaction(this.pool, organizationId, async (client) => {
      return this.getRecipeWithClient(client, organizationId, recipeId);
    });
  }

  /**
   * Fetches a Recipe by product_id within a tenant transaction boundary.
   */
  public async getRecipeByProductId(
    organizationId: string,
    productId: string,
  ): Promise<Recipe | null> {
    return withTenantTransaction(this.pool, organizationId, async (client) => {
      return this.getRecipeByProductIdWithClient(client, organizationId, productId);
    });
  }

  /**
   * Retrieves current_average_cost for an ingredient within a tenant transaction boundary.
   */
  public async getIngredientAverageCost(
    organizationId: string,
    ingredientId: string,
  ): Promise<string> {
    return withTenantTransaction(this.pool, organizationId, async (client) => {
      return this.getIngredientAverageCostWithClient(client, organizationId, ingredientId);
    });
  }

  /**
   * Explodes recipe into base raw materials within a single tenant transaction.
   * Recursive subrecipe lookups execute within the same active transaction.
   */
  public async explodeRecipeIngredients(
    organizationId: string,
    recipeId: string,
  ): Promise<readonly ExplodedIngredient[]> {
    return withTenantTransaction(this.pool, organizationId, async (client) => {
      const rootRecipe = await this.getRecipeWithClient(client, organizationId, recipeId);
      if (!rootRecipe) {
        throw new RecipeNotFoundError(recipeId);
      }

      const recipeResolver = async (subId: string) => {
        return this.getRecipeWithClient(client, organizationId, subId);
      };

      return RecipeEngine.explodeIngredients(rootRecipe, recipeResolver);
    });
  }

  /**
   * Computes theoretical recipe costing within a single tenant transaction.
   * Recursive subrecipe and ingredient lookups execute within the same active transaction.
   */
  public async calculateRecipeCost(
    organizationId: string,
    recipeId: string,
  ): Promise<RecipeCostCalculationResult> {
    return withTenantTransaction(this.pool, organizationId, async (client) => {
      const rootRecipe = await this.getRecipeWithClient(client, organizationId, recipeId);
      if (!rootRecipe) {
        throw new RecipeNotFoundError(recipeId);
      }

      const costResolver = {
        getIngredientCost: async (ingId: string) => {
          return this.getIngredientAverageCostWithClient(client, organizationId, ingId);
        },
        getSubRecipe: async (subId: string) => {
          return this.getRecipeWithClient(client, organizationId, subId);
        },
      };

      return RecipeEngine.calculateRecipeCost(rootRecipe, costResolver);
    });
  }

  /**
   * Queries current derived stock for an ingredient in a specific warehouse.
   * Authoritative balance = SUM(quantity_delta) from stock_ledger.
   */
  public async getCurrentStock(
    organizationId: string,
    branchId: string,
    warehouseId: string,
    ingredientId: string,
  ): Promise<string> {
    return withTenantTransaction(this.pool, organizationId, async (client) => {
      const res = await client.query<{ balance: string }>(
        `SELECT COALESCE(SUM(quantity_delta), 0.0000)::text AS balance
         FROM stock_ledger
         WHERE organization_id = $1 AND branch_id = $2 AND warehouse_id = $3 AND ingredient_id = $4;`,
        [organizationId, branchId, warehouseId, ingredientId],
      );
      const balanceRaw = res.rows[0]?.balance ?? '0.0000';
      const balanceScaled = parseDecimal12x4(balanceRaw);
      return formatDecimal12x4(balanceScaled);
    });
  }

  /**
   * Registers physical waste (MERMA) atomically with mandatory evidence.
   * Guaranteed:
   * 1. Idempotency on commandId.
   * 2. Transaction-scoped aggregate advisory lock preventing race conditions.
   * 3. Negative quantity_delta persisted in stock_ledger.
   * 4. Linked inventory_waste_records row created in the same transaction.
   * 5. Neutral NegativeStockSignal emitted if balance < 0.
   */
  public async registerWaste(command: RegisterWasteCommand): Promise<{
    movement: StockLedgerEntry;
    wasteRecord: WasteRecord;
    negativeStockAlert: NegativeStockSignal | null;
  }> {
    validateWasteCommand(command);

    return withTenantTransaction(this.pool, command.organizationId, async (client) => {
      // 1. Idempotency Check: if waste command was already applied, return existing record
      const existingWasteRes = await client.query<{
        id: string;
        organization_id: string;
        branch_id: string;
        warehouse_id: string;
        ingredient_id: string;
        stock_ledger_id: string;
        command_id: string;
        reason_code: string;
        photo_attachment_url: string;
        notes: string | null;
        actor_id: string | null;
        created_at: Date | string;
      }>(
        `SELECT id, organization_id, branch_id, warehouse_id, ingredient_id, stock_ledger_id,
                command_id, reason_code, photo_attachment_url, notes, actor_id, created_at
         FROM inventory_waste_records
         WHERE organization_id = $1 AND command_id = $2;`,
        [command.organizationId, command.commandId],
      );

      if (existingWasteRes.rows.length > 0) {
        const ew = existingWasteRes.rows[0]!;
        const ledgerRes = await client.query<{
          id: string;
          organization_id: string;
          branch_id: string;
          warehouse_id: string;
          ingredient_id: string;
          movement_type: string;
          reference_event_id: string;
          quantity_delta: string;
          unit_cost: string;
          total_cost: string;
          balance_after: string;
          movement_sequence_number: string;
          created_at: Date | string;
        }>(
          `SELECT id, organization_id, branch_id, warehouse_id, ingredient_id, movement_type,
                  reference_event_id, quantity_delta::text, unit_cost::text, total_cost::text,
                  balance_after::text, movement_sequence_number::text, created_at
           FROM stock_ledger
           WHERE organization_id = $1 AND id = $2;`,
          [command.organizationId, ew.stock_ledger_id],
        );

        const el = ledgerRes.rows[0]!;
        return {
          movement: {
            id: el.id,
            organizationId: el.organization_id,
            branchId: el.branch_id,
            warehouseId: el.warehouse_id,
            ingredientId: el.ingredient_id,
            movementType: el.movement_type as any,
            referenceEventId: el.reference_event_id,
            quantityDelta: el.quantity_delta,
            unitCost: el.unit_cost,
            totalCost: el.total_cost,
            balanceAfter: el.balance_after,
            movementSequenceNumber: el.movement_sequence_number,
            createdAt:
              typeof el.created_at === 'string' ? el.created_at : el.created_at.toISOString(),
          },
          wasteRecord: {
            id: ew.id,
            organizationId: ew.organization_id,
            branchId: ew.branch_id,
            warehouseId: ew.warehouse_id,
            ingredientId: ew.ingredient_id,
            stockLedgerId: ew.stock_ledger_id,
            commandId: ew.command_id,
            reasonCode: ew.reason_code,
            photoAttachmentUrl: ew.photo_attachment_url,
            notes: ew.notes,
            actorId: ew.actor_id,
            createdAt:
              typeof ew.created_at === 'string' ? ew.created_at : ew.created_at.toISOString(),
          },
          negativeStockAlert: null,
        };
      }

      // 2. Concurrency serialization via transaction-scoped advisory lock
      await this.acquireAggregateLock(
        client,
        command.organizationId,
        command.branchId,
        command.warehouseId,
        command.ingredientId,
      );

      // 3. Retrieve unit cost snapshot
      const unitCostStr = await this.getIngredientAverageCostWithClient(
        client,
        command.organizationId,
        command.ingredientId,
      );
      const unitCostScaled = parseDecimal12x4(unitCostStr);
      const wasteQtyScaled = parseDecimal12x4(command.quantity);
      const quantityDeltaScaled = negateScale4(wasteQtyScaled);
      const totalCostScaled = multiplyScale4(wasteQtyScaled, unitCostScaled);

      // 4. Calculate previous balance & next sequence
      const priorBalanceScaled = await this.getDerivedPriorBalanceWithClient(
        client,
        command.organizationId,
        command.branchId,
        command.warehouseId,
        command.ingredientId,
      );
      const nextSequence = await this.getNextSequenceWithClient(
        client,
        command.organizationId,
        command.branchId,
        command.warehouseId,
        command.ingredientId,
      );

      const balanceAfterScaled = addScale4(priorBalanceScaled, quantityDeltaScaled);
      const balanceAfterStr = formatDecimal12x4(balanceAfterScaled);

      // 5. Insert stock_ledger movement
      const insertLedgerRes = await client.query<{
        id: string;
        organization_id: string;
        branch_id: string;
        warehouse_id: string;
        ingredient_id: string;
        movement_type: string;
        reference_event_id: string;
        quantity_delta: string;
        unit_cost: string;
        total_cost: string;
        balance_after: string;
        movement_sequence_number: string;
        created_at: Date | string;
      }>(
        `INSERT INTO stock_ledger (
          organization_id, branch_id, warehouse_id, ingredient_id,
          movement_type, reference_event_id, quantity_delta, unit_cost,
          total_cost, balance_after, movement_sequence_number
        ) VALUES ($1, $2, $3, $4, 'MERMA', $5, $6, $7, $8, $9, $10)
        RETURNING id, organization_id, branch_id, warehouse_id, ingredient_id,
                  movement_type, reference_event_id, quantity_delta::text,
                  unit_cost::text, total_cost::text, balance_after::text,
                  movement_sequence_number::text, created_at;`,
        [
          command.organizationId,
          command.branchId,
          command.warehouseId,
          command.ingredientId,
          command.commandId,
          formatDecimal12x4(quantityDeltaScaled),
          formatDecimal12x4(unitCostScaled),
          formatDecimal12x4(totalCostScaled),
          balanceAfterStr,
          nextSequence,
        ],
      );

      const ledgerRow = insertLedgerRes.rows[0]!;

      // 6. Insert inventory_waste_records evidence
      const insertWasteRes = await client.query<{
        id: string;
        organization_id: string;
        branch_id: string;
        warehouse_id: string;
        ingredient_id: string;
        stock_ledger_id: string;
        command_id: string;
        reason_code: string;
        photo_attachment_url: string;
        notes: string | null;
        actor_id: string | null;
        created_at: Date | string;
      }>(
        `INSERT INTO inventory_waste_records (
          organization_id, branch_id, warehouse_id, ingredient_id,
          stock_ledger_id, command_id, reason_code, photo_attachment_url,
          notes, actor_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id, organization_id, branch_id, warehouse_id, ingredient_id,
                  stock_ledger_id, command_id, reason_code, photo_attachment_url,
                  notes, actor_id, created_at;`,
        [
          command.organizationId,
          command.branchId,
          command.warehouseId,
          command.ingredientId,
          ledgerRow.id,
          command.commandId,
          command.reasonCode.trim(),
          command.photoAttachmentUrl.trim(),
          command.notes ?? null,
          command.actorId ?? null,
        ],
      );

      const wasteRow = insertWasteRes.rows[0]!;

      let negativeStockAlert: NegativeStockSignal | null = null;
      if (balanceAfterScaled < 0n) {
        negativeStockAlert = {
          organizationId: command.organizationId,
          branchId: command.branchId,
          warehouseId: command.warehouseId,
          ingredientId: command.ingredientId,
          balanceAfter: balanceAfterStr,
          timestamp:
            typeof ledgerRow.created_at === 'string'
              ? ledgerRow.created_at
              : ledgerRow.created_at.toISOString(),
        };
      }

      return {
        movement: {
          id: ledgerRow.id,
          organizationId: ledgerRow.organization_id,
          branchId: ledgerRow.branch_id,
          warehouseId: ledgerRow.warehouse_id,
          ingredientId: ledgerRow.ingredient_id,
          movementType: ledgerRow.movement_type as any,
          referenceEventId: ledgerRow.reference_event_id,
          quantityDelta: ledgerRow.quantity_delta,
          unitCost: ledgerRow.unit_cost,
          totalCost: ledgerRow.total_cost,
          balanceAfter: ledgerRow.balance_after,
          movementSequenceNumber: ledgerRow.movement_sequence_number,
          createdAt:
            typeof ledgerRow.created_at === 'string'
              ? ledgerRow.created_at
              : ledgerRow.created_at.toISOString(),
        },
        wasteRecord: {
          id: wasteRow.id,
          organizationId: wasteRow.organization_id,
          branchId: wasteRow.branch_id,
          warehouseId: wasteRow.warehouse_id,
          ingredientId: wasteRow.ingredient_id,
          stockLedgerId: wasteRow.stock_ledger_id,
          commandId: wasteRow.command_id,
          reasonCode: wasteRow.reason_code,
          photoAttachmentUrl: wasteRow.photo_attachment_url,
          notes: wasteRow.notes,
          actorId: wasteRow.actor_id,
          createdAt:
            typeof wasteRow.created_at === 'string'
              ? wasteRow.created_at
              : wasteRow.created_at.toISOString(),
        },
        negativeStockAlert,
      };
    });
  }

  /**
   * KDS production completion depletion consumer.
   * Atomically explodes recipes, computes deductions, serializes movement sequencing,
   * inserts CONSUMO_KDS records, checks negative stock, and enqueues InventarioDescontadoPorReceta.
   *
   * Modifier handling (OQ-SSOT-07):
   * If selectedModifiers are present and no authorized resolver is provided, or if any
   * modifier resolution returns null/undefined, the event is quarantined in
   * inventory_quarantine_records with zero stock movements.
   */
  public async onKdsOrderProduced(
    event: KdsOrderProducedEventDTO,
    customResolver?: ModifierRecipeResolver,
  ): Promise<KdsDepletionResult> {
    return withTenantTransaction(this.pool, event.organizacionId, async (client) => {
      return this.applyKdsDepletionWithClient(client, event, customResolver);
    });
  }

  /**
   * Internal transaction-client scoped implementation of KDS order depletion.
   * Guarantees that depletion, outbox enqueue, and quarantine reconciliation all commit
   * or roll back atomically within the caller-provided client transaction.
   */
  public async applyKdsDepletionWithClient(
    client: pg.PoolClient,
    event: KdsOrderProducedEventDTO,
    customResolver?: ModifierRecipeResolver,
  ): Promise<KdsDepletionResult> {
    // 1. Check if any item contains modifiers
    const hasModifiers = event.items.some(
      (item) => item.selectedModifiers && item.selectedModifiers.length > 0,
    );

    if (hasModifiers && !customResolver) {
      // Quarantine modifier-bearing event durably with zero stock movements
      const quarantineRes = await client.query<{ id: string }>(
        `INSERT INTO inventory_quarantine_records (
          organization_id, branch_id, source_event_id, payload, reason, status
        ) VALUES ($1, $2, $3, $4, 'MODIFIER_RECIPE_RESOLUTION_PENDING', 'PENDING')
        ON CONFLICT (organization_id, branch_id, source_event_id)
        DO UPDATE SET payload = EXCLUDED.payload, reason = EXCLUDED.reason, status = 'PENDING'
        RETURNING id;`,
        [event.organizacionId, event.sucursalId, event.ordenId, JSON.stringify(event)],
      );

      return {
        status: 'QUARANTINED',
        ordenId: event.ordenId,
        quarantineId: quarantineRes.rows[0]!.id,
        reason: 'MODIFIER_RECIPE_RESOLUTION_PENDING',
      };
    }

    // 2. Idempotency Check: if CONSUMO_KDS movements already exist for this order
    const existingMovementsRes = await client.query<{
      id: string;
      organization_id: string;
      branch_id: string;
      warehouse_id: string;
      ingredient_id: string;
      movement_type: string;
      reference_event_id: string;
      quantity_delta: string;
      unit_cost: string;
      total_cost: string;
      balance_after: string;
      movement_sequence_number: string;
      created_at: Date | string;
    }>(
      `SELECT id, organization_id, branch_id, warehouse_id, ingredient_id, movement_type,
              reference_event_id, quantity_delta::text, unit_cost::text, total_cost::text,
              balance_after::text, movement_sequence_number::text, created_at
       FROM stock_ledger
       WHERE organization_id = $1 AND branch_id = $2 AND warehouse_id = $3
         AND movement_type = 'CONSUMO_KDS' AND reference_event_id = $4
       ORDER BY movement_sequence_number ASC;`,
      [event.organizacionId, event.sucursalId, event.centroConsumoId, event.ordenId],
    );

    if (existingMovementsRes.rows.length > 0) {
      // Query outbox event
      const outboxRes = await client.query<{ id: string }>(
        `SELECT id FROM cloud_integration_outbox
         WHERE organization_id = $1 AND aggregate_type = 'INVENTORY_STOCK' AND aggregate_id = $2
         LIMIT 1;`,
        [event.organizacionId, event.ordenId],
      );

      const movements: StockLedgerEntry[] = existingMovementsRes.rows.map((row) => ({
        id: row.id,
        organizationId: row.organization_id,
        branchId: row.branch_id,
        warehouseId: row.warehouse_id,
        ingredientId: row.ingredient_id,
        movementType: row.movement_type as any,
        referenceEventId: row.reference_event_id,
        quantityDelta: row.quantity_delta,
        unitCost: row.unit_cost,
        totalCost: row.total_cost,
        balanceAfter: row.balance_after,
        movementSequenceNumber: row.movement_sequence_number,
        createdAt:
          typeof row.created_at === 'string' ? row.created_at : row.created_at.toISOString(),
      }));

      return {
        status: 'DUPLICATE_ACCEPTED',
        ordenId: event.ordenId,
        movements,
        negativeStockAlerts: [],
        outboxEventId: outboxRes.rows[0]?.id ?? 'UNKNOWN',
      };
    }

    // 3. Resolve recipes & explode ingredients for all items
    // First: if customResolver is present and modifiers exist, resolve ALL modifier impacts upfront.
    // If ANY modifier cannot be resolved (returns null/undefined or throws), FAIL CLOSED:
    // Quarantine entire event with ZERO ledger movements and ZERO outbox effects.
    const resolvedItemModifiers = new Map<
      number,
      {
        removedIngredientIds: Set<string>;
        additionalItems: { ingredientId: string; grossQuantityScaled: bigint }[];
      }
    >();

    if (hasModifiers && customResolver) {
      for (let i = 0; i < event.items.length; i++) {
        const item = event.items[i]!;
        if (!item.selectedModifiers || item.selectedModifiers.length === 0) {
          continue;
        }

        const recipe = await this.getRecipeByProductIdWithClient(
          client,
          event.organizacionId,
          item.productoId,
        );
        if (!recipe) {
          throw new RecipeNotFoundError(
            `No recipe found for product '${item.productoId}' in organization '${event.organizacionId}'`,
          );
        }

        const removedIngredientIds = new Set<string>();
        const additionalItems: { ingredientId: string; grossQuantityScaled: bigint }[] = [];

        for (const mod of item.selectedModifiers) {
          let impact: ResolvedModifierImpact | null = null;
          try {
            impact = await customResolver.resolveModifierImpact({
              organizationId: event.organizacionId,
              recipeId: recipe.id,
              modifierId: mod.modifierId,
              quantity: mod.quantity ?? '1.0000',
            });
          } catch {
            impact = null;
          }

          if (!impact) {
            // Incomplete / unresolvable modifier resolution -> Quarantine entire event fail-closed
            const quarantineRes = await client.query<{ id: string }>(
              `INSERT INTO inventory_quarantine_records (
                organization_id, branch_id, source_event_id, payload, reason, status
              ) VALUES ($1, $2, $3, $4, 'MODIFIER_RECIPE_RESOLUTION_PENDING', 'PENDING')
              ON CONFLICT (organization_id, branch_id, source_event_id)
              DO UPDATE SET payload = EXCLUDED.payload, reason = EXCLUDED.reason, status = 'PENDING'
              RETURNING id;`,
              [event.organizacionId, event.sucursalId, event.ordenId, JSON.stringify(event)],
            );

            return {
              status: 'QUARANTINED',
              ordenId: event.ordenId,
              quarantineId: quarantineRes.rows[0]!.id,
              reason: 'MODIFIER_RECIPE_RESOLUTION_PENDING',
            };
          }

          if (impact.removedIngredients) {
            for (const rem of impact.removedIngredients) {
              removedIngredientIds.add(rem.ingredientId);
            }
          }

          if (impact.additionalIngredients) {
            for (const add of impact.additionalIngredients) {
              const addGrossScaled = parseDecimal12x4(add.grossQuantity);
              additionalItems.push({
                ingredientId: add.ingredientId,
                grossQuantityScaled: addGrossScaled,
              });
            }
          }
        }

        resolvedItemModifiers.set(i, { removedIngredientIds, additionalItems });
      }
    }

    const rawIngredientItems: { ingredientId: string; grossScaled: bigint }[] = [];

    for (let i = 0; i < event.items.length; i++) {
      const item = event.items[i]!;
      const itemQtyScaled = parseDecimal12x4(item.cantidad);
      if (itemQtyScaled <= 0n) {
        continue;
      }

      const recipe = await this.getRecipeByProductIdWithClient(
        client,
        event.organizacionId,
        item.productoId,
      );
      if (!recipe) {
        throw new RecipeNotFoundError(
          `No recipe found for product '${item.productoId}' in organization '${event.organizacionId}'`,
        );
      }

      const recipeYieldScaled = parseDecimal12x4(recipe.yieldQuantity);
      const itemScaleFactor = divideScale4(itemQtyScaled, recipeYieldScaled);

      const recipeResolver = async (subId: string) => {
        return this.getRecipeWithClient(client, event.organizacionId, subId);
      };

      const exploded = await RecipeEngine.explodeIngredients(recipe, recipeResolver);
      const itemModInfo = resolvedItemModifiers.get(i);

      for (const exp of exploded) {
        // If an ingredient is removed by a resolved modifier for this item, omit it
        if (itemModInfo && itemModInfo.removedIngredientIds.has(exp.ingredientId)) {
          continue;
        }

        const expGrossScaled = parseDecimal12x4(exp.totalGrossQuantity);
        const scaledRequiredGross = multiplyScale4(expGrossScaled, itemScaleFactor);
        rawIngredientItems.push({
          ingredientId: exp.ingredientId,
          grossScaled: scaledRequiredGross,
        });
      }

      // Add additional ingredients from resolved modifiers for this item
      if (itemModInfo && itemModInfo.additionalItems.length > 0) {
        for (const add of itemModInfo.additionalItems) {
          const scaledAddGross = multiplyScale4(add.grossQuantityScaled, itemScaleFactor);
          rawIngredientItems.push({
            ingredientId: add.ingredientId,
            grossScaled: scaledAddGross,
          });
        }
      }
    }

    // 4. Deterministically aggregate gross ingredient quantities
    const aggregatedIngredients = aggregateIngredientQuantities(rawIngredientItems);

    const movements: StockLedgerEntry[] = [];
    const negativeStockAlerts: NegativeStockSignal[] = [];
    const outboxMovementItems: InventarioDescontadoMovementItem[] = [];

    // 5. Process each ingredient under advisory lock
    for (const agg of aggregatedIngredients) {
      if (agg.totalGrossScaled === 0n) {
        continue;
      }

      await this.acquireAggregateLock(
        client,
        event.organizacionId,
        event.sucursalId,
        event.centroConsumoId,
        agg.ingredientId,
      );

      const unitCostStr = await this.getIngredientAverageCostWithClient(
        client,
        event.organizacionId,
        agg.ingredientId,
      );
      const unitCostScaled = parseDecimal12x4(unitCostStr);
      const quantityDeltaScaled = negateScale4(agg.totalGrossScaled);
      const totalCostScaled = multiplyScale4(agg.totalGrossScaled, unitCostScaled);

      const priorBalanceScaled = await this.getDerivedPriorBalanceWithClient(
        client,
        event.organizacionId,
        event.sucursalId,
        event.centroConsumoId,
        agg.ingredientId,
      );
      const nextSequence = await this.getNextSequenceWithClient(
        client,
        event.organizacionId,
        event.sucursalId,
        event.centroConsumoId,
        agg.ingredientId,
      );

      const balanceAfterScaled = addScale4(priorBalanceScaled, quantityDeltaScaled);
      const balanceAfterStr = formatDecimal12x4(balanceAfterScaled);

      const insertRes = await client.query<{
        id: string;
        organization_id: string;
        branch_id: string;
        warehouse_id: string;
        ingredient_id: string;
        movement_type: string;
        reference_event_id: string;
        quantity_delta: string;
        unit_cost: string;
        total_cost: string;
        balance_after: string;
        movement_sequence_number: string;
        created_at: Date | string;
      }>(
        `INSERT INTO stock_ledger (
          organization_id, branch_id, warehouse_id, ingredient_id,
          movement_type, reference_event_id, quantity_delta, unit_cost,
          total_cost, balance_after, movement_sequence_number
        ) VALUES ($1, $2, $3, $4, 'CONSUMO_KDS', $5, $6, $7, $8, $9, $10)
        RETURNING id, organization_id, branch_id, warehouse_id, ingredient_id,
                  movement_type, reference_event_id, quantity_delta::text,
                  unit_cost::text, total_cost::text, balance_after::text,
                  movement_sequence_number::text, created_at;`,
        [
          event.organizacionId,
          event.sucursalId,
          event.centroConsumoId,
          agg.ingredientId,
          event.ordenId,
          formatDecimal12x4(quantityDeltaScaled),
          formatDecimal12x4(unitCostScaled),
          formatDecimal12x4(totalCostScaled),
          balanceAfterStr,
          nextSequence,
        ],
      );

      const row = insertRes.rows[0]!;
      const createdAtStr =
        typeof row.created_at === 'string' ? row.created_at : row.created_at.toISOString();

      const entry: StockLedgerEntry = {
        id: row.id,
        organizationId: row.organization_id,
        branchId: row.branch_id,
        warehouseId: row.warehouse_id,
        ingredientId: row.ingredient_id,
        movementType: row.movement_type as any,
        referenceEventId: row.reference_event_id,
        quantityDelta: row.quantity_delta,
        unitCost: row.unit_cost,
        totalCost: row.total_cost,
        balanceAfter: row.balance_after,
        movementSequenceNumber: row.movement_sequence_number,
        createdAt: createdAtStr,
      };

      movements.push(entry);

      outboxMovementItems.push({
        ledgerId: row.id,
        ingredientId: row.ingredient_id,
        quantityDelta: row.quantity_delta,
        unitCost: row.unit_cost,
        totalCost: row.total_cost,
        balanceAfter: row.balance_after,
      });

      if (balanceAfterScaled < 0n) {
        negativeStockAlerts.push({
          organizationId: event.organizacionId,
          branchId: event.sucursalId,
          warehouseId: event.centroConsumoId,
          ingredientId: agg.ingredientId,
          balanceAfter: balanceAfterStr,
          timestamp: createdAtStr,
        });
      }
    }

    // 6. Enqueue InventarioDescontadoPorReceta into Cloud Integration Outbox (same transaction)
    const outboxPayload: InventarioDescontadoPorRecetaPayload = {
      organizationId: event.organizacionId,
      branchId: event.sucursalId,
      warehouseId: event.centroConsumoId,
      ordenId: event.ordenId,
      movements: outboxMovementItems,
      negativeStockAlerts,
      timestamp: new Date().toISOString(),
    };

    const outboxRecord = await this.outboxService.enqueue(client, {
      organizationId: event.organizacionId,
      branchId: event.sucursalId,
      eventType: 'InventarioDescontadoPorReceta',
      aggregateType: 'INVENTORY_STOCK',
      aggregateId: event.ordenId,
      payload: outboxPayload,
    });

    return {
      status: 'APPLIED',
      ordenId: event.ordenId,
      movements,
      negativeStockAlerts,
      outboxEventId: outboxRecord.id,
    };
  }

  /**
   * Replays a quarantined depletion record using an authorized ModifierRecipeResolver.
   * Single authoritative tenant transaction: locks quarantine record FOR UPDATE,
   * performs depletion, enqueues outbox, and updates quarantine status to REPLAYED.
   */
  public async replayQuarantinedDepletion(
    organizationId: string,
    quarantineId: string,
    resolver: ModifierRecipeResolver,
  ): Promise<KdsDepletionResult> {
    return withTenantTransaction(this.pool, organizationId, async (client) => {
      const qRes = await client.query<{
        id: string;
        organization_id: string;
        branch_id: string;
        source_event_id: string;
        payload: any;
        status: string;
      }>(
        `SELECT id, organization_id, branch_id, source_event_id, payload, status
         FROM inventory_quarantine_records
         WHERE organization_id = $1 AND id = $2
         FOR UPDATE;`,
        [organizationId, quarantineId],
      );

      if (qRes.rows.length === 0) {
        throw new Error(
          `Quarantine record '${quarantineId}' not found for organization '${organizationId}'`,
        );
      }

      const qRecord = qRes.rows[0]!;
      const eventPayload: KdsOrderProducedEventDTO =
        typeof qRecord.payload === 'string' ? JSON.parse(qRecord.payload) : qRecord.payload;

      // Apply depletion directly within the SAME client transaction
      const depletionResult = await this.applyKdsDepletionWithClient(
        client,
        eventPayload,
        resolver,
      );

      if (depletionResult.status === 'APPLIED' || depletionResult.status === 'DUPLICATE_ACCEPTED') {
        await client.query(
          `UPDATE inventory_quarantine_records
           SET status = 'REPLAYED', replayed_at = NOW()
           WHERE organization_id = $1 AND id = $2;`,
          [organizationId, quarantineId],
        );
      }

      return depletionResult;
    });
  }

  /**
   * Lists quarantine records for an organization.
   */
  public async getQuarantineRecords(
    organizationId: string,
    status?: 'PENDING' | 'REPLAYED' | 'REJECTED',
  ): Promise<readonly QuarantineRecord[]> {
    return withTenantTransaction(this.pool, organizationId, async (client) => {
      let query = `
        SELECT id, organization_id, branch_id, source_event_id, payload, reason, status,
               created_at, replayed_at
        FROM inventory_quarantine_records
        WHERE organization_id = $1
      `;
      const params: unknown[] = [organizationId];

      if (status) {
        query += ` AND status = $2`;
        params.push(status);
      }

      query += ` ORDER BY created_at DESC;`;

      const res = await client.query<{
        id: string;
        organization_id: string;
        branch_id: string;
        source_event_id: string;
        payload: any;
        reason: string;
        status: string;
        created_at: Date | string;
        replayed_at: Date | string | null;
      }>(query, params);

      return res.rows.map((row) => ({
        id: row.id,
        organizationId: row.organization_id,
        branchId: row.branch_id,
        sourceEventId: row.source_event_id,
        payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
        reason: row.reason,
        status: row.status as any,
        createdAt:
          typeof row.created_at === 'string' ? row.created_at : row.created_at.toISOString(),
        replayedAt: row.replayed_at
          ? typeof row.replayed_at === 'string'
            ? row.replayed_at
            : row.replayed_at.toISOString()
          : null,
      }));
    });
  }

  // ==========================================================================
  // Private Helper Methods (Scoped to Transaction Client)
  // ==========================================================================

  private async acquireAggregateLock(
    client: pg.PoolClient,
    organizationId: string,
    branchId: string,
    warehouseId: string,
    ingredientId: string,
  ): Promise<void> {
    const lockKey = `${organizationId}:${branchId}:${warehouseId}:${ingredientId}`;
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1));`, [lockKey]);
  }

  private async getDerivedPriorBalanceWithClient(
    client: pg.PoolClient,
    organizationId: string,
    branchId: string,
    warehouseId: string,
    ingredientId: string,
  ): Promise<bigint> {
    const res = await client.query<{ balance: string }>(
      `SELECT COALESCE(SUM(quantity_delta), 0.0000)::text AS balance
       FROM stock_ledger
       WHERE organization_id = $1 AND branch_id = $2 AND warehouse_id = $3 AND ingredient_id = $4;`,
      [organizationId, branchId, warehouseId, ingredientId],
    );
    const balanceRaw = res.rows[0]?.balance ?? '0.0000';
    return parseDecimal12x4(balanceRaw);
  }

  private async getNextSequenceWithClient(
    client: pg.PoolClient,
    organizationId: string,
    branchId: string,
    warehouseId: string,
    ingredientId: string,
  ): Promise<string> {
    const res = await client.query<{ next_seq: string }>(
      `SELECT (COALESCE(MAX(movement_sequence_number), 0) + 1)::text AS next_seq
       FROM stock_ledger
       WHERE organization_id = $1 AND branch_id = $2 AND warehouse_id = $3 AND ingredient_id = $4;`,
      [organizationId, branchId, warehouseId, ingredientId],
    );
    return res.rows[0]?.next_seq ?? '1';
  }

  private async getRecipeWithClient(
    client: pg.PoolClient,
    organizationId: string,
    recipeId: string,
  ): Promise<Recipe | null> {
    const recipeRes = await client.query<{
      id: string;
      organization_id: string;
      product_id: string | null;
      code: string;
      name: string;
      yield_quantity: string;
      yield_unit: string;
      total_cost: string;
      is_active: boolean;
      created_at: Date | string;
      updated_at: Date | string;
    }>(
      `SELECT id, organization_id, product_id, code, name, yield_quantity::text, yield_unit, total_cost::text, is_active, created_at, updated_at
       FROM recipes
       WHERE organization_id = $1 AND id = $2;`,
      [organizationId, recipeId],
    );

    if (recipeRes.rows.length === 0) {
      return null;
    }

    const r = recipeRes.rows[0]!;

    const itemsRes = await client.query<{
      id: string;
      organization_id: string;
      recipe_id: string;
      ingredient_id: string | null;
      sub_recipe_id: string | null;
      quantity: string;
      gross_quantity: string;
      unit_cost_snapshot: string;
      created_at: Date | string;
    }>(
      `SELECT id, organization_id, recipe_id, ingredient_id, sub_recipe_id, quantity::text, gross_quantity::text, unit_cost_snapshot::text, created_at
       FROM recipe_items
       WHERE organization_id = $1 AND recipe_id = $2
       ORDER BY created_at ASC, id ASC;`,
      [organizationId, recipeId],
    );

    const items: RecipeItem[] = itemsRes.rows.map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      recipeId: row.recipe_id,
      ingredientId: row.ingredient_id,
      subRecipeId: row.sub_recipe_id,
      quantity: row.quantity,
      grossQuantity: row.gross_quantity,
      unitCostSnapshot: row.unit_cost_snapshot,
      createdAt: typeof row.created_at === 'string' ? row.created_at : row.created_at.toISOString(),
    }));

    return {
      id: r.id,
      organizationId: r.organization_id,
      productId: r.product_id,
      code: r.code,
      name: r.name,
      yieldQuantity: r.yield_quantity,
      yieldUnit: r.yield_unit,
      totalCost: r.total_cost,
      isActive: r.is_active,
      items,
      createdAt: typeof r.created_at === 'string' ? r.created_at : r.created_at.toISOString(),
      updatedAt: typeof r.updated_at === 'string' ? r.updated_at : r.updated_at.toISOString(),
    };
  }

  private async getRecipeByProductIdWithClient(
    client: pg.PoolClient,
    organizationId: string,
    productId: string,
  ): Promise<Recipe | null> {
    const recipeRes = await client.query<{ id: string }>(
      `SELECT id FROM recipes WHERE organization_id = $1 AND product_id = $2 AND is_active = TRUE LIMIT 1;`,
      [organizationId, productId],
    );

    if (recipeRes.rows.length === 0) {
      return null;
    }

    return this.getRecipeWithClient(client, organizationId, recipeRes.rows[0]!.id);
  }

  private async getIngredientAverageCostWithClient(
    client: pg.PoolClient,
    organizationId: string,
    ingredientId: string,
  ): Promise<string> {
    const res = await client.query<{ current_average_cost: string }>(
      `SELECT current_average_cost::text FROM ingredients WHERE organization_id = $1 AND id = $2;`,
      [organizationId, ingredientId],
    );

    if (res.rows.length === 0) {
      throw new Error(`Ingredient '${ingredientId}' not found in organization '${organizationId}'`);
    }

    return res.rows[0]!.current_average_cost;
  }
}
