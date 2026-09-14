import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getPosPackageInfo,
  POS_PACKAGE_NAME,
  POS_PACKAGE_VERSION,
  DiningDomainService,
  OCCConflictError,
  DomainError,
  type AccountRepositoryPort,
  type DiningRoomRepositoryPort,
  type Mesa,
  type Cuenta,
  type CancellationPolicy,
} from './index.js';
import { CORE_PACKAGE_NAME } from '@trident/core';

class InMemoryDiningRepo implements DiningRoomRepositoryPort {
  private mesas = new Map<string, Mesa>();

  async getMesaById(id: string): Promise<Mesa | null> {
    const mesa = this.mesas.get(id);
    return mesa ? { ...mesa } : null;
  }

  async saveMesa(mesa: Mesa, expectedVersion: number): Promise<Mesa> {
    const current = this.mesas.get(mesa.id);
    if (expectedVersion === 0) {
      if (current) {
        throw new DomainError(`Mesa ${mesa.id} exists`, 'DUPLICATE_MESA', 409);
      }
    } else {
      if (!current || current.version !== expectedVersion) {
        throw new OCCConflictError(
          mesa.id,
          expectedVersion,
          current ? current.version : 0,
          current ?? null,
        );
      }
    }
    this.mesas.set(mesa.id, { ...mesa });
    return { ...mesa };
  }

  async listMesas(): Promise<readonly Mesa[]> {
    return Array.from(this.mesas.values()).map((m) => ({ ...m }));
  }
}

class InMemoryAccountRepo implements AccountRepositoryPort {
  private cuentas = new Map<string, Cuenta>();

  async getCuentaById(id: string): Promise<Cuenta | null> {
    const cuenta = this.cuentas.get(id);
    return cuenta ? { ...cuenta, items: [...cuenta.items] } : null;
  }

  async saveCuenta(cuenta: Cuenta, expectedVersion: number): Promise<Cuenta> {
    const current = this.cuentas.get(cuenta.id);
    if (expectedVersion === 0) {
      if (current) {
        throw new DomainError(`Cuenta ${cuenta.id} exists`, 'DUPLICATE_CUENTA', 409);
      }
    } else {
      if (!current || current.version !== expectedVersion) {
        throw new OCCConflictError(
          cuenta.id,
          expectedVersion,
          current ? current.version : 0,
          current ?? null,
        );
      }
    }
    this.cuentas.set(cuenta.id, { ...cuenta, items: [...cuenta.items] });
    return { ...cuenta, items: [...cuenta.items] };
  }

  async listOpenCuentas(): Promise<readonly Cuenta[]> {
    return Array.from(this.cuentas.values())
      .filter((c) => c.status === 'ABIERTA')
      .map((c) => ({ ...c, items: [...c.items] }));
  }
}

test('@trident/pos package info returns expected metadata and dependency', () => {
  const info = getPosPackageInfo();
  assert.equal(info.name, POS_PACKAGE_NAME);
  assert.equal(info.version, POS_PACKAGE_VERSION);
  assert.equal(info.coreDependency, CORE_PACKAGE_NAME);
});

