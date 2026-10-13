# TRIDENTPOS Builder Evidence: WP-022 CRM Customer Profiles & Loyalty Rewards Engine (RestCard)

## 1. Executive Summary
- **Work Package:** WP-022 — CRM Customer Profiles & Loyalty Rewards Engine (RestCard)
- **Framework Profile:** EAAF v1.3.0 (ACR-2026-021 / Lean Profile)
- **Target Subsystem:** Customer Management, Loyalty Program, RestCard Prepaid Cash Wallet, and PostgreSQL Multi-Tenant Database
- **Architecture Baseline:** `IMPLEMENTATION_PLAN.md` Sec. 1160–1210, `ADR-012` (Fixed point scale-4 integers & zero floating-point math), `ADR-013` (Domain purity & Core-only internal dependency), `SEC-VAL-11` (Technical PII Purge & Anonymization Routine).
- **Security & Integrity Boundary:** Multi-tenant RLS forzado (`current_app_org_id()`), trigger append-only inmutable en transacciones de lealtad (`trg_loyalty_tx_immutable`), prevención estricta de doble gasto de puntos y saldo prepago, validación sintáctica de RFC mexicano (SAT), normalización de telefonía móvil para Caller-ID de alta velocidad en POS, y rutina criptográfica/pseudonimizadora de PII para cumplimiento normativo sin quebrar integridad referencial contable.

---

## 2. Components & Artifacts Implemented

### 2.1 Pure Domain Engine (`packages/crm/`)

Conformando estrictamente a `ADR-013`, `@trident/crm` no posee dependencias externas ni de infraestructura, dependiendo únicamente de `@trident/core`.

1. **`packages/crm/package.json` & `tsconfig.json`:**
   - Declaración de workspace monorepo `@trident/crm` con `type: "module"` y dependencia canónica `@trident/core: "*"`.
   - Compilación con TypeScript `NodeNext`.

2. **`packages/crm/src/types.ts`:**
   - Modelos de datos de dominio: `Customer`, `CustomerDeliveryAddress`, `LoyaltyAccount`, `LoyaltyTransaction`, `Promotion`.
   - Enums canónicos: `LoyaltyTier` (`BRONZE`, `SILVER`, `GOLD`, `PLATINUM`), `LoyaltyTransactionType` (`EARN`, `REDEEM`, `EXPIRE`, `ADJUSTMENT`, `REVERSAL`, `TOPUP`, `CASH_PAYMENT`), `PromotionType` (`PERCENTAGE_DISCOUNT`, `FIXED_DISCOUNT`, `BIRTHDAY_REWARD`, `POINTS_MULTIPLIER`).
   - DTOs de operación: `AccruePointsParams`, `RedeemPointsParams`, `RestCardTopUpParams`, `RestCardChargeParams`, `ReversalParams`, `EvaluatePromotionParams`, `CustomerRegistrationParams`.

3. **`packages/crm/src/numerics.ts`:**
   - Cumplimiento de `ADR-012` y `SYS-INV-001` mediante aritmética de punto fijo en escala-4 (`0.0000`) respaldada por `BigInt`.
   - Primitivas: `toScale4BigInt`, `fromScale4BigInt`, `addScale4`, `subScale4`, `multiplyScale4`, `divideScale4`, `absScale4`, `compareScale4`.

4. **`packages/crm/src/errors.ts`:**
   - Jerarquía exhaustiva de errores de dominio:
     - `InsufficientLoyaltyPointsError`
     - `InsufficientRestCardBalanceError`
     - `LoyaltyAccountInactiveError`
     - `InvalidCustomerPhoneError`
     - `InvalidCustomerRfcError`
     - `CreditLimitExceededError`
     - `InvalidPromotionError`

5. **`packages/crm/src/loyalty-engine.ts`:**
   - Multiplicadores por nivel:
     - `BRONZE`: 1.0x
     - `SILVER`: 1.25x
     - `GOLD`: 1.5x
     - `PLATINUM`: 2.0x
   - Cálculo determinista de puntos acumulados (`calculatePointsEarned`).
   - Acumulación de puntos con ascenso automático de nivel según umbrales de puntos de por vida (`accruePoints`).
   - Redención segura de puntos con cálculo de descuento monetario y validación fail-closed de no-doble gasto (`redeemPoints`).
   - Monedero prepago **RestCard**: recarga de saldo (`topUpRestCardBalance`) y cobro de consumos (`chargeRestCardBalance`).
   - Reversiones compensatorias de transacciones previas (`createCompensatingReversal`) con restauración de saldo y recalibración de nivel.
   - Algoritmo de detección de puntos expirados (`computeExpiredPoints`).
   - Motor de evaluación de promociones (`evaluatePromotion`) verificando ventanas de fechas, montos mínimos y recompensas de cumpleaños.

