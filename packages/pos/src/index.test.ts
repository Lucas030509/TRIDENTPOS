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
  type IamPinValidatorPort,
  ProportionalBillSplitStrategy,
} from './index.js';
import { CORE_PACKAGE_NAME } from '@trident/core';

class MockPinValidator implements IamPinValidatorPort {
  readonly validPins = new Map<string, string>([
    ['usr_waiter_1', '1234'],
    ['usr_waiter_2', '5678'],
    ['usr_target_waiter', '9999'],
    ['usr_mgr', '4321'],
    ['supervisor', '7777'],
    ['manager', '8888'],
    ['gerente', '8888'],
    ['usr_1', '1111'],
  ]);

  validatePin(userId: string, pin: string): boolean {
    const expected = this.validPins.get(userId);
    return expected === pin;
  }
}

class InMemoryDiningRepo implements DiningRoomRepositoryPort {
  private mesas = new Map<string, Mesa>();

  async getMesaById(id: string): Promise<Mesa | null> {
    return this.getMesaByIdSync(id);
  }

  getMesaByIdSync(id: string): Mesa | null {
    const mesa = this.mesas.get(id);
    return mesa ? { ...mesa } : null;
  }

  async saveMesa(mesa: Mesa, expectedVersion: number): Promise<Mesa> {
    return this.saveMesaSync(mesa, expectedVersion);
  }

  saveMesaSync(mesa: Mesa, expectedVersion: number): Mesa {
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
    return this.listMesasSync();
  }

  listMesasSync(): readonly Mesa[] {
    return Array.from(this.mesas.values()).map((m) => ({ ...m }));
  }
}

class InMemoryAccountRepo implements AccountRepositoryPort {
  private cuentas = new Map<string, Cuenta>();

  async getCuentaById(id: string): Promise<Cuenta | null> {
    return this.getCuentaByIdSync(id);
  }

  getCuentaByIdSync(id: string): Cuenta | null {
    const cuenta = this.cuentas.get(id);
    return cuenta ? { ...cuenta, items: [...cuenta.items] } : null;
  }

  async saveCuenta(cuenta: Cuenta, expectedVersion: number): Promise<Cuenta> {
    return this.saveCuentaSync(cuenta, expectedVersion);
  }

  saveCuentaSync(cuenta: Cuenta, expectedVersion: number): Cuenta {
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
    return this.listOpenCuentasSync();
  }

  listOpenCuentasSync(): readonly Cuenta[] {
    return Array.from(this.cuentas.values())
      .filter((c) => c.status === 'ABIERTA' || c.status === 'IMPRESA')
      .map((c) => ({ ...c, items: [...c.items] }));
  }
}

test('@trident/pos package info returns expected metadata and dependency', () => {
  const info = getPosPackageInfo();
  assert.equal(info.name, POS_PACKAGE_NAME);
  assert.equal(info.version, POS_PACKAGE_VERSION);
  assert.equal(info.coreDependency, CORE_PACKAGE_NAME);
});

