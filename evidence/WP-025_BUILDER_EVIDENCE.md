# TRIDENTPOS Builder Evidence: WP-025 Mobile Waiter Handheld Client (Comandero Móvil)

## 1. Executive Summary
- **Work Package:** WP-025 — Mobile Waiter Handheld Client / Comandero Móvil
- **Framework Profile:** EAAF v1.3.0 (ACR-2026-021 / Lean Profile)
- **Target Subsystem:** Handheld / Mobile Waiter Client, Presentation Layer (Layer 4 Composition Root), Dining Floor Map & Table State Management, Comanda Builder & Dish Modifier Assembly (`DEC-016`), Kitchen Order Dispatching (KDS), Proportional Bill Splitting Engine (`DEC-015` / `OQ-SSOT-06`), Table Transfer with Receiver Waiter PIN Verification (`DEC-011` / `OQ-SSOT-02`), Manager Void Authorization & Invalidation (`DEC-013` / `OQ-SSOT-04`), Dead-Zone Offline Queue & Reconnect Resynchronization (`ADR-005`), Station QR Enrollment with Timing-Safe TLS Fingerprint Verification (`SEC-VAL-03`).
- **Architecture Baseline:**
  - `ADR-012` & `SYS-INV-001`: Zero floating-point math, fixed-point scale-4 integer arithmetic backed by `BigInt` for all financial figures, quantities, subtotals, item modifiers, tips, discounts, and split subaccounts.
  - `ADR-013`: Composition Root purity. `@trident/mobile-waiter` belongs to Layer 4 (Composition Roots) and depends strictly on `@trident/core` and `@trident/ui`.
  - `ADR-005`: Local hybrid LAN protocol. Fast HTTP REST mutations with optimistic concurrency control headers (`if-match` / `expectedVersion`), real-time WebSocket state streaming, transparent Wi-Fi dead-zone mutation queueing, and automatic `FULL_RESYNC` upon reconnection.
  - `SEC-VAL-03`: Cryptographic station enrollment. Secure pairing via QR code containing Edge Host address, port, and TLS SHA-256 cert fingerprint verified with constant-time equality check (`crypto.timingSafeEqual`) to protect against rogue mDNS/DNS spoofing.
- **Product Owner Decisions & Invariants:**
  - `DEC-011` (`OQ-SSOT-02`): Table transfer requires explicit acceptance and PIN authentication from the receiving waiter.
  - `DEC-013` (`OQ-SSOT-04`): Comanda cancellation/void directly from handheld requires manager PIN, mandatory structured reason code, and invalidates any previously printed fiscal/pre-bill folios.
  - `DEC-015` (`OQ-SSOT-06`): Exact scale-4 proportional prorating for bill splitting (equal parts or per-seat item allocation) where rounding residues are deterministically absorbed into the final subaccount, guaranteeing $\sum \text{Subcuentas} = \text{Total Cuenta}$.
  - `DEC-016`: Dynamic dish modifier engine supporting additive (extra charge) and subtractive (kitchen exclusion) options with scale-4 price adjustments.

---

## 2. Components & Artifacts Implemented

### 2.1 Monorepo Policy & Architectural Boundary (`scripts/check-graph.mjs`)
- En cumplimiento estricto con `ADR-013`, `@trident/mobile-waiter` fue registrado como nodo de Capa 4 (Composition Roots) con dependencias permitidas limitadas a `['@trident/core', '@trident/ui']`.
- Actualización de políticas de prueba en `scripts/check-graph.test.mjs` garantizando la correspondencia canónica de políticas bidireccionales.
- Verificación exitosa en `npm run graph:check` con 44/44 tests pasando.

### 2.2 Core Presentation Package (`packages/mobile-waiter/`)

1. **`packages/mobile-waiter/package.json` & `tsconfig.json`:**
   - Workspace monorepo `@trident/mobile-waiter` con `type: "module"`, exports tipados y dependencias permitidas: `@trident/core`, `@trident/ui`, `react` (v19) y `@types/react`.
   - Configuración TypeScript modular con lib `["ES2022", "DOM", "DOM.Iterable"]` y resolución `NodeNext`.