6. **`packages/crm/src/customer-service.ts`:**
   - Normalización de números telefónicos (`normalizePhoneNumber`) para Caller-ID de alta velocidad en POS:
     - Limpieza de caracteres no numéricos.
     - Manejo de prefijo internacional mexicano `+52` (12 dígitos) y telefonía celular `+521` (13 dígitos), normalizando a 10 dígitos locales estándar.
     - Validación estricta fail-closed (longitudes inválidas lanzan `InvalidCustomerPhoneError`).
   - Validación y sanitización de RFC mexicano SAT (`validateMexicanRfc` & `sanitizeCustomerInput`):
     - Personas Morales: 12 caracteres alfanuméricos con regex `^[A-Z&Ñ]{3}[0-9]{6}[A-Z0-9]{3}$`.
     - Personas Físicas: 13 caracteres alfanuméricos con regex `^[A-Z&Ñ]{4}[0-9]{6}[A-Z0-9]{3}$`.
     - RFCs genéricos oficiales: `XAXX010101000` (nacional) y `XEXX010101000` (extranjero).
   - Control de límites de crédito y sobregiro (`validateCustomerCreditCharge`).
   - **`SEC-VAL-11` — Rutina Técnica de Purga y Anonimización de PII (`purgeCustomerPii`):**
     - Anonimización irreversible de nombre, teléfono (`+520000000000`), correo (`anonymized-<id>@deleted.tridentpos.internal`) y RFC (`XAXX010101000`).
     - Borrado de notas, fecha de nacimiento y direcciones de entrega.
     - Marcado de cliente como inactivo (`isActive: false`).
     - Preservación íntegra de `id` y `orgId` para mantener la consistencia referencial con ventas históricas, facturas y pólizas contables.

---

### 2.2 PostgreSQL Database Scaffolding & Migration (`packages/database/`)

1. **Migración SQL `packages/database/migrations/20261014000000_crm_loyalty_rewards.sql`:**
   - Cinco tablas físicas relacionales multi-tenant:
     - `customers`: Directorio maestro de clientes con RFC, teléfono, límite de crédito y bandera de PII purgado.
     - `customer_delivery_addresses`: Direcciones de entrega asociadas a clientes con soporte de coordenadas geográficas y referencias de entrega.
     - `loyalty_accounts`: Cuentas de lealtad y monedero RestCard con saldos en escala-4 (`NUMERIC(14,4)`), niveles y estados.
     - `loyalty_transactions`: Ledger append-only de movimientos de lealtad y monedero.
     - `promotions`: Reglas de promociones y descuentos automáticos.
   - **Row Level Security (RLS) & FORCE RLS:**
     - Aplicado en las 5 tablas con aislamiento estricto `tenant_isolation_policy` contra `current_app_org_id()`.
     - `FORCE ROW LEVEL SECURITY` habilitado en todas las tablas para bloquear accesos directos incluso de roles de tabla.
   - **Índices de Alto Rendimiento:**
     - `idx_customers_org_phone` para Caller-ID instantáneo en conmutador/POS.
     - `idx_loyalty_accounts_org_card` para búsqueda táctil por código de barras / NFC de RestCard.
     - `idx_loyalty_tx_org_account` y `idx_promotions_org_active`.
   - **Inmutabilidad de Ledger (PostgreSQL Trigger):**
     - Función `trg_fn_loyalty_transactions_immutable()` y trigger `trg_loyalty_tx_immutable` que prohíbe `UPDATE` y `DELETE` en `loyalty_transactions`.
   - **Down Migration Limpia:**
     - Rollback determinista y no destructivo de tablas y funciones de WP-022 preservando predecesores.

2. **Suite de Pruebas de Base de Datos (`packages/database/src/crm.test.ts`):**
   - 10 pruebas automatizadas integradas en el pipeline de tests:
     - `WP022-DB-01`: Existencia física de las 5 tablas de WP-022.
     - `WP022-DB-02`: RLS y FORCE RLS habilitados en todas las tablas.
     - `WP022-DB-03`: Default-deny devuelve 0 filas sin contexto de tenant.
     - `WP022-DB-04`: Separación estricta de visibilidad entre Tenant A y Tenant B.
     - `WP022-DB-05`: Llave candidata `(org_id, code)` rechaza duplicados dentro del mismo tenant pero los permite entre diferentes tenants.
     - `WP022-DB-06`: Llave candidata `(org_id, card_number)` y check constraints de puntos/saldos.
     - `WP022-DB-07`: Trigger inmutable rechaza terminantemente `UPDATE` y `DELETE` directos.
     - `WP022-DB-08`: Rechazo estricto de claves foráneas cross-tenant.
     - `WP022-DB-09`: Integridad en concurrencia de saldos de monedero RestCard.
     - `WP022-DOWN-01`: Rollback down migration revierte tablas de WP-022 preservando íntegros los predecesores (`fiscal_invoices`, `accounts_payable`, etc.).