describe('TRIDENTPOS Dining Domain & OCC Unit Suite (WP-014A)', () => {
  it('WP014-POS-00: pinValidator is mandatory in constructor (fail-closed)', () => {
    const diningRepo = new InMemoryDiningRepo();
    const accountRepo = new InMemoryAccountRepo();

    assert.throws(
      () => new DiningDomainService({ diningRepo, accountRepo } as never),
      (err: unknown) => {
        assert(err instanceof DomainError);
        assert.equal(err.code, 'PIN_VALIDATOR_REQUIRED');
        assert.equal(err.statusCode, 500);
        return true;
      },
    );
  });

  it('WP014-POS-01: Mesa creation and table lifecycle management', async () => {
    const diningRepo = new InMemoryDiningRepo();
    const accountRepo = new InMemoryAccountRepo();
    const pinValidator = new MockPinValidator();
    const service = new DiningDomainService({ diningRepo, accountRepo, pinValidator });

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
    const pinValidator = new MockPinValidator();
    const service = new DiningDomainService({ diningRepo, accountRepo, pinValidator });

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
    const fin = DiningDomainService.calculateItemFinancials(1500000n, 20000n, 1600n, 300000n);
    assert.equal(fin.subtotal, 3000000n);
    assert.equal(fin.taxAmount, 432000n);
    assert.equal(fin.total, 3132000n);

    assert.equal(typeof fin.subtotal, 'bigint');
    assert.equal(typeof fin.taxAmount, 'bigint');
    assert.equal(typeof fin.total, 'bigint');
  });

  it('WP014-POS-04: Account totals are exact integer sum of line totals', async () => {
    const diningRepo = new InMemoryDiningRepo();
    const accountRepo = new InMemoryAccountRepo();
    const pinValidator = new MockPinValidator();
    const service = new DiningDomainService({ diningRepo, accountRepo, pinValidator });

    await service.openCuenta({
      id: 'cta_calc',
      epochId: 'ep_1',
      accountType: 'MOSTRADOR',
      openedByUserId: 'usr_1',
    });

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

    const cta2 = await service.addItemToCuenta('cta_calc', 2, {
      id: 'itm_2',
      productId: 'prod_soda',
      productNameSnapshot: 'Refresco 600ml',
      unitPriceApplied: 355000n,
      quantity: 20000n,
      taxRateApplied: 800n,
      discountAmountApplied: 50000n,
    });

    assert.equal(cta2.version, 3);
    assert.equal(cta2.subtotal, 1710000n);
    assert.equal(cta2.taxTotal, 212800n);
    assert.equal(cta2.discountsTotal, 50000n);
    assert.equal(cta2.totalAmount, 1872800n);
  });

  it('WP014-POS-05: OCC expectedVersion mismatch throws OCCConflictError with current snapshot', async () => {
    const diningRepo = new InMemoryDiningRepo();
    const accountRepo = new InMemoryAccountRepo();
    const pinValidator = new MockPinValidator();
    const service = new DiningDomainService({ diningRepo, accountRepo, pinValidator });

    await service.openCuenta({
      id: 'cta_occ',
      epochId: 'ep_1',
      accountType: 'COMEDOR',
      openedByUserId: 'usr_waiter_1',
    });

    await service.addItemToCuenta('cta_occ', 1, {
      id: 'itm_a',
      productId: 'p_1',
      productNameSnapshot: 'Agua',
      unitPriceApplied: 200000n,
      quantity: 10000n,
      taxRateApplied: 0n,
    });

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
        return true;
      },
    );
  });

  it('WP014-POS-06: DEC-010 Item cancellation according to KDS state and supervisor PIN', () => {
    const diningRepo = new InMemoryDiningRepo();
    const accountRepo = new InMemoryAccountRepo();
    const pinValidator = new MockPinValidator();
    const service = new DiningDomainService({ diningRepo, accountRepo, pinValidator });

    service.openCuentaSync({
      id: 'cta_dec010',
      epochId: 'ep_1',
      accountType: 'COMEDOR',
      openedByUserId: 'usr_waiter_1',
    });

    service.addItemToCuentaSync('cta_dec010', 1, {
      id: 'itm_unstarted',
      productId: 'p1',
      productNameSnapshot: 'Cerveza',
      unitPriceApplied: 500000n,
      quantity: 10000n,
      taxRateApplied: 1600n,
    });

    service.addItemToCuentaSync('cta_dec010', 2, {
      id: 'itm_in_prep',
      productId: 'p2',
      productNameSnapshot: 'Corte Ribeye',
      unitPriceApplied: 4500000n,
      quantity: 10000n,
      taxRateApplied: 1600n,
    });

    // 1. Unstarted item: Waiter can cancel with reason; requiresWasteRecord = false
    const res1 = service.cancelItemSync({
      cuentaId: 'cta_dec010',
      itemId: 'itm_unstarted',
      expectedVersion: 3,
      operatorUserId: 'usr_waiter_1',
      operatorPin: '1234',
      kitchenStatus: 'SIN_INICIAR',
      reason: 'Cliente cambió de opinión',
    });

    assert.equal(res1.requiresWasteRecord, false);
    assert.equal(res1.cancelledItem.status, 'CANCELADO');
    assert.equal(res1.cuenta.version, 4);

    // 2. In preparation item: Waiter alone CANNOT cancel (403 CANCELLATION_DISALLOWED)
    assert.throws(
      () =>
        service.cancelItemSync({
          cuentaId: 'cta_dec010',
          itemId: 'itm_in_prep',
          expectedVersion: 4,
          operatorUserId: 'usr_waiter_1',
          operatorPin: '1234',
          kitchenStatus: 'EN_PREPARACION',
          reason: 'Mesa se fue',
        }),
      (err: unknown) => (err as DomainError).code === 'CANCELLATION_DISALLOWED',
    );

    // 3. In preparation item: With supervisor PIN -> success, requiresWasteRecord = true
    const res2 = service.cancelItemSync({
      cuentaId: 'cta_dec010',
      itemId: 'itm_in_prep',
      expectedVersion: 4,
      operatorUserId: 'usr_waiter_1',
      operatorPin: '1234',
      supervisorPin: '7777',
      kitchenStatus: 'EN_PREPARACION',
      reason: 'Platillo quemado y cliente canceló',
    });

    assert.equal(res2.requiresWasteRecord, true);
    assert.equal(res2.cancelledItem.status, 'CANCELADO');
    assert.equal(res2.cuenta.totalAmount, 0n);
  });

  it('WP014-POS-07: DEC-011 Table transfer with receiving waiter PIN confirmation', () => {
    const diningRepo = new InMemoryDiningRepo();
    const accountRepo = new InMemoryAccountRepo();
    const pinValidator = new MockPinValidator();
    const service = new DiningDomainService({ diningRepo, accountRepo, pinValidator });

    service.createMesaSync({ id: 'mesa_src', roomName: 'Salón', tableNumber: 'M-1' });
    service.createMesaSync({ id: 'mesa_dst', roomName: 'Terraza', tableNumber: 'T-5' });

    service.openCuentaSync({
      id: 'cta_transfer',
      mesaId: 'mesa_src',
      epochId: 'ep_1',
      accountType: 'COMEDOR',
      openedByUserId: 'usr_waiter_1',
    });

    // 1. Transfer with incorrect receiving waiter PIN -> 401
    assert.throws(
      () =>
        service.transferCuentaSync({
          cuentaId: 'cta_transfer',
          expectedVersion: 1,
          sourceMesaId: 'mesa_src',
          targetMesaId: 'mesa_dst',
          sourceWaiterUserId: 'usr_waiter_1',
          targetWaiterUserId: 'usr_target_waiter',
          targetWaiterPin: '0000', // incorrect
        }),
      (err: unknown) => (err as DomainError).code === 'INVALID_TARGET_WAITER_PIN',
    );

    // 2. Transfer with correct receiving waiter PIN -> success
    const res = service.transferCuentaSync({
      cuentaId: 'cta_transfer',
      expectedVersion: 1,
      sourceMesaId: 'mesa_src',
      targetMesaId: 'mesa_dst',
      sourceWaiterUserId: 'usr_waiter_1',
      targetWaiterUserId: 'usr_target_waiter',
      targetWaiterPin: '9999',
      reason: 'Cliente pidió cambiarse a terraza',
    });

    assert.equal(res.sourceMesa.status, 'DISPONIBLE');
    assert.equal(res.sourceMesa.currentAccountId, null);
    assert.equal(res.targetMesa.status, 'OCUPADA');
    assert.equal(res.targetMesa.currentAccountId, 'cta_transfer');
    assert.equal(res.cuenta.mesaId, 'mesa_dst');
    assert.equal(res.cuenta.currentWaiterUserId, 'usr_target_waiter');
  });

  it('WP014-POS-08: DEC-013 Printed account cancellation requires Manager PIN and voids folio', () => {
    const diningRepo = new InMemoryDiningRepo();
    const accountRepo = new InMemoryAccountRepo();
    const pinValidator = new MockPinValidator();
    const service = new DiningDomainService({ diningRepo, accountRepo, pinValidator });

    service.createMesaSync({ id: 'mesa_imp', roomName: 'Salón', tableNumber: 'M-12' });
    service.openCuentaSync({
      id: 'cta_imp',
      mesaId: 'mesa_imp',
      epochId: 'ep_1',
      accountType: 'COMEDOR',
      openedByUserId: 'usr_waiter_1',
    });

    service.addItemToCuentaSync('cta_imp', 1, {
      id: 'itm_1',
      productId: 'p1',
      productNameSnapshot: 'Pizza',
      unitPriceApplied: 2000000n,
      quantity: 10000n,
      taxRateApplied: 1600n,
    });

    // Request check / precuenta print -> assigns folio and sets status to IMPRESA (DEC-006)
    const precuenta = service.requestCheckSync({
      cuentaId: 'cta_imp',
      expectedVersion: 2,
      requestedByUserId: 'usr_waiter_1',
      operatorPin: '1234',
      nextFolioNumber: 1054,
    });

    assert.equal(precuenta.cuenta.status, 'IMPRESA');
    assert.equal(precuenta.cuenta.folioNumber, 1054);
    assert.equal(precuenta.mesa?.status, 'EN_CUENTA');

    // Attempt cancellation without Manager PIN -> 403 MANAGER_PIN_REQUIRED
    assert.throws(
      () =>
        service.cancelCuentaSync({
          cuentaId: 'cta_imp',
          expectedVersion: 3,
          requestedByUserId: 'usr_waiter_1',
          requestedByPin: '1234',
          reason: 'Cliente salió sin pagar',
        }),
      (err: unknown) => (err as DomainError).code === 'MANAGER_PIN_REQUIRED',
    );

    // Cancel with Manager PIN -> success, status ANULADA, folio kept (not reused), table freed
    const cancelled = service.cancelCuentaSync({
      cuentaId: 'cta_imp',
      expectedVersion: 3,
      requestedByUserId: 'usr_waiter_1',
      requestedByPin: '1234',
      managerPin: '8888',
      reason: 'Cliente salió sin pagar (anulado por gerencia)',
    });

    assert.equal(cancelled.cuenta.status, 'ANULADA');
    assert.equal(cancelled.cuenta.folioNumber, 1054);
    assert.equal(cancelled.mesa?.status, 'DISPONIBLE');
    assert.equal(cancelled.mesa?.currentAccountId, null);
  });

  it('WP014-POS-09: DEC-015 Proportional split proration invariant (sum of subcuentas == original total)', () => {
    const diningRepo = new InMemoryDiningRepo();
    const accountRepo = new InMemoryAccountRepo();
    const pinValidator = new MockPinValidator();
    const service = new DiningDomainService({ diningRepo, accountRepo, pinValidator });

    service.openCuentaSync({
      id: 'cta_split',
      epochId: 'ep_1',
      accountType: 'COMEDOR',
      openedByUserId: 'usr_waiter_1',
    });

    // Subtotal = 100.0000 + 50.0000 + 75.0000 = 225.0000 (2250000n)
    // Tax = 16% = 360000n
    // Total = 2610000n
    service.addItemToCuentaSync('cta_split', 1, {
      id: 'i1',
      productId: 'p1',
      productNameSnapshot: 'Item 1',
      unitPriceApplied: 1000000n,
      quantity: 10000n,
      taxRateApplied: 1600n,
    });
    service.addItemToCuentaSync('cta_split', 2, {
      id: 'i2',
      productId: 'p2',
      productNameSnapshot: 'Item 2',
      unitPriceApplied: 500000n,
      quantity: 10000n,
      taxRateApplied: 1600n,
    });
    const cta = service.addItemToCuentaSync('cta_split', 3, {
      id: 'i3',
      productId: 'p3',
      productNameSnapshot: 'Item 3',
      unitPriceApplied: 750000n,
      quantity: 10000n,
      taxRateApplied: 1600n,
    });

    // Split 3 ways by items
    const splitRes = service.splitCuentaSync({
      cuentaId: 'cta_split',
      expectedVersion: 4,
      performedByUserId: 'usr_waiter_1',
      operatorPin: '1234',
      partitions: [
        { partitionId: 'sub_1', itemIds: ['i1'] },
        { partitionId: 'sub_2', itemIds: ['i2'] },
        { partitionId: 'sub_3', itemIds: ['i3'] },
      ],
    });

    assert.equal(splitRes.subCuentas.length, 3);
    const sumTotal = splitRes.subCuentas.reduce((sum, s) => sum + s.totalAmount, 0n);
    assert.equal(sumTotal, cta.totalAmount);
    assert.equal(splitRes.originalCuenta.status, 'ANULADA');

    // Ratio split 3 equal parts (1/3 each with integer remainder allocated to last)
    const ratioStrategy = new ProportionalBillSplitStrategy();
    const ratioSplits = ratioStrategy.prorateSplit(cta, [
      { partitionId: 'r1', ratioScale4: 3333n },
      { partitionId: 'r2', ratioScale4: 3333n },
      { partitionId: 'r3', ratioScale4: 3334n },
    ]);

    const sumRatio = ratioSplits.reduce((sum, s) => sum + s.totalAmount, 0n);
    assert.equal(sumRatio, cta.totalAmount);
  });

  it('WP014-POS-10: Salón read model computes room summaries and attention signal projections', () => {
    const diningRepo = new InMemoryDiningRepo();
    const accountRepo = new InMemoryAccountRepo();
    const pinValidator = new MockPinValidator();
    const service = new DiningDomainService({ diningRepo, accountRepo, pinValidator });

    service.createMesaSync({ id: 'm1', roomName: 'Interior', tableNumber: '1' });
    service.createMesaSync({ id: 'm2', roomName: 'Interior', tableNumber: '2' });
    service.createMesaSync({ id: 'm3', roomName: 'Terraza', tableNumber: 'T1' });

    service.openCuentaSync({
      id: 'c1',
      mesaId: 'm1',
      epochId: 'ep1',
      accountType: 'COMEDOR',
      openedByUserId: 'usr_waiter_1',
    });

    service.requestCheckSync({
      cuentaId: 'c1',
      expectedVersion: 1,
      requestedByUserId: 'usr_waiter_1',
      operatorPin: '1234',
    });

    const readModel = service.getSalonReadModelSync();
    assert.equal(readModel.totalTables, 3);
    assert.equal(readModel.inCheckTables, 1);
    assert.equal(readModel.availableTables, 2);
    assert.equal(readModel.rooms.length, 2);
  });

  it('WP014-POS-11: Table merge semantics remain neutral hook pending PO decision', () => {
    const diningRepo = new InMemoryDiningRepo();
    const accountRepo = new InMemoryAccountRepo();
    const pinValidator = new MockPinValidator();
    const service = new DiningDomainService({ diningRepo, accountRepo, pinValidator });

    assert.throws(
      () =>
        service.mergeTablesHook({
          primaryMesaId: 'm1',
          secondaryMesaIds: ['m2'],
          operatorUserId: 'usr_1',
        }),
      (err: unknown) => {
        assert(err instanceof DomainError);
        assert.equal(err.code, 'TABLE_MERGE_NOT_SPECIFIED');
        assert.equal(err.statusCode, 501);
        return true;
      },
    );
  });
});
