# TRIDENTPOS Builder Evidence: WP-026D Terminal de Caja & Cobro Táctil

## 1. Executive Summary
- **Work Package:** WP-026D — Terminal de Caja & Cobro Táctil (`/caja`)
- **Framework Profile:** EAAF v1.3.0 (ACR-2026-021 / Lean Profile)
- **Target Route:** `/caja` (Terminal de Cobro de Caja, Liquidación Financiera, Arqueo Ciego y Cortes de Turno)
- **Architecture Baseline:** `FRONTEND_ARCHITECTURE.md` (Approved in PR #64), `IMPLEMENTATION_PLAN.md` Sec. 1134–1158, `WP-016` (Cash Management & Shifts), `WP-016C` (Payment Orchestration & Account Settlement), `DEC-015` (Direct Payments Edge), `DEC-017` (Shared Cash Shifts & Blind Cash Count), `ADR-012` (Fixed point scale-4 integers & zero floating-point math), `VISUAL_SYSTEM.md` (WCAG 2.2 AA, touch targets ≥ 48px, numeric keypad 72px).
- **Security & Network Boundary:** Renderer enforces strict isolation (`connect-src 'none'`), consuming events strictly through typed IPC bridge (`window.trident.caja` and `window.trident.events`), zero business rule ownership defined in UI (delegated to `@trident/pos` / `@trident/pos-edge-runtime`), mandatory operator PIN per tender/movement.

---

## 2. Components Implemented (`@trident/pos-renderer/src/features/caja/`)

### 2.1 CajaHeader (`CajaHeader.tsx`)
- Indicador de estado del turno de caja (`ABIERTO` -> verde DISPONIBLE / `CERRADO` -> rojo BLOQUEADA / `NO_INICIADO` -> amarillo POR_VENCER).
- Folio de turno activo y cajero responsable autenticado.
- Métricas financieras en tiempo real con `MoneyText` en escala-4:
  - Fondo Inicial (`startingCash`).
  - Saldo Efectivo en Caja (`currentBalance`, destacado en verde `isPositiveGreen`).
  - Hora de apertura (`HH:MM`).
  - Estrategia de Turno: Compartido (`assignmentStrategy: 'COMPARTIDO'`, DEC-017).
- Botones de acción ergonómicos con touch targets ≥ 48px:
  - Si el turno está cerrado: Botón primario destacado **"Abrir Turno de Caja"** (`onOpenShiftClick`).
  - Si el turno está abierto:
    - **"Movimiento de Efectivo"** (`onMovementClick`).
    - **"Corte X (Parcial)"** (`onCorteXClick`).
    - **"Arqueo Ciego / Corte Z"** (`onArqueoClick`, peligro outline).

### 2.2 CuentasPorCobrarList (`CuentasPorCobrarList.tsx`)
- Bandeja táctil de cuentas pendientes de liquidación y cobro.
- Buscador integrado accesible con campo de texto reactivo (búsqueda por mesa, folio `#`, o canal).
- Píldoras de filtrado por canal con touch targets ≥ 44px:
  - `Todas`: Universo de cuentas pendientes.
  - `Comedor`: Mesas del salón.
  - `Mostrador`: Cuentas para llevar.
  - `Delivery`: Pedidos de plataformas (Rappi, Uber, Domicilio).
- Tarjetas táctiles estructuradas (mínimo 64px de alto) con:
  - Mesa o Folio (`Mesa 2`, `Mesa 3`, `Mostrador #1044`).
  - Badges de estado (`EN_CUENTA` para cuentas pedidas con precuenta impresa / `DISPONIBLE` para abiertas).
  - Número de comensales y mesero.
  - Total pendiente destacado con `MoneyText` en escala-4.
- Selección activa con borde primario y relieve visual.
- Estado vacío accesible (`EmptyState`) cuando no hay cuentas pendientes.

### 2.3 TenderPaymentView (`TenderPaymentView.tsx`)
- Panel táctil central de liquidación de la cuenta seleccionada:
  - Folio de cuenta, Mesa y desglose resumido de partidas ordenadas.
  - Desglose financiero canónico: Subtotal, Impuestos (IVA 16%), Descuentos, Total a Liquidar.
- **Selector Táctil de Propinas:**
  - Opciones rápidas de porcentaje: `0%` (Sin Propina), `10%`, `15%`, `20%`, o `Manual`.
  - Cálculo transparente de propina sobre subtotal sin punto flotante.
  - Visualización reactiva del Total a Liquidar con Propina.
- **Selector de Métodos de Pago (`PaymentMethod`):**
  - `EFECTIVO`, `TARJETA`, `TRANSFERENCIA` y soporte para pagos divididos / abonos parciales (Multi-tender WP-016C).
- **Entrada de Efectivo y Teclado Táctil (`NumericKeypad`):**
  - Teclado numérico táctil gigante (targets de 72px) para captura rápida de efectivo entregado (`cashGiven`).
  - Botones rápidos de denominaciones de billetes comunes: `$50`, `$100`, `$200`, `$500`, `$1000`, y botón **"Exacto"** que rellena automáticamente el importe exacto.
  - Visualizador de "Efectivo Recibido" (`MoneyText`).
  - Visualizador de "Cambio a Devolver" (`changeDue`), destacado en verde brillante cuando `cashGiven >= cashRequired`.
- **Transacciones Bancarias / SPEI:**
  - Captura del código de autorización o número de voucher bancario (`referenceAuthCode`).
- **Trazabilidad de Cajero:**
  - Captura de PIN de operador responsable para cumplir DEC-017 y auditoría inmutable.
- **Botón Gigante de Liquidación:**
  - Target táctil de 72px de alto (`size="xl"`, `intent="primary"`):
    - **"COBRAR Y CERRAR CUENTA"** con indicación clara del monto total.
    - Idempotente con `clientOpId: UUIDv4`.

### 2.4 ArqueoCiegoModal (`ArqueoCiegoModal.tsx` — DEC-017)
- Cumplimiento estricto de la regla de secreto de DEC-017: NUNCA se muestra al cajero el total calculado del sistema antes de capturar el efectivo físico declarado.
- Interfaz de conteo por denominaciones táctiles con multiplicadores automáticos:
  - Billetes: $1,000, $500, $200, $100, $50, $20.
  - Monedas: $10, $5, $2, $1, $0.50.
  - Conteo de piezas con botones `+` y `-` (mínimo 44px de alto) y totalización declarada reactiva.
  - Opción alternativa de captura rápida de total físico directo.
- Validación obligatoria de PIN de cajero.
- **Pantalla de Conciliación Post-Captura:**
  - Revelación de Total Físico Declarado vs Total Calculado por Sistema.
  - Cálculo de Diferencia: `diferencia = declarado - calculado`.
    - `0.0000`: Cuadre exacto (verde).
    - `> 0`: Sobrante de efectivo (azul).
    - `< 0`: Faltante de efectivo (rojo).
  - Botón de emisión de **Corte Z definitivo** para cierre irreversible del turno con compromiso atómico en SQLite.

### 2.5 MovimientoCajaModal (`MovimientoCajaModal.tsx`)
- Modal táctil para registrar entradas y retiros de efectivo del cajón:
  - Toggle de tipo: `INGRESO (Entrada de efectivo)` vs `EGRESO (Retiro de efectivo)`.
  - Campo de monto con botones rápidos (`+$100`, `+$200`, `+$500`, `+$1000`).
  - Motivo / Justificación obligatoria (ej. "Dotación de cambio", "Compra de insumos de emergencia").
  - Validación de PIN de cajero y validación de saldo disponible en retiros.

### 2.6 AbrirTurnoModal (`AbrirTurnoModal.tsx`)
- Modal para configurar la apertura de turno:
  - Captura del fondo inicial en efectivo (`startingCash`, por defecto $1,000.0000 o editable con botones rápidos `$500`, `$1000`, `$1500`, `$2000`).
  - Selección de cajero responsable y PIN.
  - Disparo de apertura e invalidación reactiva de queries.

### 2.7 CorteXModal (`CorteXModal.tsx`)
- Modal informativo de corte parcial de turno:
  - Desglose de ventas por método de pago (Efectivo, Tarjeta, Transferencia).
  - Recaudación total, propinas acumuladas y número de tickets cobrados.
  - Flujo de efectivo en cajón (Fondo inicial + Ingresos - Egresos = Saldo actual).
  - Opción de imprimir ticket de comprobante de Corte X sin cerrar el turno.

### 2.8 CobroExitosoModal (`CobroExitosoModal.tsx`)
- Notificación modal de liquidación exitosa:
  - Comprobante y folio de venta.
  - Resumen de monto liquidado, propina aplicada y cambio entregado.
  - Señales de hardware POS: "Cajón de dinero abierto (Kick Drawer)" y "Ticket fiscal / voucher impreso".
  - Botón táctil grande "Siguiente Operación" (56px) para reanudar el flujo de caja.

### 2.9 CajaRoute (`CajaRoute.tsx`)
- Integración de todos los módulos en la ruta `/caja`.
- Layout ergonómico de pantalla dividida optimizado para terminales táctiles (1024×768 hasta 1920×1080).
- Suscripción a eventos de dominio en tiempo real (`TurnoCajaAbierto`, `TurnoCajaCerrado`, `MovimientoCajaRegistrado`, `ArqueoCiegoRegistrado`, `CorteCajaGenerado`, `PagoRegistrado`, `CuentaPagada`).

---

## 3. Typed IPC Bridge & Domain Contracts

Actualizado `@trident/pos-renderer/src/bridge/trident-bridge.ts`:
- **DTOs Canónicos Exportados:**
  - `CashShiftStatusDTO`: `turnoCajaId`, `status`, `openedAt`, `cashierUserId`, `startingCash`, `currentBalance`, `version`.
  - `OpenShiftDTO`: `startingCash`, `cashierUserId`, `cashierPin`, `clientOpId`.
  - `MovimientoCajaDTO`: `id`, `turnoCajaId`, `operatorUserId`, `movementType`, `amount`, `reason`, `createdAt`.
  - `RegisterMovementDTO`: `turnoCajaId`, `operatorUserId`, `movementType`, `amount`, `reason`, `operatorPin`, `clientOpId`.
  - `ArqueoCiegoInputDTO`: `shiftId`, `performedByUserId`, `declaredCash`, `expectedVersion`, `performedByPin`, `clientOpId`.
  - `ArqueoCiegoResultDTO`: `turno`, `arqueo ({ id, declaredCash, calculatedCash, difference, createdAt })`.
  - `CorteCajaDTO`: `id`, `turnoCajaId`, `tipoCorte`, `openingCashFloat`, `totalIngresos`, `totalEgresos`, `totalVentasEfectivo`, `totalVentasTarjeta`, `totalVentasTransferencia`, `totalCalculado`, `totalDeclarado`, `diferencia`, `totalPropinas`, `ticketsCount`, `generatedAt`.
  - `GenerarCorteInputDTO`: `shiftId`, `operatorUserId`, `operatorPin`, `clientOpId`.
  - `GenerarCorteZInputDTO`: `shiftId`, `closedByUserId`, `expectedVersion`, `closedByPin`, `clientOpId`.
  - `CorteZResultDTO`: `turno`, `corte`.
  - `PaymentMethod`: `'EFECTIVO' | 'TARJETA' | 'TRANSFERENCIA'`.
- **API `window.trident.caja`:**
  - `getShiftStatus()`: Consulta estado del turno activo.
  - `getCuentasPorCobrar()`: Consulta cuentas pendientes de pago.
  - `openShift(params)`: Apertura de turno y emisión de `TurnoCajaAbierto`.
  - `registerMovement(params)`: Registra ingreso o egreso de efectivo y emite `MovimientoCajaRegistrado`.
  - `realizarArqueoCiego(params)`: Ejecuta conteo ciego per DEC-017, calcula diferencia y emite `ArqueoCiegoRegistrado`.
  - `generarCorteX(params)`: Genera corte parcial X y emite `CorteCajaGenerado`.
  - `generarCorteZ(params)`: Cierra turno definitivamente y emite `TurnoCajaCerrado`.
  - `submitTender(request)`: Procesa pago con propina y cambio, actualiza saldo en caja, liquida cuenta y emite `PagoRegistrado` / `CuentaPagada`.
  - `getAccountPayments(cuentaId)`: Consulta historial de abonos y saldo remanente.

---

## 4. Test Verification Suite (`packages/pos-renderer/src/index.test.ts`)

La suite de integración ejecutó 39 pruebas unitarias e integración pasando al 100%:
- **`WP-026D Terminal de Caja & Cobro Táctil Integration Suite` (10 pruebas):**
  1. `retrieves active cash shift status with zero-float balances and enrolled cashier details`: Valida fondo inicial $1000.0000, balance y cajero responsable.
  2. `lists pending accounts to settle across Comedor and Mostrador channels`: Valida que devuelva cuentas abiertas e impresas en escala 4.
  3. `processes full cash tender with tip, exact change due calculation and settles account`: Valida liquidación con billete de $500, cálculo de propina voluntaria de 10% ($24.0000), cambio devuelto exacto ($221.6000), aumento del efectivo en caja y emisión de `CuentaPagada`.
  4. `processes card payment with reference auth code, closing account and releasing dining table`: Valida pago con tarjeta y código de autorización bancaria, y liberación automática de la mesa en el salón.
  5. `handles partial / multi-tender split payment with remaining balance (WP-016C)`: Valida pago mixto en 2 abonos ($300 con tarjeta -> saldo restante $338 -> abono final $338 en efectivo -> cuenta pagada).
  6. `registers cash movements (ingreso and egreso) with audit trail and balance validation`: Valida ingreso de $200, egreso de $50 y rechazo fail-closed de retiros que excedan el saldo disponible.
  7. `executes strict blind cash count (Arqueo Ciego DEC-017) without prior total disclosure, calculates variance and generates Corte Z`: Valida conteo ciego, cálculo de diferencia ($1020 vs $1000 = +$20 sobrante), y cierre definitivo con Corte Z.
  8. `generates intermediate Corte X without closing active cash shift`: Valida corte parcial sin alterar estado abierto del turno.
  9. `fails closed and rejects payments when cash shift is closed`: Valida rechazo con error `VALIDATION` al intentar cobrar con turno cerrado.
  10. `opens a new cash shift after closure with fresh initial cash float`: Valida apertura de nuevo turno con $1500 de fondo inicial.

### Verification Results:
- **`npm run --workspace=@trident/pos-renderer test`**: 39/39 PASS (0 fail, 161ms).
- **`npm run graph:check`**: 44/44 PASS (0 cycle, strict boundaries satisfied).
- **`npm run typecheck`**: 22/22 workspaces typechecked clean.
- **`npm run lint`**: 13/13 workspaces linted clean (0 errors).
- **`npm run format:check`**: Prettier formatting 100% compliant.

---

## 5. Architectural Invariants Enforced
- **Zero Floating-Point Arithmetic (`SYS-INV-001` / `ADR-012`):** Todos los cálculos monetarios (cambio, propina, diferencia de arqueo, saldos) operan en enteros escalados (`BigInt` factor 10,000) o strings escala 4.
- **Secreto de Arqueo Ciego (`DEC-017`):** La UI no recibe ni expone el saldo calculado del sistema hasta que el cajero ha ingresado y confirmado su conteo físico.
- **Touch Target Accessibility (`VISUAL_SYSTEM.md` / `WCAG 2.2 AA`):** Botones mínimos de 48px, primarias de 56px, teclado numérico y botón de cobro de 72px (`size="xl"`).
- **Idempotencia (`SYS-INV-003`):** Toda mutación monetaria genera un identificador único `clientOpId: UUIDv4`.