---

## 3. Test & Verification Matrix

### 3.1 Unit Test Execution (`@trident/crm`)
```
▶ TRIDENTPOS WP-022: CRM & Loyalty Rewards Engine Suite
  ▶ Numerics & Scale-4 Precision
    ✔ performs exact Scale-4 addition, subtraction, multiplication, and division
  ▶ Loyalty Tier Resolution & Accrual
    ✔ resolves tiers monotonically according to points thresholds
    ✔ calculates points earned applying tier multiplier and rule bonus
    ✔ applies points accrual and upgrades tier automatically
  ▶ Points Redemption & Double Spend Prevention
    ✔ redeems points within available balance and calculates monetary discount
    ✔ rejects points redemption exceeding available balance fail-closed
    ✔ rejects points redemption when loyalty account is suspended/inactive
  ▶ RestCard Prepaid Cash Wallet
    ✔ tops up RestCard prepaid balance and generates audit transaction
    ✔ charges payment against RestCard wallet successfully
    ✔ rejects RestCard payment exceeding prepaid balance fail-closed
  ▶ Compensating Reversals
    ✔ creates accurate compensating reversal restoring balances and downgrading tier if applicable
  ▶ Points Expiry & Retention Calculation
    ✔ identifies expired EARN transactions older than configured validity window
  ▶ Promotions Engine
    ✔ evaluates percentage discount promotion during validity window
    ✔ evaluates birthday promotion matching customer birth month
  ▶ Customer Phone Normalization & Caller-ID Optimization
    ✔ normalizes various phone input formats to clean 10-digit format
    ✔ rejects invalid phone numbers fail-closed
  ▶ Mexican RFC Validation & Customer Sanitization
    ✔ validates personas físicas, morales and generic RFCs
    ✔ sanitizes customer registration input and rejects malformed RFC
  ▶ Customer Credit Limit & Overdraft Controls
    ✔ permits credit charge within authorized limit
    ✔ rejects credit charge exceeding credit limit when overdraft is disallowed
    ✔ permits credit charge exceeding limit when allowOverdraft is enabled
  ▶ SEC-VAL-11: Technical Data Retention Purge Routine
    ✔ anonymizes customer PII and scrubs delivery addresses while preserving ledger IDs
✔ TRIDENTPOS WP-022: CRM & Loyalty Rewards Engine Suite
ℹ tests 22
ℹ suites 12
ℹ pass 22
ℹ fail 0
```

### 3.2 Database Integration Test Execution (`@trident/database`)
```
▶ TRIDENTPOS WP-022 CRM & Loyalty Database Suite
  ✔ WP022-DB-01: Exact five WP-022 physical tables exist
  ✔ WP022-DB-02: RLS and FORCE RLS are enabled on all five WP-022 tables
  ✔ WP022-DB-03: Tenant default-deny returns 0 visible rows without tenant context
  ✔ WP022-DB-04: Tenant visibility separation between Tenant A and Tenant B
  ✔ WP022-DB-05: Customer candidate key (org, code) rejects duplicates in same tenant but allows in different
  ✔ WP022-DB-06: Loyalty card candidate key (org, card_number) and check constraints
  ✔ WP022-DB-07: Append-only trigger rejects direct UPDATE and DELETE on loyalty_transactions
  ✔ WP022-DB-08: Cross-tenant foreign key relationships are strictly rejected
  ✔ WP022-DB-09: Concurrent points balance mutation integrity
  ✔ WP022-DOWN-01: Non-production rollback reverts WP-022 tables while preserving predecessors
✔ TRIDENTPOS WP-022 CRM & Loyalty Database Suite
ℹ tests 10
ℹ suites 1
ℹ pass 10
ℹ fail 0
```

### 3.3 Monorepo Health & Quality Gates
- **`npm run graph:check`**: 44/44 PASS, 0 ciclos, 14 paquetes monorepo validados.
- **`npm run typecheck`**: 23/23 tasks successful (0 errores).
- **`npm run lint`**: 0 errores en todos los paquetes.
- **`npm run format:check`**: All files formatted per Prettier standard.

---

## 4. Conclusion & Disposition
WP-022 queda completado con éxito, garantizando la arquitectura modular, pureza de dominio, inmutabilidad contable y protección multi-tenant de datos de clientes, lealtad y monedero RestCard.
Listo para commit y merge en `main`.
