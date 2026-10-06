# Independent Data review — WP-016 R1

Reviewer: 03_Data_Architect (independent parallel instance). Timestamp: 2026-10-06T17:24:00Z.
Repository: Lucas030509/TRIDENTPOS. PR: #65.
Subject: 8f75aafbb55b447b8c309f4e41266933d02408c6.
Base: 167704791e26b1f6964c47ad38e927c04613d1e2.
Framework: Lucas030509/EAAF-Framework @ 167cea36c09c1031c763971ff790db2e0d0f7362.
Sources reloaded via GitHub connector: registry/AGENTS.yaml; agents/architecture/03_Data_Architect.md; registry/GATES.yaml; gates/DATA_ARCHITECTURE_GATE.md.
Scope: data integrity, schema/repository isolation, exact monetary persistence and financial transaction boundary. No code modifications; no Builder or role-11 authority exercised.

## Findings

### DATA-BLK-016-R1-01 — Concurrent opening creates two active shifts on the same cash station

Files: packages/pos/src/cash-shift-service.ts:222-225,267; packages/pos-edge-runtime/src/cash-shift-sqlite-repository.ts:172-178; packages/pos-edge-runtime/src/cash-shift-schema.ts:73.

The active-shift read is awaited before the insert transaction. Two concurrent abrirTurno calls both read no existing shift; each inserts its own UUID successfully. The station/status index does not enforce uniqueness. Real SQLite reproduction invokes the actual built CashShiftDomainService and SqliteCashShiftRepository using a fresh file-backed EdgeDatabaseService, without a fake repository or changed code. Expected: one opening succeeds and the other rejects SHIFT_ALREADY_OPEN; one active shift. Actual: both promises fulfilled and two ABIERTO rows exist for the identical organization/branch/station. This defeats the service's explicit ShiftAlreadyOpen exclusion and splits the station's cash ledger; getActiveShift can arbitrarily select one of the active rows.

Evidence: double-open.mjs and double-open.log (outside candidate repository). Command: node /workspace/scratch/a2554d850a18/review65/data/double-open.mjs. Exit: 0; script asserts the reproduced invalid result. Remediation: enforce active-shift exclusion atomically at repository/database boundary, map concurrent collision to typed conflict and verify concurrent openings.

## Other inspected properties

Monetary reads use queryRowSafe/queryRowsSafe (SQLite integers -> BigInt) and decimal-string serialization; no floating arithmetic was found in monetary repository paths. Movement+OCC and arqueo+OCC are enclosed in repository transactions. Corte Z uses FULL transaction with shift/corte/audit/outbox written in that callback; hardware pulse follows persistence. These source observations do not independently establish every Data Gate requirement or override the blocking reproduction.

Tenant/station route isolation findings are independently being reviewed by role 11; no duplicate IDs invented here. The frozen subject/base are supplied by coordinator's verified checkout. No merge, code edits or production migrations performed.

Status: BLOCK (Data Gate advancement HOLD).

## Embedded immutable reproduction evidence

### double-open.mjs
```js
import { EdgeDatabaseService } from '../../tridentpos/packages/edge/dist/index.js';
import { SqliteCashShiftRepository } from '../../tridentpos/packages/pos-edge-runtime/dist/cash-shift-sqlite-repository.js';
import { CashShiftDomainService } from '../../tridentpos/packages/pos/dist/index.js';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const dir = fs.mkdtempSync('/tmp/pr65-data-double-open-');
const db = new EdgeDatabaseService({ databasePath: dir + '/edge.db' });
try {
  const repository = new SqliteCashShiftRepository(db);
  const service = new CashShiftDomainService({ repository });
  const command = { organizationId: 'org', branchId: 'branch', stationId: 'station', responsibleUserId: 'operator', openingCashFloat: 0n };
  const results = await Promise.allSettled([service.abrirTurno(command), service.abrirTurno(command)]);
  const rows = db.queryRowsSafe('SELECT id,organization_id,branch_id,station_id,status FROM turnos_caja');
  console.log(JSON.stringify({ expected: 'one fulfilled, one rejected SHIFT_ALREADY_OPEN; exactly one active shift', actual: results.map(r => r.status), rows }, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 2);
  assert.equal(rows.length, 2);
  console.log('DEFECT REPRODUCED: two concurrent openings persist two active shifts for same station.');
} finally {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

```

### double-open.log
```text
{
  "expected": "one fulfilled, one rejected SHIFT_ALREADY_OPEN; exactly one active shift",
  "actual": [
    "fulfilled",
    "fulfilled"
  ],
  "rows": [
    {
      "id": "21973285-8271-4912-a197-e882d746b5b7",
      "organization_id": "org",
      "branch_id": "branch",
      "station_id": "station",
      "status": "ABIERTO"
    },
    {
      "id": "62f5f77c-2b6f-4352-9837-07d8cad62493",
      "organization_id": "org",
      "branch_id": "branch",
      "station_id": "station",
      "status": "ABIERTO"
    }
  ]
}
DEFECT REPRODUCED: two concurrent openings persist two active shifts for same station.

```