2. **`packages/mobile-waiter/src/types.ts`:**
   - Modelos de datos canónicos para:
     - Salón & Mesas: `FloorArea`, `TableStatus`, `DiningTable`, `TableTransferRequest`, `TableTransferResult`.
     - Comandas & Modificadores: `ModifierType`, `DishModifier`, `ComandaItem`, `ComandaOrder`, `ComandaDispatchResult`.
     - División de Cuentas: `SplitMethod`, `SplitSubaccount`, `SplitBillResult`.
     - Cancelaciones Gerenciales: `VoidReasonCode`, `ManagerVoidRequest`, `ManagerVoidResult`.
     - Seguridad y Enrolamiento: `QrEnrollmentPayload`, `StationPairingCredentials`, `TlsFingerprintVerificationResult`.
     - Red LAN & OCC: `LanNetworkState`, `QueuedMutation`, `OccConflictDetails`, `LanClientOptions`.

3. **`packages/mobile-waiter/src/numerics.ts` (`ADR-012` & `DEC-015`):**
   - Cero floats en toda la interfaz móvil: escala-4 (`0.0000`) respaldada por `BigInt`.
   - Funciones seguras de cálculo:
     - `toScale4BigInt` / `fromScale4BigInt`: Conversión bidireccional exacta sin deriva decimal.
     - `addScale4`, `subScale4`, `multiplyScale4`, `divideScale4`, `compareScale4`.
     - `formatCurrencyScale4`: Formateo de moneda (`$250.00`) para terminales táctiles.
     - `calculateItemSubtotalScale4` (`DEC-016`): Cálculo del subtotal del platillo sumando modificadores aditivos.
     - `splitBillEquallyScale4` (`DEC-015`): Algoritmo de división en N comensales con absorción determinista del residuo en la última subcuenta.
     - `splitBillByItemsScale4` (`DEC-015`): Algoritmo de división por partidas/asientos individuales con prorrateo proporcional de descuentos y propinas.

4. **`packages/mobile-waiter/src/security/enrollment.ts` (`SEC-VAL-03`):**
   - `parseQrEnrollmentPayload`: Validación estricta de estructura JSON, formato de huella SHA-256 (64 hex caracteres) y frescura temporal (anti-replay con ventana de 5 minutos).
   - `verifyTlsFingerprintTimingSafe`: Verificación criptográfica en tiempo constante (`crypto.timingSafeEqual`) entre el fingerprint reportado por TLS y la huella anclada en el QR, mitigando ataques de DNS/mDNS spoofing o Edge rogue.
   - `enrollStation`: Flujo atómico de enrolamiento que valida huella, autentica credenciales y genera el registro seguro de estación emparejada.

5. **`packages/mobile-waiter/src/network/lan-client.ts` (`ADR-005`):**
   - Cliente híbrido REST + WebSocket con OCC 409:
     - Despacho de mutaciones con cabeceras `if-match` conteniendo `expectedVersion`.
     - Interceptor de conflictos OCC (HTTP 409): notifica a la UI para actualización de versión y resolución de concurrencia.
     - Detección de zonas muertas de Wi-Fi (`LanNetworkState: DEAD_ZONE` / `OFFLINE`): encola mutaciones localmente para evitar pérdidas de comandas.
     - Recuperación automática de red: al reconectar ejecuta `drainOfflineQueue` y emite evento `FULL_RESYNC` para sincronizar el plano de mesas con el host central.

6. **Servicios de Dominio:**
   - **`src/services/dining-floor-service.ts`:** Gestión de zonas del restaurante (Terraza, Salón, Barra), mesas, comensales, comanda en curso, agregado de platillos con modificadores y despacho a KDS con control de versiones OCC.
   - **`src/services/bill-split-service.ts` (`DEC-015`):** Servicio de cálculo y división de cuentas con validación estricta de cuadre al 100% ($\sum \text{Subcuentas} \equiv \text{Total}$).
   - **`src/services/table-transfer-service.ts` (`DEC-011`):** Transferencia de mesa a mesa o de mesero a mesero condicionada a la validación criptográfica del PIN del mesero receptor.
   - **`src/services/mobile-void-service.ts` (`DEC-013`):** Cancelación gerencial desde móvil con PIN de gerente, catálogo obligatorio de motivos (`MISTAKE_ORDER`, `CUSTOMER_WALKOUT`, `FOOD_QUALITY`, `DUPLICATE_ORDER`, `MANAGER_COMP`) e invalidación de folios impresos.

