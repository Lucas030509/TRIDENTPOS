# WP-016 — Specialist Data Review R1
Estado: BLOCK
Revisor: 03_Data_Architect, instancia ChatGPT independiente del Builder, activada exclusivamente como Specialist Reviewer.
Fecha: 2026-10-06T17:23:00Z
Perfil: EAAF Lean, RC3, ronda 1 de máximo 2.
Repositorio: Lucas030509/TRIDENTPOS, PR #65.
Frozen subject: 8f75aafbb55b447b8c309f4e41266933d02408c6
Tree: 57c70cf89973996818658c8655847dbf0aa8cb25
Base y merge-base: 167704791e26b1f6964c47ad38e927c04613d1e2
EAAF pin: 167cea36c09c1031c763971ff790db2e0d0f7362
Fuentes recargadas: registry/AGENTS.yaml → agents/architecture/03_Data_Architect.md; registry/GATES.yaml → gates/DATA_ARCHITECTURE_GATE.md.
Fuentes del sujeto: IMPLEMENTATION_PLAN.md:700-724; DATA_MODEL.md §2/3; ADR-004; ADR-012 §3/4; PRODUCT_OWNER_OQ_RESOLUTION.md:71-74 (DEC-017).
Independencia: no se escribió implementación ni se alteró el sujeto. Reproducciones externas bajo /tmp con módulos compilados del SHA exacto. No se concede aprobación global, merge, staging o producción.

## Hallazgos bloqueantes
### DATA-BLK-016-R1-01 — Resultados monetarios fuera del rango ADR-012
packages/pos/src/cash-shift-service.ts:189-207; packages/pos-edge-runtime/src/cash-shift-sqlite-repository.ts:506-530.
ADR-012 §3 Option D y §4 exigen límites [-999999999999n,+999999999999n] antes de aceptar resultados, persistir o sincronizar. Dos entradas válidas (fondo 99999999.9999 y venta 0.0001) generan totalCalculado 100000000.0000, se persiste Corte Z y se encola ese total en CorteZGenerado. Esperado: rechazo explícito/atómico sin evento fuera de rango. Actual: aceptación y outbox fuera de DECIMAL(12,4). Reproducido por el script adjunto. INT-06 además acepta fondos fuera del rango contractual; exactitud BigInt no sustituye validación de rango.
Remediación: validar entradas y resultados en las fronteras de dominio/persistencia/outbox; prueba de límites y de overflow por suma con entradas válidas.

### DATA-BLK-016-R1-02 — Dos turnos activos simultáneos para una caja
packages/pos/src/cash-shift-service.ts:222-267; packages/pos-edge-runtime/src/cash-shift-schema.ts:73-74.
El guard de turno activo se lee fuera de la transacción de INSERT y no existe unicidad parcial por identidad de caja para estados activos. Promise.allSettled de dos abrirTurno idénticos devuelve fulfilled/fulfilled y SQLite conserva dos ABIERTO para ORG/BR/S. Esperado: una apertura y un conflicto; actual: dos libros de caja activos. Defecto de integridad reproducido, no recomendación preventiva.
Remediación: invariant atómico con índice parcial tenant/branch/station o comprobación y escritura bajo una sola transacción; prueba de carrera real.

### DATA-BLK-016-R1-03 — PIN por cobro eludible
packages/pos/src/cash-shift-service.ts:114-119, 337-341.
DEC-017 (PRODUCT_OWNER_OQ_RESOLUTION.md:73) exige PIN por cada cobro. Con pinValidator.validatePin configurado para devolver false, omitir operatorPin evita invocar el validador y registrarMovimiento VENTA_EFECTIVO se acepta/persiste. Esperado: fail-closed ante PIN ausente o inválido. Actual: movimiento aceptado. El default sin validador también es permisivo. Se bloquea por no negociable DEC-017, dentro del scope explícito de este review; no pretende sustituir Security Gate.
Remediación: exigir PIN y validador operativo por cobro; casos negativos de omisión, validador ausente y PIN inválido.