describe('TRIDENTPOS Dining Domain & OCC Unit Suite', () => {
  it('WP014-POS-01: Mesa creation and table lifecycle management', async () => {
    const diningRepo = new InMemoryDiningRepo();
    const accountRepo = new InMemoryAccountRepo();
    const service = new DiningDomainService({ diningRepo, accountRepo });

    const mesa = await service.createMesa({
      id: 'mesa_01',
      roomName: 'Terraza',
      tableNumber: 'T-1',
    });

    assert.equal(mesa.id, 'mesa_01');
    assert.equal(mesa.status, 'DISPONIBLE');
    assert.equal(mesa.version, 1);
    assert.equal(mesa.currentAccountId, null);

    // Duplicate creation fails
    await assert.rejects(() =>
      service.createMesa({ id: 'mesa_01', roomName: 'Terraza', tableNumber: 'T-1' }),
    );
  });

  it('WP014-POS-02: Cuenta opening links table and transitions status to OCUPADA', async () => {
    const diningRepo = new InMemoryDiningRepo();
    const accountRepo = new InMemoryAccountRepo();
    const service = new DiningDomainService({ diningRepo, accountRepo });

    await service.createMesa({ id: 'mesa_02', roomName: 'Principal', tableNumber: '10' });

    const { cuenta, mesa } = await service.openCuenta({
      id: 'cta_001',
      mesaId: 'mesa_02',
      epochId: 'ep_1',
      accountType: 'COMEDOR',
      openedByUserId: 'usr_waiter_1',
    });

    assert.equal(cuenta.id, 'cta_001');
    assert.equal(cuenta.status, 'ABIERTA');
    assert.equal(cuenta.version, 1);
    assert.equal(mesa?.status, 'OCUPADA');
    assert.equal(mesa?.currentAccountId, 'cta_001');
    assert.equal(mesa?.version, 2);

    // Opening another account on an occupied table fails
    await assert.rejects(
      () =>
        service.openCuenta({
          id: 'cta_002',
          mesaId: 'mesa_02',
          epochId: 'ep_1',
          accountType: 'COMEDOR',
          openedByUserId: 'usr_waiter_2',
        }),
      (err: unknown) => (err as DomainError).code === 'MESA_NOT_AVAILABLE',
    );
  });

  it('WP014-POS-03: Line item financial arithmetic strictly follows ADR-012 with scale-4 bigint', () => {
    // Unit price 150.0000 (1500000n), quantity 2.0000 (20000n) -> subtotal = 3000000n
    // Discount 30.0000 (300000n) -> net = 2700000n
    // Tax 16% (1600n) -> tax = roundDiv(2700000 * 1600, 10000) = 432000n
    // Total = 2700000 + 432000 = 3132000n
    const fin = DiningDomainService.calculateItemFinancials(1500000n, 20000n, 1600n, 300000n);
    assert.equal(fin.subtotal, 3000000n);
    assert.equal(fin.taxAmount, 432000n);
    assert.equal(fin.total, 3132000n);

    // Type is bigint, zero floats
    assert.equal(typeof fin.subtotal, 'bigint');
    assert.equal(typeof fin.taxAmount, 'bigint');
    assert.equal(typeof fin.total, 'bigint');
  });

  it('WP014-POS-04: Account totals are exact integer sum of line totals (no global tax recomputation)', async () => {
    const diningRepo = new InMemoryDiningRepo();
    const accountRepo = new InMemoryAccountRepo();
    const service = new DiningDomainService({ diningRepo, accountRepo });

    await service.openCuenta({
      id: 'cta_calc',
      epochId: 'ep_1',
      accountType: 'MOSTRADOR',
      openedByUserId: 'usr_1',
    });

    // Add item 1: price 100.0000 (1000000n), qty 1.0000 (10000n), tax 16% (1600n)
    // subtotal = 1000000n, tax = 160000n, total = 1160000n
    const cta1 = await service.addItemToCuenta('cta_calc', 1, {
      id: 'itm_1',
      productId: 'prod_burger',
      productNameSnapshot: 'Hamburguesa Especial',
      unitPriceApplied: 1000000n,
      quantity: 10000n,
      taxRateApplied: 1600n,
    });

    assert.equal(cta1.version, 2);
    assert.equal(cta1.subtotal, 1000000n);
    assert.equal(cta1.taxTotal, 160000n);
    assert.equal(cta1.totalAmount, 1160000n);

    // Add item 2: price 35.5000 (355000n), qty 2.0000 (20000n), tax 8% (800n), discount 5.0000 (50000n)
    // subtotal = 710000n, net = 660000n, tax = roundDiv(660000 * 800, 10000) = 52800n, total = 712800n
    const cta2 = await service.addItemToCuenta('cta_calc', 2, {
      id: 'itm_2',
      productId: 'prod_soda',
      productNameSnapshot: 'Refresco 600ml',
      unitPriceApplied: 355000n,
      quantity: 20000n,
      taxRateApplied: 800n,
      discountAmountApplied: 50000n,
      modifiers: [
        {
          id: 'mod_1',
          modifierId: 'opt_ice',
          modifierNameSnapshot: 'Con Hielo',
          modifierPriceApplied: 0n,
        },
      ],
    });

    assert.equal(cta2.version, 3);
    assert.equal(cta2.subtotal, 1000000n + 710000n); // 1710000n
    assert.equal(cta2.taxTotal, 160000n + 52800n); // 212800n
    assert.equal(cta2.discountsTotal, 50000n);
    assert.equal(cta2.totalAmount, 1160000n + 712800n); // 1872800n
  });

  it('WP014-POS-05: OCC expectedVersion mismatch throws OCCConflictError with current snapshot', async () => {
    const diningRepo = new InMemoryDiningRepo();
    const accountRepo = new InMemoryAccountRepo();
    const service = new DiningDomainService({ diningRepo, accountRepo });

    await service.openCuenta({
      id: 'cta_occ',
      epochId: 'ep_1',
      accountType: 'COMEDOR',
      openedByUserId: 'usr_waiter',
    });

    // Version is 1
    // Client A updates with expectedVersion 1 -> success, version becomes 2
    await service.addItemToCuenta('cta_occ', 1, {
      id: 'itm_a',
      productId: 'p_1',
      productNameSnapshot: 'Agua',
      unitPriceApplied: 200000n,
      quantity: 10000n,
      taxRateApplied: 0n,
    });

    // Client B attempts update with stale expectedVersion 1 -> throws OCCConflictError
    await assert.rejects(
      () =>
        service.addItemToCuenta('cta_occ', 1, {
          id: 'itm_b',
          productId: 'p_2',
          productNameSnapshot: 'Refresco',
          unitPriceApplied: 250000n,
          quantity: 10000n,
          taxRateApplied: 0n,
        }),
      (err: unknown) => {
        assert.ok(err instanceof OCCConflictError);
        const occErr = err as OCCConflictError;
        assert.equal(occErr.statusCode, 409);
        assert.equal(occErr.expectedVersion, 1);
        assert.equal(occErr.actualVersion, 2);
        assert.ok(occErr.currentSnapshot);
        return true;
      },
    );
  });

  it('WP014-POS-06: Closing cuenta transitions status and frees table', async () => {
    const diningRepo = new InMemoryDiningRepo();
    const accountRepo = new InMemoryAccountRepo();
    const service = new DiningDomainService({ diningRepo, accountRepo });

    await service.createMesa({ id: 'mesa_close', roomName: 'Salón', tableNumber: 'S-5' });
    const { cuenta } = await service.openCuenta({
      id: 'cta_close',
      mesaId: 'mesa_close',
      epochId: 'ep_1',
      accountType: 'COMEDOR',
      openedByUserId: 'usr_1',
    });

    const { cuenta: closedCuenta, mesa: freedMesa } = await service.closeCuenta(
      'cta_close',
      cuenta.version,
      'PAGADA',
    );

    assert.equal(closedCuenta.status, 'PAGADA');
    assert.ok(closedCuenta.closedAt);
    assert.equal(closedCuenta.version, 2);
    assert.equal(freedMesa?.status, 'DISPONIBLE');
    assert.equal(freedMesa?.currentAccountId, null);
  });

  it('WP014-POS-07: Protected policy hooks are injectable with zero hardcoded defaults', async () => {
    const diningRepo = new InMemoryDiningRepo();
    const accountRepo = new InMemoryAccountRepo();

    // Default service has undefined policies (OQ-SSOT-01, OQ-SSOT-06, OQ-SSOT-02 pending)
    const serviceDefault = new DiningDomainService({ diningRepo, accountRepo });

    // Calling splitCuenta without strategy throws 501
    assert.throws(
      () =>
        serviceDefault.splitCuenta(
          {
            id: 'c',
            folioNumber: null,
            epochId: 'e',
            mesaId: null,
            accountType: 'COMEDOR',
            status: 'ABIERTA',
            subtotal: 0n,
            taxTotal: 0n,
            discountsTotal: 0n,
            tipsTotal: 0n,
            totalAmount: 0n,
            openedByUserId: 'u',
            openedAt: '',
            closedAt: null,
            version: 1,
            updatedAt: '',
            items: [],
          },
          [],
        ),
      (err: unknown) => (err as DomainError).code === 'STRATEGY_NOT_CONFIGURED',
    );

    // Custom CancellationPolicy injection works
    const mockPolicy: CancellationPolicy = {
      canCancelItem: (_item, context) => {
        if (context.operatorRole === 'WAITER' && context.kitchenStatus === 'PREPARING') {
          return { allowed: false, reason: 'Requires supervisor approval for items in kitchen' };
        }
        return { allowed: true };
      },
    };

    const serviceWithPolicy = new DiningDomainService({
      diningRepo,
      accountRepo,
      cancellationPolicy: mockPolicy,
    });

    await serviceWithPolicy.openCuenta({
      id: 'cta_cancel',
      epochId: 'ep_1',
      accountType: 'COMEDOR',
      openedByUserId: 'usr_1',
    });

    await serviceWithPolicy.addItemToCuenta('cta_cancel', 1, {
      id: 'itm_canc',
      productId: 'p1',
      productNameSnapshot: 'Pizza',
      unitPriceApplied: 2000000n,
      quantity: 10000n,
      taxRateApplied: 1600n,
    });

    // Waiter cannot cancel kitchen item
    await assert.rejects(
      () =>
        serviceWithPolicy.cancelItem('cta_cancel', 'itm_canc', 2, {
          operatorUserId: 'usr_waiter',
          operatorRole: 'WAITER',
          kitchenStatus: 'PREPARING',
        }),
      (err: unknown) => (err as DomainError).code === 'CANCELLATION_DISALLOWED',
    );

    // Supervisor can cancel
    const cancelledCuenta = await serviceWithPolicy.cancelItem('cta_cancel', 'itm_canc', 2, {
      operatorUserId: 'usr_mgr',
      operatorRole: 'MANAGER',
      kitchenStatus: 'PREPARING',
      hasSupervisorAuthorization: true,
    });

    assert.equal(cancelledCuenta.items[0]?.status, 'CANCELADO');
    assert.equal(cancelledCuenta.totalAmount, 0n); // cancelled item not included in total
  });

  it('QI-014-01: Protected PO policies FAIL CLOSED when unconfigured', async () => {
    const diningRepo = new InMemoryDiningRepo();
    const accountRepo = new InMemoryAccountRepo();
    const bareService = new DiningDomainService({
      diningRepo,
      accountRepo,
      // No cancellationPolicy, transferRule, or splitStrategy configured
    });

    await bareService.openCuenta({
      id: 'cta_fail_closed',
      epochId: 'ep_1',
      accountType: 'COMEDOR',
      openedByUserId: 'usr_1',
    });

    await bareService.addItemToCuenta('cta_fail_closed', 1, {
      id: 'itm_fc',
      productId: 'p1',
      productNameSnapshot: 'Burger',
      unitPriceApplied: 1500000n,
      quantity: 10000n,
      taxRateApplied: 1600n,
    });

    // 1. CancellationPolicy absent -> MUST FAIL CLOSED with PROTECTED_POLICY_NOT_CONFIGURED
    await assert.rejects(
      () =>
        bareService.cancelItem('cta_fail_closed', 'itm_fc', 2, {
          operatorUserId: 'usr_mgr',
          operatorRole: 'MANAGER',
          kitchenStatus: 'PREPARING',
          hasSupervisorAuthorization: true,
        }),
      (err: unknown) => {
        assert(err instanceof DomainError);
        assert.equal(err.code, 'PROTECTED_POLICY_NOT_CONFIGURED');
        assert.equal(err.statusCode, 501);
        return true;
      },
    );

    // Verify account was NOT mutated
    const unmutatedCuenta = await accountRepo.getCuentaById('cta_fail_closed');
    assert.equal(unmutatedCuenta?.version, 2);
    assert.equal(unmutatedCuenta?.items[0]?.status, 'ORDENADO');
    assert.equal(unmutatedCuenta?.totalAmount, 1740000n);

    // 2. TransferValidationRule absent -> MUST FAIL CLOSED with PROTECTED_POLICY_NOT_CONFIGURED
    const dummyMesa1: Mesa = {
      id: 'm1',
      roomName: 'Main',
      tableNumber: '1',
      status: 'OCUPADA',
      currentAccountId: 'cta_fail_closed',
      version: 1,
      updatedAt: new Date().toISOString(),
    };
    const dummyMesa2: Mesa = {
      id: 'm2',
      roomName: 'Main',
      tableNumber: '2',
      status: 'DISPONIBLE',
      currentAccountId: null,
      version: 1,
      updatedAt: new Date().toISOString(),
    };

    assert.throws(
      () =>
        bareService.validateTransfer(dummyMesa1, dummyMesa2, unmutatedCuenta!, {
          operatorUserId: 'usr_1',
        }),
      (err: unknown) => {
        assert(err instanceof DomainError);
        assert.equal(err.code, 'PROTECTED_POLICY_NOT_CONFIGURED');
        assert.equal(err.statusCode, 501);
        return true;
      },
    );

    // 3. BillSplitProrationStrategy absent -> MUST FAIL CLOSED with STRATEGY_NOT_CONFIGURED
    assert.throws(
      () => bareService.splitCuenta(unmutatedCuenta!, [{ partitionId: 'part_1' }]),
      (err: unknown) => {
        assert(err instanceof DomainError);
        assert.equal(err.code, 'STRATEGY_NOT_CONFIGURED');
        assert.equal(err.statusCode, 501);
        return true;
      },
    );
  });
});
