# WP-014A BUILDER EVIDENCE REPORT

**Work Package:** WP-014A — Dining Operations Expansion & Edge REST API Contracts  
**Gobernanza:** EAAF v1.3.0 — Perfil Lean (ACR-2026-021)  
**Rama de Implementación:** `feat/wp-014a-dining-ops`  
**Base Canónica:** `b59f84e749eafe5a417beb9a62f41da5c9d629c6` (`main` post PR #66)  
**Product Owner:** Simón Sánchez (Resolución OQ `ARCH-DEC-002`)  
**Fecha:** 2026-10-13  
**Status:** `READY FOR INDEPENDENT REVIEW & MERGE`  

---

## 1. Alcance Técnico e Implementación de Decisiones de Producto

Este paquete de trabajo expande el dominio operativo de restaurante (`@trident/pos`), el runtime local (`@trident/pos-edge-runtime`) y los contratos transversales en `@trident/core` incorporando las resoluciones formales del Product Owner ([`DEC-010`, `DEC-011`, `DEC-013`, `DEC-015`](../PRODUCT_OWNER_OQ_RESOLUTION.md)):

### 1.1 DEC-010: Cancelación Post-Cocina según Estado en KDS
* **Regla:**
  * Ítems no iniciados en cocina (`SIN_INICIAR`, `PENDIENTE`): cancelación permitida con motivo de catálogo sin generar merma.
  * Ítems en preparación, listos o entregados: exigen validación de PIN de supervisor/gerente y generan automáticamente bandera de merma (`requiresWasteRecord = true`), enlazada al outbox y al kárdex de inventarios.
* **Componentes:** `KdsStateBasedCancellationPolicy` en `@trident/pos/policies.ts` y método `cancelItemSync` en `DiningDomainService`.

### 1.2 DEC-011: Transferencia de Cuenta con PIN del Mesero Receptor
* **Regla:** El comando de reasignación/transferencia de cuenta o mesa exige `targetWaiterPin` validado mediante `IamPinValidatorPort`. Si el receptor no valida su PIN, la cuenta permanece con el mesero original.
* **Componentes:** `ReceivingWaiterPinTransferValidationRule` en `@trident/pos/policies.ts` y método `transferTableSync` en `DiningDomainService`.

### 1.3 DEC-013: Cancelación de Cuenta con Precuenta Impresa
* **Regla:** La anulación de una cuenta con precuenta impresa (folio de venta ya asignado) exige motivo obligatorio y PIN de gerente/supervisor. El folio queda anulado permanentemente (cero reciclaje de folios per ADR-008).
* **Componentes:** Método `cancelPrintedCuentaSync` en `DiningDomainService`.

### 1.4 DEC-015: Prorrateo Proporcional al Dividir Cuenta (Split Bill)
* **Regla:** Al dividir cuentas por ítems, partes iguales o ratios, los descuentos y propinas generales se distribuyen proporcionalmente sobre los subtotales de cada subcuenta calculados en aritmética exacta escala-4 (`BigInt`). El residuo de redondeo se asigna a la última subcuenta garantizando el invariante $\sum \text{subcuentas} = \text{total original}$.
* **Componentes:** `ProportionalBillSplitStrategy` en `@trident/pos/policies.ts` y método `splitCuentaSync` en `DiningDomainService`.

### 1.5 Decisión FE-08 / Contratos Desacoplados Edge API en `@trident/core`
* **Solución al Bloqueo FE05-R1-BLK-01 (PR #64):**
  * Para evitar violaciones del grafo de dependencias (`ADR-013`), se crearon los esquemas de validación Zod y DTOs canónicos en `packages/core/src/contracts/edge-api/dining-contracts.ts`.
  * La UI y el runtime de Electron pueden importar tipos contractuales desde `@trident/core` sin generar dependencias circulares ni requerir que `core` importe `pos` o `pos-edge-runtime`.

---

## 2. Invariantes de Seguridad y Calidad Verificados

1. **Fail-Closed PIN Validation:**
   * `DiningDomainService` exige obligatoriamente un `IamPinValidatorPort` en constructor.
   * `createPosFastifyApp` suministra un validador fail-closed por defecto (`() => false`) en caso de no especificarse `offlineIamService`, garantizando que ninguna operación privilegiada (cancelaciones, anulaciones o traspasos) pueda ejecutarse sin validación real.
2. **Exactitud Numérica ADR-012:**
   * Todos los montos, impuestos, propinas y descuentos persisten en SQLite en escala-4 `BigInt`. Cero coerción flotante `Number()`.
3. **Respeto Estricto al Grafo de Paquetes ADR-013:**
   * 44/44 reglas de frontera aprobadas en `npm run graph:check`. Cero dependencias circulares.

---

## 3. Resultados de Pruebas y Construcción

| Suite de Validación | Comando | Resultado |
| :--- | :--- | :---: |
| **Dependency Graph Constraints** | `npm run graph:check` | **44 / 44 PASS** |
| **@trident/core Unit Suite** | `npm test --workspace=@trident/core` | **60 / 60 PASS** |
| **@trident/pos Unit Suite** | `npm test --workspace=@trident/pos` | **41 / 41 PASS** |
| **@trident/pos-edge-runtime Suite** | `npm test --workspace=@trident/pos-edge-runtime` | **37 / 37 PASS** |
| **TypeScript Monorepo Compilation** | `npm run typecheck` | **20 / 20 PASS (0 errores)** |
| **Monorepo Build** | `npm run build` | **12 / 12 PASS (0 errores)** |
| **ESLint Validation** | `npm run lint` | **12 / 12 PASS (0 errores)** |
| **Prettier Formatting** | `npm run format:check` | **PASS (100% compliant)** |
