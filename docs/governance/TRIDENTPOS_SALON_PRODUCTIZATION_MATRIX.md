# TRIDENTPOS — SALÓN PRODUCTIZATION MATRIX (VERIFIED)

**Status:** `PROPOSED — PENDING INDEPENDENT REVIEW / NOT CANONICAL / NOT APPROVED`
**Companion to:** `ARCHITECTURE_CHANGE_REQUEST_SALON_PRODUCTIZATION.md` (`ACR-2026-015` candidate)
**Derived from:** `TRIDENTPOS_SALON_PRODUCTIZATION_MATRIX_DRAFT.md` (Coordinator/PO input, non-canonical), corrected after independent verification against canonical documents on `main` @ `f655551085dea3cff887a411adec4026842aed07`.

> This is supporting evidence, not an approval record. It does not itself authorize any Work Package, and its classifications are subject to the same independent review as the ACR candidate it supports.

## 1. Correction Log vs. the Original Draft

The original draft used `WP-014B` for the dining-operations extension throughout its matrix and roadmap sections. This document and the ACR candidate it supports use **`WP-014A`** instead — see `ARCHITECTURE_CHANGE_REQUEST_SALON_PRODUCTIZATION.md` Section 0.1 for why. Every row below that referenced `WP-014B` in the original draft has been relabeled `WP-014A`.

Two additional corrections, grounded in canonical documents the original draft did not cite:

- The `pagos` table (`DATA_MODEL.md` Sec. 3) already exists in frozen schema and is already unowned by any WP — this is stronger evidence for the "Cobro tarjeta/efectivo/transferencia/mixto" rows being a genuine `ROADMAP GAP` than the original draft's reasoning (which cited only the preview, not the frozen schema).
- `RESTCARD` and `CXC`, present in the frozen `pagos.payment_method` enum, have no row in this matrix at all (original draft did not surface them either). They are called out explicitly in the ACR candidate (Section G.5) as excluded from `WP-016C`'s first slice and are listed here for completeness.

## 2. Baseline Used

