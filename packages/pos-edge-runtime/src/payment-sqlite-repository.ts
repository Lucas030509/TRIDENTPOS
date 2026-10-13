/**
 * TRIDENTPOS Edge SQLite Payment & Account Settlement Repository Adapter (WP-016C / ADR-012 / ADR-013)
 * Implements PaymentRepositoryPort from @trident/pos.
 * Guarantees atomic transaction commit (pagos + cuentas + movimientos_caja + outbox_queue + local_audit_trail),
 * OCC CAS concurrency, scale-4 BigInt storage (zero floating point), and idempotent client_op_id deduplication.
 */

import type {
  AtomicSettlementParams,
  Pago,
  PaymentMethod,
  PaymentRepositoryPort,
} from '@trident/pos';
import {
  EdgeDatabaseService,
  EdgeOutboxPersistence,
  LocalAuditTrailPersistence,
} from '@trident/edge';
import { SqliteDiningRoomRepository } from './dining-sqlite-repository.js';
import { POS_EDGE_SQLITE_SCHEMA } from './schema.js';

interface PagoRow {
  id: string;
  cuenta_id: string;
  turno_caja_id: string;
  operator_user_id: string;
  payment_method: string;
  amount: number | bigint | string;
  tip_amount: number | bigint | string;
  cash_given: number | bigint | string | null;
  change_due: number | bigint | string | null;
  reference_auth_code: string | null;
  client_op_id: string;
  created_at: string;
}

function mapPagoRow(row: PagoRow): Pago {
  return {
    id: row.id,
    cuentaId: row.cuenta_id,
    turnoCajaId: row.turno_caja_id,
    operatorUserId: row.operator_user_id,
    paymentMethod: row.payment_method as PaymentMethod,
    amount: BigInt(row.amount),
    tipAmount: BigInt(row.tip_amount),
    cashGiven:
      row.cash_given !== null && row.cash_given !== undefined ? BigInt(row.cash_given) : null,
    changeDue:
      row.change_due !== null && row.change_due !== undefined ? BigInt(row.change_due) : null,
    referenceAuthCode: row.reference_auth_code,
    clientOpId: row.client_op_id,
    createdAt: row.created_at,
  };
}

export interface SqlitePaymentRepositoryOptions {
  readonly organizationId?: string;
  readonly branchId?: string;
  readonly stationId?: string;
  readonly outboxPersistence?: EdgeOutboxPersistence;
  readonly auditPersistence?: LocalAuditTrailPersistence;
  readonly diningRepo?: SqliteDiningRoomRepository;
  readonly onBeforeCommit?: (pago: Pago) => void;
}

export class SqlitePaymentRepository implements PaymentRepositoryPort {
  readonly #db: EdgeDatabaseService;
  readonly #options: SqlitePaymentRepositoryOptions;
  readonly #outboxPersistence: EdgeOutboxPersistence;
  readonly #auditPersistence: LocalAuditTrailPersistence;
  readonly #diningRepo: SqliteDiningRoomRepository;
  readonly #onBeforeCommit?: (pago: Pago) => void;

  constructor(db: EdgeDatabaseService, options?: SqlitePaymentRepositoryOptions) {
    this.#db = db;
    this.#options = options ?? {};
    this.#outboxPersistence = options?.outboxPersistence ?? new EdgeOutboxPersistence(db);
    this.#auditPersistence = options?.auditPersistence ?? new LocalAuditTrailPersistence(db);
    this.#diningRepo = options?.diningRepo ?? new SqliteDiningRoomRepository(db);
    this.#onBeforeCommit = options?.onBeforeCommit;
    this.bootstrapSchema();
  }

  public bootstrapSchema(): void {
    this.#db.executeSchema(POS_EDGE_SQLITE_SCHEMA);
  }

