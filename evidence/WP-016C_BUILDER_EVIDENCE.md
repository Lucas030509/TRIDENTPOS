# WP-016C BUILDER EVIDENCE REPORT

**Work Package:** WP-016C — POS Payment Orchestration, Shift Gating & Account Settlement  
**Gobernanza:** EAAF v1.3.0 — Perfil Lean (ACR-2026-021)  
**Rama de Implementación:** `feat/wp-016c-payment-orchestration`  
**Base Canónica:** `bb33001` (`main` post PR #64)  
**Product Owner:** Simón Sánchez  
**Fecha:** 2026-10-13  
**Status:** `READY FOR INDEPENDENT REVIEW & MERGE`  

---

## 1. Resumen Ejecutivo y Alcance Técnico

El paquete de trabajo **WP-016C** implementa la orquestación integral de cobro y liquidación de cuentas en el punto de venta local (`@trident/pos`, `@trident/pos-edge-runtime` y `@trident/core`), cerrando la brecha crítica entre la operación de comedor (`WP-014A`), la gestión de turnos de caja (`WP-016B`) y la capa de presentación UI (Wave 8):

### 1.1 Contratos Canónicos Edge API (`@trident/core`)
* Creados esquemas Zod y DTOs en `packages/core/src/contracts/edge-api/payment-contracts.ts`:
  * `PaymentMethodSchema`: Enum estricto de primer corte (`EFECTIVO`, `TARJETA`, `TRANSFERENCIA`). Métodos diferidos como RESTCARD o CXC son rechazados de forma segura en la frontera.
  * `SubmitTenderRequestSchema`: DTO de cobro con `cuentaId`, `turnoCajaId`, `operatorUserId`, `operatorPin` (DEC-017), `amount`, `tipAmount`, `cashGiven`, `referenceAuthCode`, `clientOpId` (UUIDv4).
  * `TenderResultSchema` y `AccountPaymentsSummarySchema`: DTOs de resultado y resumen de pagos con serialización canónica scale-4 `DecimalString`.
  * `CuentaPagadaEventPayloadSchema`: Contrato del evento canónico emitido al outbox al liquidar la cuenta (`FUNCTIONAL_ARCHITECTURE.md Sec 6.3`).

### 1.2 Dominio de Pagos y Liquidación (`@trident/pos`)
* Creados `payment-types.ts`, `payment-ports.ts`, y `payment-service.ts`:
  * **Idempotencia Canónica (`DATA-COND-015-02`):** Verificación por `(cuentaId, clientOpId)` antes de cualquier mutación; repeticiones devuelven el resultado previo idempotentemente (HTTP 200).
  * **Validación de PIN de Operador (`DEC-017` / `SEC-FAIL-CLOSED`):** Exigencia estricta de PIN antes de procesar cualquier cobro mediante `IamPinValidatorPort`.
  * **Shift-Gating Estricto:** Verificación de que el `turnoCajaId` exista y su estado sea estrictamente `ABIERTO`.
  * **Operador Participante:** Validación de que el cajero sea el responsable, quien abrió o un operador asignado al turno compartido (`DEC-017`).
  * **Soporte de Pagos Divididos (Split Payments):** Permite liquidaciones parciales multi-método, calculando saldo remanente y transición atómica a estado `PAGADA` al saldar el 100%.
  * **Aritmética Exacta Escala-4:** Cero uso de punto flotante en cálculo de montos, cambio de efectivo (`changeDue = cashGiven - (amount + tip)`) y validación de saldo.
  * **Movimientos de Caja Automáticos:** Registro atómico de `VENTA_EFECTIVO` en `movimientos_caja` para cobros en efectivo.

### 1.3 Persistencia y Runtime Edge (`@trident/pos-edge-runtime`)
* **DDL SQLite Canónica (`schema.ts`):**
  * Creación de la tabla `pagos` con columnas `id`, `cuenta_id`, `turno_caja_id`, `operator_user_id`, `payment_method`, `amount`, `tip_amount`, `cash_given`, `change_due`, `reference_auth_code`, `client_op_id`, `created_at`, con `UNIQUE(cuenta_id, client_op_id)`.
  * Índices en `cuenta_id`, `turno_caja_id` y `(cuenta_id, client_op_id)`.
* **Adaptador SQLite (`SqlitePaymentRepository`):**
  * Implementa `PaymentRepositoryPort` con `executeAtomicSettlement`.
  * Ejecuta la inserción en `pagos`, la actualización con OCC CAS en `cuentas`, la inserción en `movimientos_caja`, el encolamiento en `outbox_queue` (`CuentaPagada`) y la auditoría forense en `local_audit_trail` bajo una **única transacción SQLite sincrónica** (`DATA-COND-015-01`).
* **Endpoints Fastify (`fastify-app.ts`):**
  * `POST /cuentas/:id/pagos` y `POST /api/v1/pos/cuentas/:id/pagos`: Procesamiento de cobro, validación de Zod, disparo de apertura de cajón de dinero (`kickDrawer`) y serialización DTO.
  * `GET /cuentas/:id/pagos` y `GET /api/v1/pos/cuentas/:id/pagos`: Resumen de pagos y estado de saldo.

---

## 2. Invariantes Arquitectónicos y de Calidad Verificados

1. **Atomic Settlement (`DATA-COND-015-01`):**
   * Verificado mediante simulación de falla en commit (`WP016C-T08`): un fallo de commit genera reversión total sin dejar pagos huérfanos, sin alterar el estado de la cuenta, sin registrar movimientos de caja y sin encolar eventos en outbox.
2. **Idempotencia Estricta (`DATA-COND-015-02`):**
   * Verificado en `WP016C-T04`: el reenvío de un cobro con el mismo `clientOpId` devuelve 200 con el registro existente sin duplicar registros ni duplicar ingresos de efectivo en la caja.
3. **Escala-4 Moneda y Zero Floats (`ADR-012`):**
   * Todos los cálculos usan `BigInt` escala 4 (factor 10000n). El almacenamiento SQLite almacena números enteros (`INTEGER`).
4. **Grafo Acíclico (`ADR-013` / `scripts/check-graph.mjs`):**
   * Contratos en `@trident/core`, lógica en `@trident/pos`, composición y HTTP en `@trident/pos-edge-runtime`. 44/44 checks en verde.

---

## 3. Resultados de Pruebas y Cobertura

| Suite de Validación | Comando | Resultado |
| :--- | :--- | :---: |
| **Dependency Graph Constraints** | `npm run graph:check` | **44 / 44 PASS** |
| **@trident/core Tests** | `npm test --workspace=@trident/core` | **63 / 63 PASS** |
| **@trident/pos Tests** | `npm test --workspace=@trident/pos` | **50 / 50 PASS** |
| **@trident/pos-edge-runtime Tests** | `npm test --workspace=@trident/pos-edge-runtime` | **47 / 47 PASS** |
| **TypeScript Monorepo Compilation** | `npm run typecheck` | **20 / 20 PASS (0 errores)** |
| **ESLint Validation (paquetes modificados)** | `npm run lint --workspace=@trident/core ...` | **PASS (0 errores, 0 warnings)** |
