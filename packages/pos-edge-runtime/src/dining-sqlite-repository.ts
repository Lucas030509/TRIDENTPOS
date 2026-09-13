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
  opened_at: string;
  closed_at: string | null;
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
  }

  // ==========================================
  // Mesa / Dining Room Repository Operations
  // ==========================================

  public getMesaByIdSync(id: string): Mesa | null {
    const row = this.#db.queryRow<MesaRow>(
      'SELECT id, room_name, table_number, status, current_account_id, version, updated_at FROM mesas WHERE id = ?;',
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
      version: row.version,
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
        `INSERT INTO mesas (id, room_name, table_number, status, current_account_id, version, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?);`,
        mesa.id,
        mesa.roomName,
        mesa.tableNumber,
        mesa.status,
        mesa.currentAccountId,
        mesa.version,
        mesa.updatedAt,
      );

      return mesa;
    }

    // OCC update with CAS (Compare-And-Swap)
    const result = this.#db.executeMutation(
      `UPDATE mesas
       SET room_name = ?, table_number = ?, status = ?, current_account_id = ?, version = ?, updated_at = ?
       WHERE id = ? AND version = ?;`,
      mesa.roomName,
      mesa.tableNumber,
      mesa.status,
      mesa.currentAccountId,
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

  public async listMesas(): Promise<readonly Mesa[]> {
    const rows = this.#db.queryRows<MesaRow>(
      'SELECT id, room_name, table_number, status, current_account_id, version, updated_at FROM mesas ORDER BY table_number ASC;',
    );

    return rows.map((row) => ({
      id: row.id,
      roomName: row.room_name,
      tableNumber: row.table_number,
      status: row.status as MesaStatus,
      currentAccountId: row.current_account_id,
      version: row.version,
      updatedAt: row.updated_at,
    }));
  }

  // ==========================================
  // Cuenta / Orders Repository Operations
  // ==========================================

  public getCuentaByIdSync(id: string): Cuenta | null {
    const row = this.#db.queryRow<CuentaRow>(
      `SELECT id, folio_number, epoch_id, mesa_id, account_type, status,
              subtotal, tax_total, discounts_total, tips_total, total_amount,
              opened_by_user_id, opened_at, closed_at, version, updated_at
       FROM cuentas WHERE id = ?;`,
      id,
    );

    if (!row) {
      return null;
    }

    const itemRows = this.#db.queryRows<CuentaItemRow>(
      `SELECT id, cuenta_id, product_id, product_name_snapshot,
              unit_price_applied, quantity, tax_rate_applied, tax_amount_applied,
              discount_amount_applied, subtotal, total, status, created_at
       FROM cuenta_items WHERE cuenta_id = ? ORDER BY created_at ASC;`,
      id,
    );

    const items: CuentaItem[] = [];
    for (const itemRow of itemRows) {
      const modRows = this.#db.queryRows<CuentaItemModificadorRow>(
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
        createdAt: itemRow.created_at,
        modifiers,
      });
    }

    return {
      id: row.id,
      folioNumber: row.folio_number,
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
      openedAt: row.opened_at,
      closedAt: row.closed_at,
      version: row.version,
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
           opened_by_user_id, opened_at, closed_at, version, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        cuenta.id,
        cuenta.folioNumber,
        cuenta.epochId,
        cuenta.mesaId,
        cuenta.accountType,
        cuenta.status,
        Number(cuenta.subtotal),
        Number(cuenta.taxTotal),
        Number(cuenta.discountsTotal),
        Number(cuenta.tipsTotal),
        Number(cuenta.totalAmount),
        cuenta.openedByUserId,
        cuenta.openedAt,
        cuenta.closedAt,
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
           closed_at = ?, version = ?, updated_at = ?
       WHERE id = ? AND version = ?;`,
      cuenta.folioNumber,
      cuenta.epochId,
      cuenta.mesaId,
      cuenta.accountType,
      cuenta.status,
      Number(cuenta.subtotal),
      Number(cuenta.taxTotal),
      Number(cuenta.discountsTotal),
      Number(cuenta.tipsTotal),
      Number(cuenta.totalAmount),
      cuenta.closedAt,
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
           discount_amount_applied, subtotal, total, status, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status = excluded.status,
           unit_price_applied = excluded.unit_price_applied,
           quantity = excluded.quantity,
           tax_rate_applied = excluded.tax_rate_applied,
           tax_amount_applied = excluded.tax_amount_applied,
           discount_amount_applied = excluded.discount_amount_applied,
           subtotal = excluded.subtotal,
           total = excluded.total;`,
        item.id,
        item.cuentaId,
        item.productId,
        item.productNameSnapshot,
        Number(item.unitPriceApplied),
        Number(item.quantity),
        Number(item.taxRateApplied),
        Number(item.taxAmountApplied),
        Number(item.discountAmountApplied),
        Number(item.subtotal),
        Number(item.total),
        item.status,
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
          Number(mod.modifierPriceApplied),
        );
      }
    }
  }

  public async listOpenCuentas(): Promise<readonly Cuenta[]> {
    const rows = this.#db.queryRows<CuentaRow>(
      `SELECT id FROM cuentas WHERE status = 'ABIERTA' ORDER BY opened_at ASC;`,
    );

    const cuentas: Cuenta[] = [];
    for (const r of rows) {
      const c = await this.getCuentaById(r.id);
      if (c) {
        cuentas.push(c);
      }
    }
    return cuentas;
  }
}