  public findPaymentByIdSync(id: string): Pago | null {
    const row = this.#db.queryRowSafe<PagoRow>(
      `SELECT id, cuenta_id, turno_caja_id, operator_user_id, payment_method,
              amount, tip_amount, cash_given, change_due, reference_auth_code,
              client_op_id, created_at
       FROM pagos WHERE id = ?;`,
      id,
    );
    return row ? mapPagoRow(row) : null;
  }

  public async findPaymentById(id: string): Promise<Pago | null> {
    return this.findPaymentByIdSync(id);
  }

  public findPaymentByClientOpIdSync(cuentaId: string, clientOpId: string): Pago | null {
    const row = this.#db.queryRowSafe<PagoRow>(
      `SELECT id, cuenta_id, turno_caja_id, operator_user_id, payment_method,
              amount, tip_amount, cash_given, change_due, reference_auth_code,
              client_op_id, created_at
       FROM pagos WHERE cuenta_id = ? AND client_op_id = ?;`,
      cuentaId,
      clientOpId,
    );
    return row ? mapPagoRow(row) : null;
  }

  public async findPaymentByClientOpId(cuentaId: string, clientOpId: string): Promise<Pago | null> {
    return this.findPaymentByClientOpIdSync(cuentaId, clientOpId);
  }

  public listPaymentsByCuentaIdSync(cuentaId: string): readonly Pago[] {
    const rows = this.#db.queryRowsSafe<PagoRow>(
      `SELECT id, cuenta_id, turno_caja_id, operator_user_id, payment_method,
              amount, tip_amount, cash_given, change_due, reference_auth_code,
              client_op_id, created_at
       FROM pagos WHERE cuenta_id = ? ORDER BY created_at ASC;`,
      cuentaId,
    );
    return rows.map(mapPagoRow);
  }

  public async listPaymentsByCuentaId(cuentaId: string): Promise<readonly Pago[]> {
    return this.listPaymentsByCuentaIdSync(cuentaId);
  }

  public executeAtomicSettlementSync(params: AtomicSettlementParams): Pago {
    return this.#db.runInTransaction(() => {
      // 1. Idempotency safeguard (DATA-COND-015-02)
      const existing = this.findPaymentByClientOpIdSync(
        params.pago.cuentaId,
        params.pago.clientOpId,
      );
      if (existing) {
        return existing;
      }

      // 2. Insert into pagos
      this.#db.executeMutation(
        `INSERT INTO pagos (
          id, cuenta_id, turno_caja_id, operator_user_id, payment_method,
          amount, tip_amount, cash_given, change_due, reference_auth_code,
          client_op_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        params.pago.id,
        params.pago.cuentaId,
        params.pago.turnoCajaId,
        params.pago.operatorUserId,
        params.pago.paymentMethod,
        params.pago.amount,
        params.pago.tipAmount,
        params.pago.cashGiven,
        params.pago.changeDue,
        params.pago.referenceAuthCode,
        params.pago.clientOpId,
        params.pago.createdAt,
      );

      // 3. Atomically update Cuenta with OCC version check
      this.#diningRepo.saveCuentaSync(params.updatedCuenta, params.updatedCuenta.version - 1);

      // 4. Atomically insert MovimientoCaja if cash
      if (params.cashMovement) {
        this.#db.executeMutation(
          `INSERT INTO movimientos_caja (
            id, turno_caja_id, operator_user_id, movement_type, amount, reason, reference_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
          params.cashMovement.id,
          params.cashMovement.turnoCajaId,
          params.cashMovement.operatorUserId,
          params.cashMovement.movementType,
          params.cashMovement.amount,
          params.cashMovement.reason,
          params.cashMovement.referenceId,
          params.cashMovement.createdAt,
        );
      }

      // 5. Atomically enqueue CuentaPagada outbox event if settled
      if (params.cuentaPagadaEvent) {
        const orgId =
          this.#options.organizationId ?? params.cuentaPagadaEvent.organizacionId ?? 'org_default';
        const branchId =
          this.#options.branchId ?? params.cuentaPagadaEvent.sucursalId ?? 'branch_default';

        this.#outboxPersistence.enqueue({
          organizationId: orgId,
          branchId,
          aggregateType: 'CUENTA',
          aggregateId: params.pago.cuentaId,
          action: 'CuentaPagada',
          clientOpId: params.pago.clientOpId,
          aggregateSequenceNumber: params.updatedCuenta.version,
          payload: params.cuentaPagadaEvent,
        });
      }

      // 6. Record local audit trail
      if (params.auditRecord) {
        this.#auditPersistence.recordAudit({
          organizationId: this.#options.organizationId ?? 'org_default',
          branchId: this.#options.branchId ?? 'branch_default',
          stationId: this.#options.stationId ?? 'station_default',
          actorId: params.auditRecord.actorId,
          action: params.auditRecord.action,
          aggregateType: 'CUENTA',
          aggregateId: params.pago.cuentaId,
          details: params.auditRecord.details,
        });
      }

      // 7. Fault-injection hook (for crash-resilience testing)
      if (this.#onBeforeCommit) {
        this.#onBeforeCommit(params.pago);
      }

      return params.pago;
    });
  }

  public async executeAtomicSettlement(params: AtomicSettlementParams): Promise<Pago> {
    return this.executeAtomicSettlementSync(params);
  }
}
