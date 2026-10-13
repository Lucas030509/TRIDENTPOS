/**
 * TRIDENTPOS Edge SQLite Dining Room & Account Persistence Adapter
 * Implements DiningRoomRepositoryPort and AccountRepositoryPort from @trident/pos.
 * Adapts to EdgeDatabaseService per ADR-012, ADR-013, and DATA_MODEL.md.
 * Persists all monetary and tax fields as scale-4 signed integers.
 */

import {
  type AccountRepositoryPort,
  type AccountType,
  type Cuenta,
  type CuentaItem,
  type CuentaItemModificador,
  type CuentaItemStatus,
  type CuentaStatus,
  type DiningRoomRepositoryPort,
  type Mesa,
  type MesaStatus,
  DomainError,
  OCCConflictError,
} from '@trident/pos';
import { EdgeDatabaseService } from '@trident/edge';
import { POS_EDGE_SQLITE_SCHEMA } from './schema.js';

interface MesaRow {
  id: string;
  room_name: string;
  table_number: string;
  status: string;
  current_account_id: string | null;
  pos_x?: number | null;
  pos_y?: number | null;
  capacity?: number | null;
  version: number;
  updated_at: string;
}

interface CuentaRow {
  id: string;
  folio_number: number | null;
  epoch_id: string;
  mesa_id: string | null;
  account_type: string;
  status: string;
  subtotal: number | bigint;
  tax_total: number | bigint;
  discounts_total: number | bigint;
  tips_total: number | bigint;
  total_amount: number | bigint;
  opened_by_user_id: string;
  current_waiter_user_id?: string | null;
  guest_count?: number | null;
  opened_at: string;
  printed_at?: string | null;
  closed_at: string | null;
  parent_cuenta_id?: string | null;
  split_sequence?: number | null;
  version: number;
  updated_at: string;
}

interface CuentaItemRow {
  id: string;
  cuenta_id: string;
  product_id: string;
  product_name_snapshot: string;
  unit_price_applied: number | bigint;
  quantity: number | bigint;
  tax_rate_applied: number | bigint;
  tax_amount_applied: number | bigint;
  discount_amount_applied: number | bigint;
  subtotal: number | bigint;
  total: number | bigint;
  status: string;
  cancellation_reason?: string | null;
  cancelled_by_user_id?: string | null;
  cancelled_at?: string | null;
  requires_waste_record?: number | null;
  created_at: string;
}

interface CuentaItemModificadorRow {
  id: string;
  cuenta_item_id: string;
  modifier_id: string;
  modifier_name_snapshot: string;
  modifier_price_applied: number | bigint;
}

export class SqliteDiningRoomRepository implements DiningRoomRepositoryPort, AccountRepositoryPort {
  readonly #db: EdgeDatabaseService;

  constructor(db: EdgeDatabaseService) {
    this.#db = db;
    this.bootstrapSchema();
  }

  public bootstrapSchema(): void {
    this.#db.executeSchema(POS_EDGE_SQLITE_SCHEMA);

    // Additive non-breaking column migrations for existing tables
    const migrations = [
      'ALTER TABLE mesas ADD COLUMN pos_x INTEGER NULL;',
      'ALTER TABLE mesas ADD COLUMN pos_y INTEGER NULL;',
      'ALTER TABLE mesas ADD COLUMN capacity INTEGER NULL;',
      'ALTER TABLE cuentas ADD COLUMN current_waiter_user_id TEXT NULL;',
      'ALTER TABLE cuentas ADD COLUMN guest_count INTEGER NULL DEFAULT 1;',
      'ALTER TABLE cuentas ADD COLUMN printed_at TEXT NULL;',
      'ALTER TABLE cuentas ADD COLUMN parent_cuenta_id TEXT NULL;',
      'ALTER TABLE cuentas ADD COLUMN split_sequence INTEGER NULL;',
      'ALTER TABLE cuenta_items ADD COLUMN cancellation_reason TEXT NULL;',
      'ALTER TABLE cuenta_items ADD COLUMN cancelled_by_user_id TEXT NULL;',
      'ALTER TABLE cuenta_items ADD COLUMN cancelled_at TEXT NULL;',
      'ALTER TABLE cuenta_items ADD COLUMN requires_waste_record INTEGER NULL DEFAULT 0;',
    ];

    for (const sql of migrations) {
      try {
        this.#db.executeSchema(sql);
      } catch {
        // Column already exists in schema, continue safely
      }
    }
  }

  // ==========================================
  // Mesa / Dining Room Repository Operations
  // ==========================================