### DATA-BLK-016-R1-04 — Prueba requerida de crash durante commit ausente
packages/pos-edge-runtime/src/cash-shift-runtime.test.ts:261-321.
IMPLEMENTATION_PLAN.md:715 exige crash simulation during Corte Z commit / DAT-04. INT-03 pasa expectedVersion=99: UPDATE afecta cero filas y OCC interrumpe antes de INSERT de corte, auditoría, outbox o COMMIT. No simula caída del proceso/fallo durante commit ni reabre la base; tampoco consulta outbox pese al comentario. Esperado: evidencia de recuperación consistente bajo fallo durante el commit FULL. Actual: solo rollback de conflicto previo a escrituras. Se bloquea por prueba faltante para criterio explícito de aceptación, sin afirmar que la implementación durable haya fallado.
Remediación: inyección de fallo en frontera de commit/crash de proceso, reapertura y comprobación conjunta de turno/corte/auditoría/outbox (todo o nada), más verificación de FULL durante la frontera.

## Advisory (no condicionan BLOCK)
DATA-ADV-016-R1-01 — packages/pos-edge-runtime/src/cash-shift-schema.ts:7-79. PK/FK e índices existen y DDL es aditivo, pero no CHECK para status/tipo/signo ni procedimiento de reversión del esquema. Documentar recuperación compatible con datos retenidos. IMPLEMENTATION_PLAN.md:718 describe admin unlock auditado, en tensión con congelación permanente exigida en :714 y este encargo; aclarar contractualmente sin implementar unlock ordinario.
DATA-ADV-016-R1-02 — packages/pos-edge-runtime/src/cash-shift-sqlite-repository.ts:345-381,461-481. Arqueo persiste diferencia, auditoría canónica se escribe al Corte Z, no al capturar arqueo. Documentar si la ventana entre ambos satisface trazabilidad; no se bloquea por una interpretación de timing no explicitada.
DATA-ADV-016-R1-03 — packages/pos/src/cash-shift-service.ts:183-185. Fondo inicial se excluye del netCash por operador aunque su movimiento cuenta; aclarar cómo debe cuadrar desglose más fondo mancomunado conforme DEC-017.

## Cobertura de los seis puntos
1. Ownership PASS en alcance inspeccionado: cinco tablas en pos-edge-runtime, dominio pos; no escritura Finance en diff de 18 archivos. Finance es consumidor downstream por contrato del plan.
2. Integridad BLOCK por apertura concurrente; PK/FK e índices presentes. Migración expand vía CREATE IF NOT EXISTS. Rollback documental advisory.
3. Canonical outbox/audit PASS en esquema e inicialización, INT-05; no DDL duplicado de estas tablas en POS. Identidad enrolled/fail-closed verificada por INT-04/04B; payload usa org/branch del turno. No certifica enrolamiento externo.
4. FULL establecido por runInTransaction(...,{durabilityMode:'FULL'}) en repository:532; enqueue dentro de transacción, entrega externa después de commit. Domain bloquea mutaciones post-Z y double-close INT-02. Durabilidad DAT-04 BLOCK por prueba requerida ausente.
5. Exactitud bigint/INTEGER y serialización decimal verificadas; Number solo shift/version, no montos. BLOCK por rango de resultados. Cuadre nominal y desglose pasan pruebas existentes, advisory sobre fondo.
6. Captura declarada como entrada y persistida antes de response calculado en fastify-app:742-754. Prueba nominal DOM-05 e INT-01 pasan; auditoría canónica al Z. Obligación PIN de DEC-017 BLOCK.

## Evidencia ejecutada
Node v24.19.0; npm ci --ignore-scripts; npm run build: exit 0, 4/4 tareas.
node --test packages/pos/dist/cash-shift-service.test.js packages/pos-edge-runtime/dist/cash-shift-runtime.test.js: 15/15 PASS, 0 FAIL. Este resultado no cancela defectos reproducidos ni prueba DAT-04 faltante.
node /tmp/wp016-probe.mjs: exit 0, reproduce BLK-01/02/03. Todas las bases temporales eliminadas al concluir.
Working tree del sujeto limpio tras compilación. SHA/árbol verificadas con git rev-parse; base ancestro, ahead 4, behind 0.