7. **Componentes Táctiles Móviles (`src/components/`):**
   - `TableMapScreen.tsx`: Plano de mesas táctil con selector de zona, estados visuales (Libre, Ocupada, Por Cobrar, Reservada) y montos en escala-4.
   - `ComandaBuilderScreen.tsx`: Terminal de captura rápida para meseros con selección de platillos, opciones y modificadores, comentarios a cocina y botón de envío a KDS.
   - `BillSplitModal.tsx`: Pantalla de partición de cuenta (igualitaria o por ítems) con resumen de saldos y confirmación de cuadre exacto.
   - `TableTransferModal.tsx`: Teclado numérico táctil para ingreso y verificación de PIN del mesero receptor.
   - `ManagerVoidModal.tsx`: Teclado numérico táctil para PIN de gerente, selector de motivo y advertencia de anulación de folio.
   - `OfflineIndicatorBanner.tsx`: Indicador visual flotante de estado de conexión LAN (Online / Zona Muerta / Offline) y número de comandas en cola.
   - `OccConflictAlert.tsx`: Modal interactivo ante error de versión concurrente (OCC 409) con opción de reintento con estado fresco.

---

## 3. Quality Gates & Verification Evidence

| Quality Gate | Command | Result | Details |
| :--- | :--- | :--- | :--- |
| **Dependency Graph** | `npm run graph:check` | **PASS (44/44 tests)** | `@trident/mobile-waiter` validado como Capa 4 Composition Root sin ciclos. |
| **TypeScript Typecheck** | `npm run typecheck` | **PASS (26/26 packages)** | Tipado estricto `NodeNext` sin errores de compilación. |
| **ESLint Analysis** | `npm run lint` | **PASS (17/17 packages)** | Cero errores de linting en todo el monorepo. |
| **Code Formatting** | `npm run format:check` | **PASS (100% compliant)** | Prettier validado en todos los archivos del proyecto. |
| **Package Unit Tests** | `npm run --workspace=@trident/mobile-waiter test` | **PASS (18/18 tests)** | Cobertura en numerics escala-4, prorrateo, SEC-VAL-03, LAN/OCC y servicios. |
| **Monorepo Test Suite** | `npm run test` | **PASS (34/34 packages + E2E)** | Validación completa de todas las suites del monorepo y test de integración cruzado. |
| **Database Migrations** | `npm run db:test` | **PASS** | Validado contra PostgreSQL 16 con RLS y FORCE RLS. |

---

## 4. Architectural Invariants Sign-off
- [x] **ADR-012 / SYS-INV-001 (Zero Floats):** Todos los cálculos monetarios, subtotales de comanda, modificadores y división de cuentas operan en escala-4 con `BigInt`.
- [x] **ADR-013 (Layer Purity):** `@trident/mobile-waiter` pertenece a Capa 4 y depende exclusivamente de `@trident/core` y `@trident/ui`.
- [x] **ADR-005 (Hybrid LAN & Resilient Reconnection):** Manejo de concurrencia OCC 409, cola offline para zonas muertas de Wi-Fi y evento `FULL_RESYNC` al reconectar.
- [x] **SEC-VAL-03 (QR Trust Bootstrap):** Validación de certificados TLS del Edge Host mediante comparación en tiempo constante (`crypto.timingSafeEqual`) contra la huella provista en el enrolamiento.
- [x] **DEC-011 (Table Transfer Security):** Transferencia condicionada al PIN del mesero receptor.
- [x] **DEC-013 (Manager Void):** Cancelación móvil protegida por PIN gerencial, catálogo obligatorio y anulación de folios.
- [x] **DEC-015 (Proportional Bill Splitting):** Prorrateo con absorción del residuo en la última subcuenta garantizando cuadre exacto al 100%.