  public getMesaByIdSync(id: string): Mesa | null {
    const row = this.#db.queryRowSafe<MesaRow>(
      'SELECT id, room_name, table_number, status, current_account_id, pos_x, pos_y, capacity, version, updated_at FROM mesas WHERE id = ?;',
      id,
    );

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      roomName: row.room_name,
      tableNumber: row.table_number,
      status: row.status as MesaStatus,
      currentAccountId: row.current_account_id,
      posX: row.pos_x !== undefined && row.pos_x !== null ? Number(row.pos_x) : null,
      posY: row.pos_y !== undefined && row.pos_y !== null ? Number(row.pos_y) : null,
      capacity: row.capacity !== undefined && row.capacity !== null ? Number(row.capacity) : null,
      version: Number(row.version),
      updatedAt: row.updated_at,
    };
  }

  public async getMesaById(id: string): Promise<Mesa | null> {
    return this.getMesaByIdSync(id);
  }

  public saveMesaSync(mesa: Mesa, expectedVersion: number): Mesa {
    if (expectedVersion === 0) {
      // New insert
      const existing = this.getMesaByIdSync(mesa.id);
      if (existing) {
        throw new DomainError(`Mesa '${mesa.id}' already exists`, 'DUPLICATE_MESA', 409);
      }

      this.#db.executeMutation(
        `INSERT INTO mesas (id, room_name, table_number, status, current_account_id, pos_x, pos_y, capacity, version, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        mesa.id,
        mesa.roomName,
        mesa.tableNumber,
        mesa.status,
        mesa.currentAccountId,
        mesa.posX ?? null,
        mesa.posY ?? null,
        mesa.capacity ?? null,
        mesa.version,
        mesa.updatedAt,
      );

      return mesa;
    }

    // OCC update with CAS (Compare-And-Swap)
    const result = this.#db.executeMutation(
      `UPDATE mesas
       SET room_name = ?, table_number = ?, status = ?, current_account_id = ?, pos_x = ?, pos_y = ?, capacity = ?, version = ?, updated_at = ?
       WHERE id = ? AND version = ?;`,
      mesa.roomName,
      mesa.tableNumber,
      mesa.status,
      mesa.currentAccountId,
      mesa.posX ?? null,
      mesa.posY ?? null,
      mesa.capacity ?? null,
      mesa.version,
      mesa.updatedAt,
      mesa.id,
      expectedVersion,
    );

    if (result.changes === 0) {
      const current = this.getMesaByIdSync(mesa.id);
      throw new OCCConflictError(mesa.id, expectedVersion, current ? current.version : 0, current);
    }

    return mesa;
  }

  public async saveMesa(mesa: Mesa, expectedVersion: number): Promise<Mesa> {
    return this.saveMesaSync(mesa, expectedVersion);
  }

  public listMesasSync(): readonly Mesa[] {
    const rows = this.#db.queryRowsSafe<MesaRow>(
      'SELECT id, room_name, table_number, status, current_account_id, pos_x, pos_y, capacity, version, updated_at FROM mesas ORDER BY table_number ASC;',
    );

    return rows.map((row) => ({
      id: row.id,
      roomName: row.room_name,
      tableNumber: row.table_number,
      status: row.status as MesaStatus,
      currentAccountId: row.current_account_id,
      posX: row.pos_x !== undefined && row.pos_x !== null ? Number(row.pos_x) : null,
      posY: row.pos_y !== undefined && row.pos_y !== null ? Number(row.pos_y) : null,
      capacity: row.capacity !== undefined && row.capacity !== null ? Number(row.capacity) : null,
      version: Number(row.version),
      updatedAt: row.updated_at,
    }));
  }

  public async listMesas(): Promise<readonly Mesa[]> {
    return this.listMesasSync();
  }

  // ==========================================
  // Cuenta / Orders Repository Operations
  // ==========================================

  public getCuentaByIdSync(id: string): Cuenta | null {
    const row = this.#db.queryRowSafe<CuentaRow>(
      `SELECT id, folio_number, epoch_id, mesa_id, account_type, status,
              subtotal, tax_total, discounts_total, tips_total, total_amount,
              opened_by_user_id, current_waiter_user_id, guest_count,
              opened_at, printed_at, closed_at, parent_cuenta_id, split_sequence,
              version, updated_at
       FROM cuentas WHERE id = ?;`,
      id,
    );

    if (!row) {
      return null;
    }

    const itemRows = this.#db.queryRowsSafe<CuentaItemRow>(
      `SELECT id, cuenta_id, product_id, product_name_snapshot,
              unit_price_applied, quantity, tax_rate_applied, tax_amount_applied,
              discount_amount_applied, subtotal, total, status,
              cancellation_reason, cancelled_by_user_id, cancelled_at, requires_waste_record,
              created_at
       FROM cuenta_items WHERE cuenta_id = ? ORDER BY created_at ASC;`,
      id,
    );

    const items: CuentaItem[] = [];
    for (const itemRow of itemRows) {
      const modRows = this.#db.queryRowsSafe<CuentaItemModificadorRow>(
        `SELECT id, cuenta_item_id, modifier_id, modifier_name_snapshot, modifier_price_applied
         FROM cuenta_item_modificadores WHERE cuenta_item_id = ?;`,
        itemRow.id,
      );

      const modifiers: CuentaItemModificador[] = modRows.map((m) => ({
        id: m.id,
        cuentaItemId: m.cuenta_item_id,
        modifierId: m.modifier_id,
        modifierNameSnapshot: m.modifier_name_snapshot,
        modifierPriceApplied: BigInt(m.modifier_price_applied),
      }));

      items.push({
        id: itemRow.id,
        cuentaId: itemRow.cuenta_id,
        productId: itemRow.product_id,
        productNameSnapshot: itemRow.product_name_snapshot,
        unitPriceApplied: BigInt(itemRow.unit_price_applied),
        quantity: BigInt(itemRow.quantity),
        taxRateApplied: BigInt(itemRow.tax_rate_applied),
        taxAmountApplied: BigInt(itemRow.tax_amount_applied),
        discountAmountApplied: BigInt(itemRow.discount_amount_applied),
        subtotal: BigInt(itemRow.subtotal),
        total: BigInt(itemRow.total),
        status: itemRow.status as CuentaItemStatus,
        cancellationReason: itemRow.cancellation_reason ?? null,
        cancelledByUserId: itemRow.cancelled_by_user_id ?? null,
        cancelledAt: itemRow.cancelled_at ?? null,
        requiresWasteRecord: Boolean(itemRow.requires_waste_record),
        createdAt: itemRow.created_at,
        modifiers,
      });
    }

    return {
      id: row.id,
      folioNumber:
        row.folio_number !== null && row.folio_number !== undefined
          ? Number(row.folio_number)
          : null,
      epochId: row.epoch_id,
      mesaId: row.mesa_id,
      accountType: row.account_type as AccountType,
      status: row.status as CuentaStatus,
      subtotal: BigInt(row.subtotal),
      taxTotal: BigInt(row.tax_total),
      discountsTotal: BigInt(row.discounts_total),
      tipsTotal: BigInt(row.tips_total),
      totalAmount: BigInt(row.total_amount),
      openedByUserId: row.opened_by_user_id,
      currentWaiterUserId: row.current_waiter_user_id ?? null,
      guestCount:
        row.guest_count !== undefined && row.guest_count !== null ? Number(row.guest_count) : 1,
      openedAt: row.opened_at,
      printedAt: row.printed_at ?? null,
      closedAt: row.closed_at,
      parentCuentaId: row.parent_cuenta_id ?? null,
      splitSequence:
        row.split_sequence !== undefined && row.split_sequence !== null
          ? Number(row.split_sequence)
          : null,
      version: Number(row.version),
      updatedAt: row.updated_at,
      items,
    };
  }

  public async getCuentaById(id: string): Promise<Cuenta | null> {
    return this.getCuentaByIdSync(id);
  }

  public saveCuentaSync(cuenta: Cuenta, expectedVersion: number): Cuenta {
    if (expectedVersion === 0) {
      // New insert
      const existing = this.getCuentaByIdSync(cuenta.id);
      if (existing) {
        throw new DomainError(`Cuenta '${cuenta.id}' already exists`, 'DUPLICATE_CUENTA', 409);
      }

      this.#db.executeMutation(
        `INSERT INTO cuentas (
           id, folio_number, epoch_id, mesa_id, account_type, status,
           subtotal, tax_total, discounts_total, tips_total, total_amount,
           opened_by_user_id, current_waiter_user_id, guest_count,
           opened_at, printed_at, closed_at, parent_cuenta_id, split_sequence,
           version, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        cuenta.id,
        cuenta.folioNumber,
        cuenta.epochId,
        cuenta.mesaId,
        cuenta.accountType,
        cuenta.status,
        cuenta.subtotal,
        cuenta.taxTotal,
        cuenta.discountsTotal,
        cuenta.tipsTotal,
        cuenta.totalAmount,
        cuenta.openedByUserId,
        cuenta.currentWaiterUserId ?? null,
        cuenta.guestCount ?? 1,
        cuenta.openedAt,
        cuenta.printedAt ?? null,
        cuenta.closedAt,
        cuenta.parentCuentaId ?? null,
        cuenta.splitSequence ?? null,
        cuenta.version,
        cuenta.updatedAt,
      );

      this.#persistItemsAndModifiers(cuenta.items);
      return cuenta;
    }

    // OCC update with CAS (Compare-And-Swap)
    const result = this.#db.executeMutation(
      `UPDATE cuentas
       SET folio_number = ?, epoch_id = ?, mesa_id = ?, account_type = ?, status = ?,
           subtotal = ?, tax_total = ?, discounts_total = ?, tips_total = ?, total_amount = ?,
           current_waiter_user_id = ?, guest_count = ?, printed_at = ?, closed_at = ?,
           parent_cuenta_id = ?, split_sequence = ?, version = ?, updated_at = ?
       WHERE id = ? AND version = ?;`,
      cuenta.folioNumber,
      cuenta.epochId,
      cuenta.mesaId,
      cuenta.accountType,
      cuenta.status,
      cuenta.subtotal,
      cuenta.taxTotal,
      cuenta.discountsTotal,
      cuenta.tipsTotal,
      cuenta.totalAmount,
      cuenta.currentWaiterUserId ?? null,
      cuenta.guestCount ?? 1,
      cuenta.printedAt ?? null,
      cuenta.closedAt,
      cuenta.parentCuentaId ?? null,
      cuenta.splitSequence ?? null,
      cuenta.version,
      cuenta.updatedAt,
      cuenta.id,
      expectedVersion,
    );

    if (result.changes === 0) {
      const current = this.getCuentaByIdSync(cuenta.id);
      throw new OCCConflictError(
        cuenta.id,
        expectedVersion,
        current ? current.version : 0,
        current,
      );
    }

    this.#persistItemsAndModifiers(cuenta.items);
    return cuenta;
  }

  public async saveCuenta(cuenta: Cuenta, expectedVersion: number): Promise<Cuenta> {
    return this.saveCuentaSync(cuenta, expectedVersion);
  }

  #persistItemsAndModifiers(items: readonly CuentaItem[]): void {
    for (const item of items) {
      this.#db.executeMutation(
        `INSERT INTO cuenta_items (
           id, cuenta_id, product_id, product_name_snapshot,
           unit_price_applied, quantity, tax_rate_applied, tax_amount_applied,
           discount_amount_applied, subtotal, total, status,
           cancellation_reason, cancelled_by_user_id, cancelled_at, requires_waste_record,
           created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status = excluded.status,
           unit_price_applied = excluded.unit_price_applied,
           quantity = excluded.quantity,
           tax_rate_applied = excluded.tax_rate_applied,
           tax_amount_applied = excluded.tax_amount_applied,
           discount_amount_applied = excluded.discount_amount_applied,
           subtotal = excluded.subtotal,
           total = excluded.total,
           cancellation_reason = excluded.cancellation_reason,
           cancelled_by_user_id = excluded.cancelled_by_user_id,
           cancelled_at = excluded.cancelled_at,
           requires_waste_record = excluded.requires_waste_record;`,
        item.id,
        item.cuentaId,
        item.productId,
        item.productNameSnapshot,
        item.unitPriceApplied,
        item.quantity,
        item.taxRateApplied,
        item.taxAmountApplied,
        item.discountAmountApplied,
        item.subtotal,
        item.total,
        item.status,
        item.cancellationReason ?? null,
        item.cancelledByUserId ?? null,
        item.cancelledAt ?? null,
        item.requiresWasteRecord ? 1 : 0,
        item.createdAt,
      );

      for (const mod of item.modifiers) {
        this.#db.executeMutation(
          `INSERT INTO cuenta_item_modificadores (
             id, cuenta_item_id, modifier_id, modifier_name_snapshot, modifier_price_applied
           ) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             modifier_name_snapshot = excluded.modifier_name_snapshot,
             modifier_price_applied = excluded.modifier_price_applied;`,
          mod.id,
          mod.cuentaItemId,
          mod.modifierId,
          mod.modifierNameSnapshot,
          mod.modifierPriceApplied,
        );
      }
    }
  }

  public listOpenCuentasSync(): readonly Cuenta[] {
    const rows = this.#db.queryRowsSafe<CuentaRow>(
      `SELECT id FROM cuentas WHERE status = 'ABIERTA' OR status = 'IMPRESA' ORDER BY opened_at ASC;`,
    );

    const cuentas: Cuenta[] = [];
    for (const r of rows) {
      const c = this.getCuentaByIdSync(r.id);
      if (c) {
        cuentas.push(c);
      }
    }
    return cuentas;
  }

  public async listOpenCuentas(): Promise<readonly Cuenta[]> {
    return this.listOpenCuentasSync();
  }
}