## Reproducción completa
```js
import { EdgeDatabaseService } from '/workspace/scratch/2f1b855c4d75/trident-review/packages/edge/dist/index.js';
import { SqliteCashShiftRepository,createPosFastifyApp } from '/workspace/scratch/2f1b855c4d75/trident-review/packages/pos-edge-runtime/dist/index.js';
import { CashShiftDomainService } from '/workspace/scratch/2f1b855c4d75/trident-review/packages/pos/dist/index.js';
import fs from 'node:fs';
const dir=fs.mkdtempSync('/tmp/wp016-probe-');
const db=new EdgeDatabaseService({databasePath:dir+'/edge.db'});
const repo=new SqliteCashShiftRepository(db);
const service=new CashShiftDomainService({repository:repo});
const command={organizationId:'ORG',branchId:'BR',stationId:'S',responsibleUserId:'U',openingCashFloat:0n};
const race=await Promise.allSettled([service.abrirTurno(command),service.abrirTurno(command)]);
console.log('OPEN_RACE',race.map(r=>r.status),db.queryRowsSafe('SELECT id,status FROM turnos_caja'));
const app=await createPosFastifyApp({edgeDb:db,organizationId:'ORG',branchId:'BR'});
const shift=await service.abrirTurno({...command,stationId:'RANGE',openingCashFloat:999999999999n});
const mov=await service.registrarMovimiento({shiftId:shift.id,operatorUserId:'U',movementType:'VENTA_EFECTIVO',amount:1n,reason:'sale',expectedVersion:shift.version});
const cut=await service.generarCorteX({shiftId:shift.id,requestedByUserId:'U'});
console.log('RANGE_TOTAL',cut.totalCalculado.toString());
const arq=await service.realizarArqueoCiego({shiftId:shift.id,performedByUserId:'U',declaredCash:999999999999n,expectedVersion:mov.shift.version});
await service.generarCorteZ({shiftId:shift.id,closedByUserId:'U',expectedVersion:arq.shift.version});
console.log('OUTBOX_RANGE',db.queryRowsSafe('SELECT payload FROM outbox_queue'));
const pinService=new CashShiftDomainService({repository:repo,pinValidator:{validatePin:async()=>false}});
const pinShift=await pinService.abrirTurno({...command,stationId:'PIN'});
const pinMov=await pinService.registrarMovimiento({shiftId:pinShift.id,operatorUserId:'U',movementType:'VENTA_EFECTIVO',amount:1n,reason:'no PIN',expectedVersion:1});
console.log('PIN_OMITTED_ACCEPTED',pinMov.movement.id);
console.log('ARQUEO_AUDIT',db.queryRowsSafe('SELECT action FROM local_audit_trail'));
await app.close();db.close();fs.rmSync(dir,{recursive:true});process.exit(0);
```

## Salida de reproducción
```text
OPEN_RACE [ 'fulfilled', 'fulfilled' ] [
  { id: 'd67fcc5e-fadd-4855-a879-c8238d9de03b', status: 'ABIERTO' },
  { id: 'f46ce572-72c3-4f46-90e5-27ddd2eaf8b2', status: 'ABIERTO' }
]
RANGE_TOTAL 1000000000000
OUTBOX_RANGE [
  {
    payload: '{"shiftId":"f28ec36e-b111-42e7-8508-e3045878436b","organizationId":"ORG","branchId":"BR","stationId":"RANGE","responsibleUserId":"U","shiftNumber":1,"openingCashFloat":"99999999.9999","totalIngresos":"0.0000","totalEgresos":"0.0000","totalVentasEfectivo":"0.0001","totalCalculado":"100000000.0000","totalDeclarado":"99999999.9999","diferencia":"-0.0001","desgloseOperadores":[{"operatorUserId":"U","totalIngresos":"0.0000","totalEgresos":"0.0000","totalVentasEfectivo":"0.0001","netCash":"0.0001","movementsCount":2}],"openedAt":"2026-10-06T17:22:37.349Z","closedAt":"2026-10-06T17:22:37.352Z"}'
  }
]
PIN_OMITTED_ACCEPTED 937fc842-de4e-486d-98f8-2753954c6f98
ARQUEO_AUDIT [ { action: 'CASH_DIFFERENCE_AUDITED' } ]
```