- Product repo: `Lucas030509/TRIDENTPOS`
- Canonical `main` (verified via `git fetch origin` this session): `f655551085dea3cff887a411adec4026842aed07`
- Preview V4: `design/ui-preview-pos-floor-v4-functional-salon` @ `ab15b7dad62a14a78f606b64f7fc7d27613f343a`
- `WP-014`: DONE/CANONICAL (verified: `evidence/WP-014_BUILDER_EVIDENCE.md`, merged PR #40)
- `WP-016B`: DONE/CANONICAL (verified: `evidence/WP-016B_BUILDER_EVIDENCE.md`, merge commit **is** canonical `main` tip)
- `WP-015`, `WP-016`, `WP-026`: PENDING (verified: no builder evidence file exists for any of the three)
- `WP-017`: technically unblocked, pending clean restart (verified: dangling non-merged `feature/wp-017-inventory-recipes` branch)
- Protected PO decisions: `OQ-SSOT-01`, `OQ-SSOT-02`, `OQ-SSOT-06`, `OQ-SSOT-07`, `OQ-ARCH-01` — all confirmed absent from `PRODUCT_DECISIONS.md`, i.e. still open

## 3. Classification

| Capability V4 | Estado real hoy | Productización | Backend / dominio | Frontend productivo | Dependencia / gate |
|---|---|---|---|---|---|
| Grid de mesas / áreas | Base soportada | READY FOR PRODUCTIZATION | WP-014 | WP-026B | Ninguno |
| Abrir mesa / cuenta | Soportado parcialmente | READY FOR PRODUCTIZATION | WP-014 `POST /cuentas` | WP-026B | Contratos canónicos |
| Abrir cuenta ocupada | Soportado | READY FOR PRODUCTIZATION | WP-014 | WP-026B | OCC / expectedVersion |
| Agregar productos | Soportado | READY FOR PRODUCTIZATION | WP-014 `POST /ordenes/partidas` | WP-026B | Money ADR-012 |
| Modificadores de producto | Persistencia base existe; semántica receta abierta | PARTIAL | WP-014 + WP-017 | WP-026B | OQ-SSOT-07 |
| Enviar a cocina | Preview only hoy | DEPENDS ON WP-015 | WP-015 | WP-026C | WP-015 |
| Preparación / listo / servido | Preview only | DEPENDS ON WP-015 | WP-015 KDS | WP-026C | Definir estados/eventos KDS canónicos |
| Atención operacional | Preview projection | NEEDS CAPABILITY EXTENSION | WP-014A / proyección de eventos | WP-026B | No almacenar como Mesa.status (verified: no such enum literal in frozen `mesas` DDL) |
| Solicitar cuenta / Por cobrar | Preview projection | NEEDS CAPABILITY EXTENSION | WP-014A | WP-026B | Cuenta/Precuenta, DEC-006 (verified APROBADA) |
| Imprimir precuenta | Contrato conceptual, no productizado | NEEDS CAPABILITY EXTENSION | WP-014A | WP-026B | Folio sólo al imprimir precuenta (DEC-006) |
| Cerrar cuenta | Forma base soportada | PARTIAL | WP-014 `PUT /cuentas/:id/cerrar` | WP-026D | Pago real todavía falta (WP-016C) |
| Cobro tarjeta | Preview only | **ROADMAP GAP — verified via orphaned frozen `pagos` schema, `CAP-OPS-07`, `DATA_AUTHORITY_MATRIX.md`** | WP-016C | WP-026D | Payment adapter/terminal |
| Cobro efectivo | Preview only | ROADMAP GAP | WP-016C + WP-016 | WP-026D | Turno/caja (verified: `pagos.turno_caja_id NOT NULL` for ALL methods, not just cash) |
| Cobro transferencia | Preview only | ROADMAP GAP | WP-016C | WP-026D | Política de referencia configurable |
| Pago mixto | Preview only | ROADMAP GAP | WP-016C | WP-026D | Ledger de tender lines |
| Cobro RESTCARD (prepago/lealtad) | No en preview V4 explícitamente; enum ya existe en schema | **EXCLUDED FROM WP-016C FIRST SLICE** | WP-022 (CRM/Loyalty) dependency | WP-026D (future) | Requiere WP-022 |
| Cobro CXC (cuentas por cobrar) | No en preview V4 explícitamente; enum ya existe en schema | **EXCLUDED FROM WP-016C FIRST SLICE** | Finance/CRM, OQ-SSOT-03 | WP-026D (future) | OQ-SSOT-03 sin resolver |
| Confirmar cierre + liberar mesa | Shape parcial | DEPENDS ON PAYMENT | WP-014 + WP-016C | WP-026D | Saldo 0 + auditoría |
| Cambiar mesero | Preview only | NEEDS CAPABILITY EXTENSION | WP-014A | WP-026B | Auditoría |
| Cambiar personas | Preview only | NEEDS CAPABILITY EXTENSION | WP-014A | WP-026B | Auditoría |
| Mover mesa | Preview only | BLOCKED SEMANTICS | WP-014A | WP-026B | OQ-SSOT-02 |
| Unir mesas | Preview only | NEW DOMAIN SEMANTICS — **flagged: no frozen semantic model exists; hook-only until specified** | WP-014A candidato | WP-026B | Definir semántica cuenta principal/grupo antes de implementar más allá de un hook |
| Dividir cuenta | Preview only | BLOCKED SEMANTICS | WP-014A | WP-026B/D | OQ-SSOT-06 |
| Aplicar descuento | Preview only | NEEDS POLICY / DOMAIN | WP-014A o WP-016C | WP-026D | Política de autorización por definir |
| Cancelar cuenta/items | Hook existe | BLOCKED SEMANTICS | WP-014A | WP-026B/D | OQ-SSOT-01 |
| Liberar mesa forzada | Preview only | NEEDS POLICY | WP-014A | WP-026B | autorización/auditoría |
| Historial operacional | Preview only | NEEDS EVENT/AUDIT DESIGN | WP-014A + infraestructura de outbox existente (WP-012) | WP-026B | No confundir con security audit; reutilizar patrón de outbox, no inventar uno nuevo |
| Reservaciones | **No existe en catálogo actual — cero menciones en PRODUCT_SCOPE.md / CAPABILITY_MAP.md / MODULE_CATALOG.md / DATA_MODEL.md / IMPLEMENTATION_PLAN.md (verificado)** | OUT OF CURRENT ARCHITECTURE | Nuevo ACR/WP futuro | Future UI | Nueva capacidad/bounded-context decision |
| KPIs de estado | Preview | PRESENTATION + READ MODEL | WP-014A read model | WP-026B | derivados, no source of truth |
| Floor plan operativo | Preview | NEEDS PERSISTENCE EXTENSION | WP-014A/config | WP-026B | coordenadas/layout |
| Floor plan editor | Preview | CONFIGURATION SCOPE | Nuevo sub-WP de configuración | WP-026B/Backoffice | permisos + persistencia |
| Selector sucursal | Preview | PLATFORM INTEGRATION | WP-004/005 + edge context | WP-026A/B | cambio de contexto seguro |
| Búsqueda global | Preview | PHASED | local mesas/cuentas primero | WP-026B | clientes requiere WP-022 |
| Notificaciones | Preview | PHASED EVENT PROJECTION | WP-014A/015/018 events | WP-026B | cross-context event projection |
| Roles/permisos | Preview fixtures | MUST USE CANONICAL IAM | WP-005/WP-010 | WP-026A/B | no inventar RBAC |
| Dashboard local | Preview | LATER | read models / analytics | WP-026A / WP-024 según superficie | no bloquear Salón MVP |

## 4. Conclusión Principal (Verificada)

El preview V4 demuestra una UX viable. Independientemente del preview, la revisión del baseline canónico confirma dos hallazgos concretos que el draft original no citaba:

1. La tabla `pagos` ya existe en `DATA_MODEL.md` (frozen) y no pertenece a ningún WP existente como Data Object — esto es evidencia de schema, no solo de UX, de que falta un WP de orquestación de pagos.
2. `CAPABILITY_MAP.md` ya asigna `CAP-OPS-07 [Cobro y Split Payment]` a TRIDENTPOS con prioridad P0, y `FUNCTIONAL_ARCHITECTURE.md` Sec. 6.3 ya define el evento `CuentaPagada` emitido por TRIDENTPOS y consumido condicionalmente por Finance/Billing/Loyalty. La regla de ownership propuesta para `WP-016C` no es una decisión nueva — es la implementación de un contrato ya congelado.

No se recomienda implementar la V4 directamente sobre `WP-026` como un único paquete. Esta recomendación se mantiene y se refuerza tras verificación independiente.

## 5. Propuesta de Cambio de Roadmap (Ver ACR Candidato para el Texto de Gobernanza Completo)

Todos los IDs (`WP-014A`, `WP-016C`, `WP-026A`–`D`) son PROVISIONALES, verificados sin conflicto de numeración, y requieren aprobación del Product Owner y revisión independiente antes de convertirse en canónicos. Ver `ARCHITECTURE_CHANGE_REQUEST_SALON_PRODUCTIZATION.md` Secciones G–I para el texto de gobernanza autoritativo de este candidato.

## 6. Lo Que NO Debe Productizarse Todavía (Confirmado)

- **Reservaciones** — confirmado ausente de toda la arquitectura canónica (ver Sección 2).
- **Automatización completa de Atención como fuente de verdad** — confirmado: ningún literal de enum de atención existe en el DDL congelado de `mesas`.
- **Global search cross-context** — primera versión local; CRM/customer search requiere `WP-022`.
- **RESTCARD y CXC como formas de pago en `WP-016C`** — confirmado en el schema congelado (`pagos.payment_method`) pero fuera del alcance de la primera rebanada de `WP-016C` (ver Sección 3).

## 7. Definition of Productization PASS (Sin Cambios Respecto al Draft Original)

V4 itself is NOT a PASS for production. A capability can be marked PRODUCTIZED only when:

- exact canonical contract exists
- protected PO semantics are either explicitly decided or parameterized without hidden default
- implementation WP passed specialist + code review
- UI consumes canonical API/contract, not preview fixtures
- no browser-memory `PREVIEW_*` source remains
- OCC/conflict UX is tested
- offline behavior is tested where applicable
- payment operations are idempotent (see ACR candidate Section G.3 for the concrete schema gap this must close)
- operational events are auditable
- responsive/touch UX passes real-browser/device validation
- post-merge CI/security PASS
