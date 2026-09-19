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
import {
  type Supplier,
  type CreateSupplierCommand,
  type PurchaseOrder,
  type PurchaseOrderItem,
  type CreatePurchaseOrderCommand,
  type PurchaseReceipt,
  type PurchaseReceiptItem,
  type ConfirmPurchaseReceiptCommand,
  type ConfirmReceiptResult,
  type RecepcionCompraRegistradaPayload,
  type PurchaseOrderStatus,
  type PurchasePriceVarianceAuthorizationPolicy,
  calculatePoItemLineAmount,
  calculatePoTotalAmount,
  validatePoTransition,
  validateCanCancelPo,
  calculateReceiptItemLineAmount,
  calculateReceiptTotalAmount,
  deriveCumulativeReceivingQuantities,
  evaluateOverReceipt,
  determinePostReceiptPoStatus,
  evaluatePriceVariance,
  cmpScale4,
  InvalidSupplierError,
  InvalidPurchaseOrderError,
  PurchaseOrderCancelledError,
  InvalidReceiptItemError,
  ReceiptIdempotencyConflictError,
  ReceiptOutboxIntegrityError,
  CreatePurchaseOrderItemInput,
} from '@trident/procurement';
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
   * 1. Transaction-scoped aggregate advisory lock FIRST preventing race conditions.
   * 2. Idempotency on commandId under lock with deterministic prior result reconstruction.
   * 3. Negative quantity_delta persisted in stock_ledger.
   * 4. Linked inventory_waste_records row created in the same transaction.
   * 5. Neutral NegativeStockSignal emitted if balance < 0 (both initially and on retry).
   */
  public async registerWaste(command: RegisterWasteCommand): Promise<{
    movement: StockLedgerEntry;
    wasteRecord: WasteRecord;
    negativeStockAlert: NegativeStockSignal | null;
  }> {
    validateWasteCommand(command);

    return withTenantTransaction(this.pool, command.organizationId, async (client) => {
      // 1. Concurrency serialization via transaction-scoped advisory lock FIRST
      await this.acquireAggregateLock(
        client,
        command.organizationId,
        command.branchId,
        command.warehouseId,
        command.ingredientId,
      );

      // 2. Idempotency Check under lock: if waste command was already applied, return existing record
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
        const balanceAfterScaled = parseDecimal12x4(el.balance_after);
        let negativeStockAlert: NegativeStockSignal | null = null;
        if (balanceAfterScaled < 0n) {
          negativeStockAlert = {
            organizationId: el.organization_id,
            branchId: el.branch_id,
            warehouseId: el.warehouse_id,
            ingredientId: el.ingredient_id,
            balanceAfter: el.balance_after,
            timestamp:
              typeof el.created_at === 'string' ? el.created_at : el.created_at.toISOString(),
          };
        }

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
          negativeStockAlert,
        };
      }

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
      // 1. Acquire source-event advisory lock FIRST (canonical lock order step 1) using stable event identity
      await this.acquireSourceEventLock(
        client,
        event.organizacionId,
        event.sucursalId,
        event.ordenId,
      );

      // 2. Execute depletion under held source-event lock
      return this.applyKdsDepletionLockedWithClient(client, event, customResolver);
    });
  }

  /**
   * Protected helper for backward-compatibility with callers/test harnesses that invoke
   * depletion with a client directly, acquiring source-event lock upfront.
   */
  protected async applyKdsDepletionWithClient(
    client: pg.PoolClient,
    event: KdsOrderProducedEventDTO,
    customResolver?: ModifierRecipeResolver,
  ): Promise<KdsDepletionResult> {
    await this.acquireSourceEventLock(
      client,
      event.organizacionId,
      event.sucursalId,
      event.ordenId,
    );
    return this.applyKdsDepletionLockedWithClient(client, event, customResolver);
  }

  /**
   * Internal transaction-client scoped implementation of KDS order depletion.
   * Assumes the caller transaction has already acquired the source-event advisory lock.
   * Guarantees that depletion, outbox enqueue, and quarantine reconciliation all commit
   * or roll back atomically within the caller-provided client transaction.
   *
   * Visibility: protected (accessible to Testable subclass for fault-injection testing).
   * Prohibited from direct public caller API surface.
   */
  protected async applyKdsDepletionLockedWithClient(
    client: pg.PoolClient,
    event: KdsOrderProducedEventDTO,
    customResolver?: ModifierRecipeResolver,
  ): Promise<KdsDepletionResult> {
    // 1. Idempotency Check FIRST: if CONSUMO_KDS movements already exist for this order
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
      // Query exact outbox event
      const outboxRes = await client.query<{ id: string }>(
        `SELECT id FROM cloud_integration_outbox
         WHERE organization_id = $1 AND branch_id = $2
           AND aggregate_type = 'INVENTORY_STOCK' AND aggregate_id = $3
           AND event_type = 'InventarioDescontadoPorReceta'
         LIMIT 1;`,
        [event.organizacionId, event.sucursalId, event.ordenId],
      );

      if (outboxRes.rows.length === 0) {
        throw new Error(
          `Integrity error: KDS order '${event.ordenId}' has applied stock movements in tenant '${event.organizacionId}' but missing required 'InventarioDescontadoPorReceta' outbox event`,
        );
      }

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

      const negativeStockAlerts: NegativeStockSignal[] = [];
      for (const row of existingMovementsRes.rows) {
        const balScaled = parseDecimal12x4(row.balance_after);
        if (balScaled < 0n) {
          negativeStockAlerts.push({
            organizationId: row.organization_id,
            branchId: row.branch_id,
            warehouseId: row.warehouse_id,
            ingredientId: row.ingredient_id,
            balanceAfter: row.balance_after,
            timestamp:
              typeof row.created_at === 'string' ? row.created_at : row.created_at.toISOString(),
          });
        }
      }

      return {
        status: 'DUPLICATE_ACCEPTED',
        ordenId: event.ordenId,
        movements,
        negativeStockAlerts,
        outboxEventId: outboxRes.rows[0]!.id,
      };
    }

    // 3. Check if any item contains modifiers
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

    // 4. Resolve recipes & explode ingredients for all items
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

    // 5. Deterministically aggregate gross ingredient quantities
    const aggregatedIngredients = aggregateIngredientQuantities(rawIngredientItems);

    const movements: StockLedgerEntry[] = [];
    const negativeStockAlerts: NegativeStockSignal[] = [];
    const outboxMovementItems: InventarioDescontadoMovementItem[] = [];

    // 6. Process each ingredient under advisory lock
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

    // 7. Enqueue InventarioDescontadoPorReceta into Cloud Integration Outbox (same transaction)
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
   * Single authoritative tenant transaction with CANONICAL LOCK ORDERING & STABLE SOURCE IDENTITY:
   * 1. Non-locking pre-read to obtain stable event identity (organization_id, branch_id, source_event_id)
   * 2. Source-event advisory lock (STEP 1) using stable (orgId, branchId, sourceEventId)
   * 3. Authoritative quarantine record FOR UPDATE (STEP 2)
   * 4. Invariant revalidation of locked record identity against pre-read
   * 5. Ingredient aggregate locks (STEP 3) inside applyKdsDepletionLockedWithClient using locked payload
   * Performs depletion, enqueues outbox, and updates quarantine status to REPLAYED.
   */
  public async replayQuarantinedDepletion(
    organizationId: string,
    quarantineId: string,
    resolver: ModifierRecipeResolver,
  ): Promise<KdsDepletionResult> {
    return withTenantTransaction(this.pool, organizationId, async (client) => {
      // 1. Non-locking pre-read to obtain stable event identity (organization_id, branch_id, source_event_id)
      const preRes = await client.query<{
        id: string;
        organization_id: string;
        branch_id: string;
        source_event_id: string;
        status: string;
      }>(
        `SELECT id, organization_id, branch_id, source_event_id, status
         FROM inventory_quarantine_records
         WHERE organization_id = $1 AND id = $2;`,
        [organizationId, quarantineId],
      );

      if (preRes.rows.length === 0) {
        throw new Error(
          `Quarantine record '${quarantineId}' not found for organization '${organizationId}'`,
        );
      }

      const preRecord = preRes.rows[0]!;

      // 2. STEP 1 IN CANONICAL LOCK ORDER: Acquire SOURCE-EVENT advisory lock FIRST using stable event identity
      await this.acquireSourceEventLock(
        client,
        organizationId,
        preRecord.branch_id,
        preRecord.source_event_id,
      );

      // 3. STEP 2 IN CANONICAL LOCK ORDER: Authoritative locked read with FOR UPDATE
      const lockedRes = await client.query<{
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

      if (lockedRes.rows.length === 0) {
        throw new Error(
          `Quarantine record '${quarantineId}' not found for organization '${organizationId}'`,
        );
      }

      const lockedRecord = lockedRes.rows[0]!;

      // Section 11: SOURCE IDENTITY REVALIDATION
      if (
        lockedRecord.organization_id !== organizationId ||
        lockedRecord.branch_id !== preRecord.branch_id ||
        lockedRecord.source_event_id !== preRecord.source_event_id
      ) {
        throw new Error(
          `Integrity error: Locked quarantine record '${quarantineId}' identity mismatch (pre-read: org=${organizationId}, branch=${preRecord.branch_id}, source=${preRecord.source_event_id}; locked: org=${lockedRecord.organization_id}, branch=${lockedRecord.branch_id}, source=${lockedRecord.source_event_id})`,
        );
      }

      // Section 10: Authoritative payload from locked read ONLY
      const eventPayload: KdsOrderProducedEventDTO =
        typeof lockedRecord.payload === 'string'
          ? JSON.parse(lockedRecord.payload)
          : lockedRecord.payload;

      // 4. Execute locked depletion (source lock already held)
      const depletionResult = await this.applyKdsDepletionLockedWithClient(
        client,
        eventPayload,
        resolver,
      );

      // 5. Update quarantine record to REPLAYED if applied or already duplicate accepted
      if (depletionResult.status === 'APPLIED' || depletionResult.status === 'DUPLICATE_ACCEPTED') {
        await client.query(
          `UPDATE inventory_quarantine_records
           SET status = 'REPLAYED', replayed_at = COALESCE(replayed_at, NOW())
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

  private async acquireSourceEventLock(
    client: pg.PoolClient,
    organizationId: string,
    branchId: string,
    sourceOrderId: string,
  ): Promise<void> {
    const lockKey = `KDS_SOURCE_EVENT:${organizationId}:${branchId}:${sourceOrderId}`;
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

export interface CloudProcurementCompositionService {
  createSupplier(command: CreateSupplierCommand): Promise<Supplier>;
  getSupplier(organizationId: string, supplierId: string): Promise<Supplier | null>;
  createPurchaseOrder(command: CreatePurchaseOrderCommand): Promise<PurchaseOrder>;
  getPurchaseOrder(organizationId: string, purchaseOrderId: string): Promise<PurchaseOrder | null>;
  sendPurchaseOrder(organizationId: string, purchaseOrderId: string): Promise<PurchaseOrder>;
  cancelPurchaseOrder(organizationId: string, purchaseOrderId: string): Promise<PurchaseOrder>;
  confirmPurchaseReceipt(
    command: ConfirmPurchaseReceiptCommand,
    priceVariancePolicy?: PurchasePriceVarianceAuthorizationPolicy,
  ): Promise<ConfirmReceiptResult>;
  getPurchaseReceipt(
    organizationId: string,
    purchaseReceiptId: string,
  ): Promise<PurchaseReceipt | null>;
}

export class PostgresProcurementService implements CloudProcurementCompositionService {
  private readonly pool: pg.Pool;
  private readonly outboxService: CloudIntegrationOutboxService;

  public constructor(pool?: pg.Pool, outboxService?: CloudIntegrationOutboxService) {
    this.pool = pool ?? getPool();
    this.outboxService = outboxService ?? new CloudIntegrationOutboxService();
  }

  public async createSupplier(command: CreateSupplierCommand): Promise<Supplier> {
    if (!command.code || command.code.trim().length === 0) {
      throw new InvalidSupplierError('Supplier code cannot be empty');
    }
    if (!command.tradeName || command.tradeName.trim().length === 0) {
      throw new InvalidSupplierError('Supplier trade name cannot be empty');
    }
    if (!command.taxId || command.taxId.trim().length === 0) {
      throw new InvalidSupplierError('Supplier tax ID cannot be empty');
    }
    const creditDays = command.creditDays ?? 0;
    if (creditDays < 0) {
      throw new InvalidSupplierError('Credit days must be non-negative');
    }
    const isActive = command.isActive ?? true;

    return withTenantTransaction(this.pool, command.organizationId, async (client) => {
      const res = await client.query<{
        id: string;
        organization_id: string;
        code: string;
        trade_name: string;
        tax_id: string;
        credit_days: number;
        is_active: boolean;
        created_at: string | Date;
      }>(
        `INSERT INTO suppliers (
          organization_id,
          code,
          trade_name,
          tax_id,
          credit_days,
          is_active
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING
          id,
          organization_id,
          code,
          trade_name,
          tax_id,
          credit_days,
          is_active,
          created_at;`,
        [
          command.organizationId,
          command.code.trim(),
          command.tradeName.trim(),
          command.taxId.trim(),
          creditDays,
          isActive,
        ],
      );

      const row = res.rows[0]!;
      return {
        id: row.id,
        organizationId: row.organization_id,
        code: row.code,
        tradeName: row.trade_name,
        taxId: row.tax_id,
        creditDays: row.credit_days,
        isActive: row.is_active,
        createdAt:
          typeof row.created_at === 'string' ? row.created_at : row.created_at.toISOString(),
      };
    });
  }

  public async getSupplier(organizationId: string, supplierId: string): Promise<Supplier | null> {
    return withTenantTransaction(this.pool, organizationId, async (client) => {
      const res = await client.query<{
        id: string;
        organization_id: string;
        code: string;
        trade_name: string;
        tax_id: string;
        credit_days: number;
        is_active: boolean;
        created_at: string | Date;
      }>(
        `SELECT id, organization_id, code, trade_name, tax_id, credit_days, is_active, created_at
         FROM suppliers
         WHERE organization_id = $1 AND id = $2;`,
        [organizationId, supplierId],
      );

      if (res.rows.length === 0) {
        return null;
      }

      const row = res.rows[0]!;
      return {
        id: row.id,
        organizationId: row.organization_id,
        code: row.code,
        tradeName: row.trade_name,
        taxId: row.tax_id,
        creditDays: row.credit_days,
        isActive: row.is_active,
        createdAt:
          typeof row.created_at === 'string' ? row.created_at : row.created_at.toISOString(),
      };
    });
  }

  public async createPurchaseOrder(command: CreatePurchaseOrderCommand): Promise<PurchaseOrder> {
    if (!command.orderNumber || command.orderNumber.trim().length === 0) {
      throw new InvalidPurchaseOrderError('Order number cannot be empty');
    }
    if (!command.items || command.items.length === 0) {
      throw new InvalidPurchaseOrderError('Purchase order must contain at least one line item');
    }

    // Pre-calculate line amounts and total amount
    const processedItems = command.items.map((item: CreatePurchaseOrderItemInput) => {
      const lineAmount = calculatePoItemLineAmount(item.orderedQuantity, item.unitCost);
      return {
        ingredientId: item.ingredientId,
        orderedQuantity: item.orderedQuantity,
        unitCost: item.unitCost,
        lineAmount,
      };
    });

    const totalAmount = calculatePoTotalAmount(processedItems);

    return withTenantTransaction(this.pool, command.organizationId, async (client) => {
      // Validate supplier exists and belongs to tenant
      const supCheck = await client.query(
        `SELECT id FROM suppliers WHERE organization_id = $1 AND id = $2 AND is_active = TRUE;`,
        [command.organizationId, command.supplierId],
      );
      if (supCheck.rows.length === 0) {
        throw new InvalidPurchaseOrderError(
          `Active supplier '${command.supplierId}' not found in organization`,
        );
      }

      // Validate branch exists and belongs to tenant
      const branchCheck = await client.query(
        `SELECT id FROM branches WHERE organization_id = $1 AND id = $2;`,
        [command.organizationId, command.branchId],
      );
      if (branchCheck.rows.length === 0) {
        throw new InvalidPurchaseOrderError(
          `Branch '${command.branchId}' not found in organization`,
        );
      }

      // Validate ingredients exist
      const ingredientIds = processedItems.map((i: { ingredientId: string }) => i.ingredientId);
      const ingCheck = await client.query(
        `SELECT id FROM ingredients WHERE organization_id = $1 AND id = ANY($2::uuid[]);`,
        [command.organizationId, ingredientIds],
      );
      if (ingCheck.rows.length !== ingredientIds.length) {
        throw new InvalidPurchaseOrderError(
          'One or more ingredient IDs do not exist in organization',
        );
      }

      // Insert purchase order
      const poRes = await client.query<{
        id: string;
        organization_id: string;
        branch_id: string;
        supplier_id: string;
        order_number: string;
        status: PurchaseOrderStatus;
        total_amount: string;
        created_at: string | Date;
        updated_at: string | Date;
      }>(
        `INSERT INTO purchase_orders (
          organization_id,
          branch_id,
          supplier_id,
          order_number,
          status,
          total_amount
        ) VALUES ($1, $2, $3, $4, 'DRAFT', $5)
        RETURNING
          id,
          organization_id,
          branch_id,
          supplier_id,
          order_number,
          status,
          total_amount::text,
          created_at,
          updated_at;`,
        [
          command.organizationId,
          command.branchId,
          command.supplierId,
          command.orderNumber.trim(),
          totalAmount,
        ],
      );

      const poRow = poRes.rows[0]!;
      const poId = poRow.id;

      // Insert items
      const savedItems: PurchaseOrderItem[] = [];
      for (const item of processedItems) {
        const itemRes = await client.query<{
          id: string;
          organization_id: string;
          purchase_order_id: string;
          ingredient_id: string;
          ordered_quantity: string;
          unit_cost: string;
          line_amount: string;
          created_at: string | Date;
        }>(
          `INSERT INTO purchase_order_items (
            organization_id,
            purchase_order_id,
            ingredient_id,
            ordered_quantity,
            unit_cost,
            line_amount
          ) VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING
            id,
            organization_id,
            purchase_order_id,
            ingredient_id,
            ordered_quantity::text,
            unit_cost::text,
            line_amount::text,
            created_at;`,
          [
            command.organizationId,
            poId,
            item.ingredientId,
            item.orderedQuantity,
            item.unitCost,
            item.lineAmount,
          ],
        );
        const ir = itemRes.rows[0]!;
        savedItems.push({
          id: ir.id,
          organizationId: ir.organization_id,
          purchaseOrderId: ir.purchase_order_id,
          ingredientId: ir.ingredient_id,
          orderedQuantity: ir.ordered_quantity,
          unitCost: ir.unit_cost,
          lineAmount: ir.line_amount,
          createdAt:
            typeof ir.created_at === 'string' ? ir.created_at : ir.created_at.toISOString(),
        });
      }

      return {
        id: poRow.id,
        organizationId: poRow.organization_id,
        branchId: poRow.branch_id,
        supplierId: poRow.supplier_id,
        orderNumber: poRow.order_number,
        status: poRow.status,
        totalAmount: poRow.total_amount,
        items: savedItems,
        createdAt:
          typeof poRow.created_at === 'string' ? poRow.created_at : poRow.created_at.toISOString(),
        updatedAt:
          typeof poRow.updated_at === 'string' ? poRow.updated_at : poRow.updated_at.toISOString(),
      };
    });
  }

  public async getPurchaseOrder(
    organizationId: string,
    purchaseOrderId: string,
  ): Promise<PurchaseOrder | null> {
    return withTenantTransaction(this.pool, organizationId, async (client) => {
      return this.getPurchaseOrderWithClient(client, organizationId, purchaseOrderId);
    });
  }

  public async sendPurchaseOrder(
    organizationId: string,
    purchaseOrderId: string,
  ): Promise<PurchaseOrder> {
    return withTenantTransaction(this.pool, organizationId, async (client) => {
      const poRes = await client.query<{
        id: string;
        organization_id: string;
        branch_id: string;
        supplier_id: string;
        order_number: string;
        status: PurchaseOrderStatus;
        total_amount: string;
        created_at: string | Date;
        updated_at: string | Date;
      }>(
        `SELECT id, organization_id, branch_id, supplier_id, order_number, status, total_amount::text, created_at, updated_at
         FROM purchase_orders
         WHERE organization_id = $1 AND id = $2
         FOR UPDATE;`,
        [organizationId, purchaseOrderId],
      );

      if (poRes.rows.length === 0) {
        throw new InvalidPurchaseOrderError(`Purchase order '${purchaseOrderId}' not found`);
      }

      const po = poRes.rows[0]!;
      validatePoTransition(po.status, 'SENT');

      await client.query(
        `UPDATE purchase_orders SET status = 'SENT', updated_at = NOW() WHERE organization_id = $1 AND id = $2;`,
        [organizationId, purchaseOrderId],
      );

      return this.getPurchaseOrderWithClient(
        client,
        organizationId,
        purchaseOrderId,
      ) as Promise<PurchaseOrder>;
    });
  }

  public async cancelPurchaseOrder(
    organizationId: string,
    purchaseOrderId: string,
  ): Promise<PurchaseOrder> {
    return withTenantTransaction(this.pool, organizationId, async (client) => {
      const poRes = await client.query<{
        id: string;
        organization_id: string;
        branch_id: string;
        supplier_id: string;
        order_number: string;
        status: PurchaseOrderStatus;
        total_amount: string;
        created_at: string | Date;
        updated_at: string | Date;
      }>(
        `SELECT id, organization_id, branch_id, supplier_id, order_number, status, total_amount::text, created_at, updated_at
         FROM purchase_orders
         WHERE organization_id = $1 AND id = $2
         FOR UPDATE;`,
        [organizationId, purchaseOrderId],
      );

      if (poRes.rows.length === 0) {
        throw new InvalidPurchaseOrderError(`Purchase order '${purchaseOrderId}' not found`);
      }

      const po = poRes.rows[0]!;

      // Check if any confirmed receipts exist
      const receiptCheck = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM purchase_receipts WHERE organization_id = $1 AND purchase_order_id = $2 AND status = 'CONFIRMED';`,
        [organizationId, purchaseOrderId],
      );
      const receiptCount = Number.parseInt(receiptCheck.rows[0]?.count ?? '0', 10);
      validateCanCancelPo(po.status, receiptCount > 0);

      await client.query(
        `UPDATE purchase_orders SET status = 'CANCELLED', updated_at = NOW() WHERE organization_id = $1 AND id = $2;`,
        [organizationId, purchaseOrderId],
      );

      return this.getPurchaseOrderWithClient(
        client,
        organizationId,
        purchaseOrderId,
      ) as Promise<PurchaseOrder>;
    });
  }

  public async confirmPurchaseReceipt(
    command: ConfirmPurchaseReceiptCommand,
    priceVariancePolicy?: PurchasePriceVarianceAuthorizationPolicy,
  ): Promise<ConfirmReceiptResult> {
    if (!command.receiptNumber || command.receiptNumber.trim().length === 0) {
      throw new InvalidReceiptItemError('Receipt number cannot be empty');
    }
    if (!command.items || command.items.length === 0) {
      throw new InvalidReceiptItemError('Receipt must contain at least one item');
    }

    return withTenantTransaction(this.pool, command.organizationId, async (client) => {
      // 1. Lock Purchase Order FOR UPDATE to serialize all concurrent receipts
      const poRes = await client.query<{
        id: string;
        organization_id: string;
        branch_id: string;
        supplier_id: string;
        order_number: string;
        status: PurchaseOrderStatus;
        total_amount: string;
      }>(
        `SELECT id, organization_id, branch_id, supplier_id, order_number, status, total_amount::text
         FROM purchase_orders
         WHERE organization_id = $1 AND id = $2
         FOR UPDATE;`,
        [command.organizationId, command.purchaseOrderId],
      );

      if (poRes.rows.length === 0) {
        throw new InvalidPurchaseOrderError(
          `Purchase order '${command.purchaseOrderId}' not found`,
        );
      }

      const po = poRes.rows[0]!;

      // Check idempotency: if receipt already exists by (organization_id, branch_id, receipt_number)
      const existingReceiptRes = await client.query<{
        id: string;
        organization_id: string;
        branch_id: string;
        purchase_order_id: string;
        supplier_id: string;
        warehouse_id: string;
        receipt_number: string;
        invoice_reference: string | null;
        total_amount: string;
        status: 'CONFIRMED' | 'CANCELLED';
        received_at: string | Date;
        created_at: string | Date;
      }>(
        `SELECT id, organization_id, branch_id, purchase_order_id, supplier_id, warehouse_id, receipt_number, invoice_reference, total_amount::text, status, received_at, created_at
         FROM purchase_receipts
         WHERE organization_id = $1 AND branch_id = $2 AND receipt_number = $3;`,
        [command.organizationId, command.branchId, command.receiptNumber.trim()],
      );

      if (existingReceiptRes.rows.length > 0) {
        const er = existingReceiptRes.rows[0]!;

        // 1. Revalidate stable identity
        if (
          er.purchase_order_id !== command.purchaseOrderId ||
          er.supplier_id !== command.supplierId ||
          er.warehouse_id !== command.warehouseId
        ) {
          throw new ReceiptIdempotencyConflictError(
            `Receipt number '${command.receiptNumber}' already exists with conflicting stable identity (purchaseOrderId, supplierId, or warehouseId mismatch)`,
          );
        }

        const existingItemsRes = await client.query<{
          id: string;
          organization_id: string;
          purchase_receipt_id: string;
          purchase_order_item_id: string;
          ingredient_id: string;
          received_quantity: string;
          accepted_unit_cost: string;
          line_amount: string;
          created_at: string | Date;
        }>(
          `SELECT id, organization_id, purchase_receipt_id, purchase_order_item_id, ingredient_id, received_quantity::text, accepted_unit_cost::text, line_amount::text, created_at
           FROM purchase_receipt_items
           WHERE organization_id = $1 AND purchase_receipt_id = $2;`,
          [command.organizationId, er.id],
        );

        const existingItems: PurchaseReceiptItem[] = existingItemsRes.rows.map((r) => ({
          id: r.id,
          organizationId: r.organization_id,
          purchaseReceiptId: r.purchase_receipt_id,
          purchaseOrderItemId: r.purchase_order_item_id,
          ingredientId: r.ingredient_id,
          receivedQuantity: r.received_quantity,
          acceptedUnitCost: r.accepted_unit_cost,
          lineAmount: r.line_amount,
          createdAt: typeof r.created_at === 'string' ? r.created_at : r.created_at.toISOString(),
        }));

        // 2. Line-level duplicate revalidation (order-independent comparison)
        if (existingItems.length !== command.items.length) {
          throw new ReceiptIdempotencyConflictError(
            `Receipt number '${command.receiptNumber}' already exists with conflicting number of items (existing: ${existingItems.length}, incoming: ${command.items.length})`,
          );
        }

        const sortedExisting = [...existingItems].sort((a, b) => {
          const c1 = a.purchaseOrderItemId.localeCompare(b.purchaseOrderItemId);
          return c1 !== 0 ? c1 : a.ingredientId.localeCompare(b.ingredientId);
        });

        const sortedIncoming = [...command.items].sort((a, b) => {
          const c1 = a.purchaseOrderItemId.localeCompare(b.purchaseOrderItemId);
          return c1 !== 0 ? c1 : a.ingredientId.localeCompare(b.ingredientId);
        });

        for (let i = 0; i < sortedExisting.length; i++) {
          const ex = sortedExisting[i]!;
          const inc = sortedIncoming[i]!;

          if (
            ex.purchaseOrderItemId !== inc.purchaseOrderItemId ||
            ex.ingredientId !== inc.ingredientId ||
            parseDecimal12x4(ex.receivedQuantity) !== parseDecimal12x4(inc.receivedQuantity) ||
            parseDecimal12x4(ex.acceptedUnitCost) !== parseDecimal12x4(inc.acceptedUnitCost)
          ) {
            throw new ReceiptIdempotencyConflictError(
              `Receipt number '${command.receiptNumber}' already exists with conflicting line details for item '${inc.purchaseOrderItemId}'`,
            );
          }
        }

        // 3. Authoritative prior-event reconstruction from durable cloud_integration_outbox
        const outboxRes = await client.query<{
          id: string;
          payload: any;
        }>(
          `SELECT id, payload
           FROM cloud_integration_outbox
           WHERE organization_id = $1
             AND branch_id = $2
             AND event_type = 'RecepcionCompraRegistrada'
             AND aggregate_type = 'PURCHASE_RECEIPT'
             AND aggregate_id = $3;`,
          [command.organizationId, command.branchId, er.id],
        );

        if (outboxRes.rows.length !== 1) {
          throw new ReceiptOutboxIntegrityError(
            `Expected exactly one canonical RecepcionCompraRegistrada event for receipt '${er.id}', found ${outboxRes.rows.length}`,
          );
        }

        const outboxRow = outboxRes.rows[0]!;
        const priorEventPayload: RecepcionCompraRegistradaPayload =
          typeof outboxRow.payload === 'string' ? JSON.parse(outboxRow.payload) : outboxRow.payload;

        const existingReceipt: PurchaseReceipt = {
          id: er.id,
          organizationId: er.organization_id,
          branchId: er.branch_id,
          purchaseOrderId: er.purchase_order_id,
          supplierId: er.supplier_id,
          warehouseId: er.warehouse_id,
          receiptNumber: er.receipt_number,
          invoiceReference: er.invoice_reference,
          totalAmount: er.total_amount,
          status: er.status,
          receivedAt:
            typeof er.received_at === 'string' ? er.received_at : er.received_at.toISOString(),
          createdAt:
            typeof er.created_at === 'string' ? er.created_at : er.created_at.toISOString(),
          items: existingItems,
        };

        return {
          status: 'DUPLICATE_ACCEPTED',
          receipt: existingReceipt,
          eventPayload: priorEventPayload,
          updatedPurchaseOrderStatus: po.status,
        };
      }

      if (po.status === 'CANCELLED') {
        throw new PurchaseOrderCancelledError(command.purchaseOrderId);
      }
      if (po.status === 'RECEIVED') {
        throw new InvalidPurchaseOrderError('Purchase order is already fully received');
      }
      if (po.status === 'DRAFT') {
        throw new InvalidPurchaseOrderError(
          'Cannot receive against DRAFT purchase order; order must be in SENT or PARTIAL status',
        );
      }
      if (po.supplier_id !== command.supplierId) {
        throw new InvalidPurchaseOrderError('Supplier does not match purchase order supplier');
      }
      if (po.branch_id !== command.branchId) {
        throw new InvalidPurchaseOrderError('Branch does not match purchase order branch');
      }

      // Validate warehouse belongs to organization and branch
      const whCheck = await client.query(
        `SELECT id FROM warehouses WHERE organization_id = $1 AND id = $2 AND branch_id = $3;`,
        [command.organizationId, command.warehouseId, command.branchId],
      );
      if (whCheck.rows.length === 0) {
        throw new InvalidReceiptItemError(
          `Warehouse '${command.warehouseId}' does not belong to organization and branch`,
        );
      }

      // Load all PO items with FOR UPDATE
      const allPoItemsRes = await client.query<{
        id: string;
        ingredient_id: string;
        ordered_quantity: string;
        unit_cost: string;
        line_amount: string;
      }>(
        `SELECT id, ingredient_id, ordered_quantity::text, unit_cost::text, line_amount::text
         FROM purchase_order_items
         WHERE organization_id = $1 AND purchase_order_id = $2
         FOR UPDATE;`,
        [command.organizationId, command.purchaseOrderId],
      );
      const allPoItems = allPoItemsRes.rows;
      const poItemMap = new Map(allPoItems.map((it) => [it.id, it]));

      // Validate and calculate receipt lines
      const processedReceiptLines: Array<{
        purchaseOrderItemId: string;
        ingredientId: string;
        orderedQuantity: string;
        previouslyReceivedQuantity: string;
        receivedQuantity: string;
        cumulativeReceivedQuantity: string;
        remainingQuantity: string;
        acceptedUnitCost: string;
        lineAmount: string;
      }> = [];

      for (const itemInput of command.items) {
        const poItem = poItemMap.get(itemInput.purchaseOrderItemId);
        if (!poItem) {
          throw new InvalidReceiptItemError(
            `Purchase order item '${itemInput.purchaseOrderItemId}' does not belong to purchase order '${command.purchaseOrderId}'`,
          );
        }
        if (poItem.ingredient_id !== itemInput.ingredientId) {
          throw new InvalidReceiptItemError(
            `Ingredient '${itemInput.ingredientId}' does not match purchase order item ingredient '${poItem.ingredient_id}'`,
          );
        }

        // Query cumulative previously received quantity for this PO item
        const prevRecRes = await client.query<{ total_received: string }>(
          `SELECT COALESCE(SUM(pri.received_quantity), 0.0000)::text AS total_received
           FROM purchase_receipt_items pri
           JOIN purchase_receipts pr ON pr.id = pri.purchase_receipt_id
           WHERE pr.organization_id = $1
             AND pri.purchase_order_item_id = $2
             AND pr.status = 'CONFIRMED';`,
          [command.organizationId, itemInput.purchaseOrderItemId],
        );
        const previouslyReceived = prevRecRes.rows[0]?.total_received ?? '0.0000';

        // 1. Evaluate price variance policy
        await evaluatePriceVariance(
          {
            organizationId: command.organizationId,
            branchId: command.branchId,
            supplierId: command.supplierId,
            ingredientId: itemInput.ingredientId,
            orderedUnitCost: poItem.unit_cost,
            receivedUnitCost: itemInput.acceptedUnitCost,
            supervisorAuthorizationToken: command.supervisorAuthorizationToken,
          },
          priceVariancePolicy,
        );

        // 2. Evaluate over-receipt (fail closed)
        evaluateOverReceipt(
          itemInput.ingredientId,
          poItem.ordered_quantity,
          previouslyReceived,
          itemInput.receivedQuantity,
        );

        // 3. Derive exact amounts & remaining
        const lineAmount = calculateReceiptItemLineAmount(
          itemInput.receivedQuantity,
          itemInput.acceptedUnitCost,
        );
        const cumResult = deriveCumulativeReceivingQuantities(
          poItem.ordered_quantity,
          previouslyReceived,
          itemInput.receivedQuantity,
        );

        processedReceiptLines.push({
          purchaseOrderItemId: itemInput.purchaseOrderItemId,
          ingredientId: itemInput.ingredientId,
          orderedQuantity: poItem.ordered_quantity,
          previouslyReceivedQuantity: previouslyReceived,
          receivedQuantity: itemInput.receivedQuantity,
          cumulativeReceivedQuantity: cumResult.cumulativeReceivedQuantity,
          remainingQuantity: cumResult.remainingQuantity,
          acceptedUnitCost: itemInput.acceptedUnitCost,
          lineAmount,
        });
      }

      const totalReceiptAmount = calculateReceiptTotalAmount(processedReceiptLines);

      // Insert purchase receipt
      const recRes = await client.query<{
        id: string;
        organization_id: string;
        branch_id: string;
        purchase_order_id: string;
        supplier_id: string;
        warehouse_id: string;
        receipt_number: string;
        invoice_reference: string | null;
        total_amount: string;
        status: 'CONFIRMED' | 'CANCELLED';
        received_at: string | Date;
        created_at: string | Date;
      }>(
        `INSERT INTO purchase_receipts (
          organization_id,
          branch_id,
          purchase_order_id,
          supplier_id,
          warehouse_id,
          receipt_number,
          invoice_reference,
          total_amount,
          status,
          received_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'CONFIRMED', COALESCE($9::timestamptz, NOW()))
        RETURNING
          id,
          organization_id,
          branch_id,
          purchase_order_id,
          supplier_id,
          warehouse_id,
          receipt_number,
          invoice_reference,
          total_amount::text,
          status,
          received_at,
          created_at;`,
        [
          command.organizationId,
          command.branchId,
          command.purchaseOrderId,
          command.supplierId,
          command.warehouseId,
          command.receiptNumber.trim(),
          command.invoiceReference?.trim() ?? null,
          totalReceiptAmount,
          command.receivedAt ?? null,
        ],
      );

      const receiptRow = recRes.rows[0]!;
      const receiptId = receiptRow.id;

      // Insert receipt items
      const savedReceiptItems: PurchaseReceiptItem[] = [];
      for (const line of processedReceiptLines) {
        const itemRes = await client.query<{
          id: string;
          organization_id: string;
          purchase_receipt_id: string;
          purchase_order_item_id: string;
          ingredient_id: string;
          received_quantity: string;
          accepted_unit_cost: string;
          line_amount: string;
          created_at: string | Date;
        }>(
          `INSERT INTO purchase_receipt_items (
            organization_id,
            purchase_receipt_id,
            purchase_order_item_id,
            ingredient_id,
            received_quantity,
            accepted_unit_cost,
            line_amount
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING
            id,
            organization_id,
            purchase_receipt_id,
            purchase_order_item_id,
            ingredient_id,
            received_quantity::text,
            accepted_unit_cost::text,
            line_amount::text,
            created_at;`,
          [
            command.organizationId,
            receiptId,
            line.purchaseOrderItemId,
            line.ingredientId,
            line.receivedQuantity,
            line.acceptedUnitCost,
            line.lineAmount,
          ],
        );
        const ir = itemRes.rows[0]!;
        savedReceiptItems.push({
          id: ir.id,
          organizationId: ir.organization_id,
          purchaseReceiptId: ir.purchase_receipt_id,
          purchaseOrderItemId: ir.purchase_order_item_id,
          ingredientId: ir.ingredient_id,
          receivedQuantity: ir.received_quantity,
          acceptedUnitCost: ir.accepted_unit_cost,
          lineAmount: ir.line_amount,
          createdAt:
            typeof ir.created_at === 'string' ? ir.created_at : ir.created_at.toISOString(),
        });
      }

      // Recompute whether all PO items are fully received
      let allItemsFullyReceived = true;
      for (const poItem of allPoItems) {
        const recSummary = await client.query<{ total_received: string }>(
          `SELECT COALESCE(SUM(pri.received_quantity), 0.0000)::text AS total_received
           FROM purchase_receipt_items pri
           JOIN purchase_receipts pr ON pr.id = pri.purchase_receipt_id
           WHERE pr.organization_id = $1
             AND pri.purchase_order_item_id = $2
             AND pr.status = 'CONFIRMED';`,
          [command.organizationId, poItem.id],
        );
        const totalReceived = recSummary.rows[0]?.total_received ?? '0.0000';
        if (cmpScale4(totalReceived, poItem.ordered_quantity) < 0) {
          allItemsFullyReceived = false;
        }
      }

      const updatedPoStatus = determinePostReceiptPoStatus(allItemsFullyReceived);
      await client.query(
        `UPDATE purchase_orders SET status = $1, updated_at = NOW() WHERE organization_id = $2 AND id = $3;`,
        [updatedPoStatus, command.organizationId, command.purchaseOrderId],
      );

      const createdReceipt: PurchaseReceipt = {
        id: receiptRow.id,
        organizationId: receiptRow.organization_id,
        branchId: receiptRow.branch_id,
        purchaseOrderId: receiptRow.purchase_order_id,
        supplierId: receiptRow.supplier_id,
        warehouseId: receiptRow.warehouse_id,
        receiptNumber: receiptRow.receipt_number,
        invoiceReference: receiptRow.invoice_reference,
        totalAmount: receiptRow.total_amount,
        status: receiptRow.status,
        receivedAt:
          typeof receiptRow.received_at === 'string'
            ? receiptRow.received_at
            : receiptRow.received_at.toISOString(),
        createdAt:
          typeof receiptRow.created_at === 'string'
            ? receiptRow.created_at
            : receiptRow.created_at.toISOString(),
        items: savedReceiptItems,
      };

      const eventPayload: RecepcionCompraRegistradaPayload = {
        recepcionId: createdReceipt.id,
        organizationId: createdReceipt.organizationId,
        branchId: createdReceipt.branchId,
        supplierId: createdReceipt.supplierId,
        purchaseOrderId: createdReceipt.purchaseOrderId,
        warehouseId: createdReceipt.warehouseId,
        receiptNumber: createdReceipt.receiptNumber,
        invoiceReference: createdReceipt.invoiceReference ?? null,
        receivedAt: createdReceipt.receivedAt,
        paymentTerms: command.paymentTerms ?? null,
        totalAmount: createdReceipt.totalAmount,
        items: processedReceiptLines.map((l) => ({
          ingredientId: l.ingredientId,
          purchaseOrderItemId: l.purchaseOrderItemId,
          orderedQuantity: l.orderedQuantity,
          previouslyReceivedQuantity: l.previouslyReceivedQuantity,
          receivedQuantity: l.receivedQuantity,
          cumulativeReceivedQuantity: l.cumulativeReceivedQuantity,
          remainingQuantity: l.remainingQuantity,
          acceptedUnitCost: l.acceptedUnitCost,
          lineAmount: l.lineAmount,
        })),
      };

      // Enqueue durable integration event in the SAME transaction
      await this.outboxService.enqueue(client, {
        organizationId: command.organizationId,
        branchId: command.branchId,
        eventType: 'RecepcionCompraRegistrada',
        aggregateType: 'PURCHASE_RECEIPT',
        aggregateId: createdReceipt.id,
        payload: eventPayload,
      });

      return {
        status: 'APPLIED',
        receipt: createdReceipt,
        eventPayload,
        updatedPurchaseOrderStatus: updatedPoStatus,
      };
    });
  }

  public async getPurchaseReceipt(
    organizationId: string,
    purchaseReceiptId: string,
  ): Promise<PurchaseReceipt | null> {
    return withTenantTransaction(this.pool, organizationId, async (client) => {
      const res = await client.query<{
        id: string;
        organization_id: string;
        branch_id: string;
        purchase_order_id: string;
        supplier_id: string;
        warehouse_id: string;
        receipt_number: string;
        invoice_reference: string | null;
        total_amount: string;
        status: 'CONFIRMED' | 'CANCELLED';
        received_at: string | Date;
        created_at: string | Date;
      }>(
        `SELECT id, organization_id, branch_id, purchase_order_id, supplier_id, warehouse_id, receipt_number, invoice_reference, total_amount::text, status, received_at, created_at
         FROM purchase_receipts
         WHERE organization_id = $1 AND id = $2;`,
        [organizationId, purchaseReceiptId],
      );

      if (res.rows.length === 0) {
        return null;
      }

      const r = res.rows[0]!;
      const itemsRes = await client.query<{
        id: string;
        organization_id: string;
        purchase_receipt_id: string;
        purchase_order_item_id: string;
        ingredient_id: string;
        received_quantity: string;
        accepted_unit_cost: string;
        line_amount: string;
        created_at: string | Date;
      }>(
        `SELECT id, organization_id, purchase_receipt_id, purchase_order_item_id, ingredient_id, received_quantity::text, accepted_unit_cost::text, line_amount::text, created_at
         FROM purchase_receipt_items
         WHERE organization_id = $1 AND purchase_receipt_id = $2;`,
        [organizationId, r.id],
      );

      const items: PurchaseReceiptItem[] = itemsRes.rows.map((row) => ({
        id: row.id,
        organizationId: row.organization_id,
        purchaseReceiptId: row.purchase_receipt_id,
        purchaseOrderItemId: row.purchase_order_item_id,
        ingredientId: row.ingredient_id,
        receivedQuantity: row.received_quantity,
        acceptedUnitCost: row.accepted_unit_cost,
        lineAmount: row.line_amount,
        createdAt:
          typeof row.created_at === 'string' ? row.created_at : row.created_at.toISOString(),
      }));

      return {
        id: r.id,
        organizationId: r.organization_id,
        branchId: r.branch_id,
        purchaseOrderId: r.purchase_order_id,
        supplierId: r.supplier_id,
        warehouseId: r.warehouse_id,
        receiptNumber: r.receipt_number,
        invoiceReference: r.invoice_reference,
        totalAmount: r.total_amount,
        status: r.status,
        receivedAt: typeof r.received_at === 'string' ? r.received_at : r.received_at.toISOString(),
        createdAt: typeof r.created_at === 'string' ? r.created_at : r.created_at.toISOString(),
        items,
      };
    });
  }

  private async getPurchaseOrderWithClient(
    client: pg.PoolClient,
    organizationId: string,
    purchaseOrderId: string,
  ): Promise<PurchaseOrder | null> {
    const res = await client.query<{
      id: string;
      organization_id: string;
      branch_id: string;
      supplier_id: string;
      order_number: string;
      status: PurchaseOrderStatus;
      total_amount: string;
      created_at: string | Date;
      updated_at: string | Date;
    }>(
      `SELECT id, organization_id, branch_id, supplier_id, order_number, status, total_amount::text, created_at, updated_at
       FROM purchase_orders
       WHERE organization_id = $1 AND id = $2;`,
      [organizationId, purchaseOrderId],
    );

    if (res.rows.length === 0) {
      return null;
    }

    const po = res.rows[0]!;
    const itemsRes = await client.query<{
      id: string;
      organization_id: string;
      purchase_order_id: string;
      ingredient_id: string;
      ordered_quantity: string;
      unit_cost: string;
      line_amount: string;
      created_at: string | Date;
    }>(
      `SELECT id, organization_id, purchase_order_id, ingredient_id, ordered_quantity::text, unit_cost::text, line_amount::text, created_at
       FROM purchase_order_items
       WHERE organization_id = $1 AND purchase_order_id = $2;`,
      [organizationId, po.id],
    );

    const items: PurchaseOrderItem[] = itemsRes.rows.map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      purchaseOrderId: row.purchase_order_id,
      ingredientId: row.ingredient_id,
      orderedQuantity: row.ordered_quantity,
      unitCost: row.unit_cost,
      lineAmount: row.line_amount,
      createdAt: typeof row.created_at === 'string' ? row.created_at : row.created_at.toISOString(),
    }));

    return {
      id: po.id,
      organizationId: po.organization_id,
      branchId: po.branch_id,
      supplierId: po.supplier_id,
      orderNumber: po.order_number,
      status: po.status,
      totalAmount: po.total_amount,
      items,
      createdAt: typeof po.created_at === 'string' ? po.created_at : po.created_at.toISOString(),
      updatedAt: typeof po.updated_at === 'string' ? po.updated_at : po.updated_at.toISOString(),
    };
  }
}

export * from '@trident/procurement';