## Log pruebas
```text
Downloading Electron binary...
▶ TRIDENTPOS WP-016 Cash Management, Shifts & Arqueo Ciego Integration Suite (DEC-017)
  ✔ WP016-INT-01: Full REST Lifecycle: Apertura -> Operadores -> Movimientos -> Arqueo Ciego -> Corte Z (con identidad enrolled) (106.175318ms)
  ✔ WP016-INT-02: Double close blocked by OCC (HTTP 409) (7.927416ms)
  ✔ WP016-INT-03: Simulated crash during Corte Z commit guarantees atomic rollback (2.744309ms)
  ✔ WP016-INT-04: Tenant fail-closed: apertura rechaza si falta organization_id o branch_id sin defaults (4.859601ms)
  ✔ WP016-INT-04B: Tenant & Station Mismatch: foreign identities rejected with 403 and zero side-effects; missing identity uses enrolled (6.274544ms)
  ✔ WP016-INT-05: El esquema de outbox_queue y audit_trail es canónico sin importar orden de inicialización (4.107744ms)
  ✔ WP016-INT-06: ADR-012: Monto mayor a 2^53 / 10^4 sobrevive ida y vuelta en SQLite sin pérdida de precisión (2.494561ms)
✔ TRIDENTPOS WP-016 Cash Management, Shifts & Arqueo Ciego Integration Suite (DEC-017) (135.762879ms)
▶ TRIDENTPOS WP-016 Cash Management, Shifts & Arqueo Ciego Domain Suite (DEC-017)
  ✔ WP016-DOM-00: Fail-closed when tenant identity (organizationId or branchId) is missing (1.17538ms)
  ✔ WP016-DOM-01: Abre turno con fondo inicial y asignación compartida (DEC-017) (1.669919ms)
  ✔ WP016-DOM-02: Agrega operadores participantes a turno compartido (DEC-017) (0.370555ms)
  ✔ WP016-DOM-03: Rechaza movimientos de operador no participante (0.33289ms)
  ✔ WP016-DOM-04: Cálculo exacto de cuadre de caja con desglose por operador (ADR-012) (0.620283ms)
  ✔ WP016-DOM-05: Arqueo Ciego captura efectivo declarado antes de calcular descuadre (0.380801ms)
  ✔ WP016-DOM-06: Corte Z congela el turno permanentemente y previene doble cierre o mutación (0.798045ms)
  ✔ WP016-DOM-07: OCC Conflict detection on stale versions (0.320813ms)
✔ TRIDENTPOS WP-016 Cash Management, Shifts & Arqueo Ciego Domain Suite (DEC-017) (7.22118ms)
ℹ tests 15
ℹ suites 2
ℹ pass 15
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 17977.951809
```

## SHA-256 de evidencia de ejecución
- /tmp/wp016-probe.mjs: d16f4052c289e2fee49df860b2f6e17047966db27d2e553519cef5f8b8243972
- /tmp/wp016-probe.log: 1574f9fbab2c2ee3ae8401b84df5673190508478945bbd23a5662f476ebcc3a3
- /tmp/wp016-tests.log: cc8f1b5fa4e3f47d587b314d1239342a73eb627526e81753ca586efcefcfb808
- /tmp/wp016-build.log: 86736f31a33ce5da6fe53a0786fbd0ea0883363135b3e2b95833e63f0bb1b50a

## Handoff
Devuelve al Builder exclusivamente BLK-01..04 y advisories, sin cambios al sujeto. Nuevo Frozen SHA y evidencia nueva para R2. Solo PASS habilita avance del Specialist Gate. No se altera el presupuesto máximo de 2 rondas.
