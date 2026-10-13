# TRIDENTPOS Builder Evidence: WP-026B Salón & Comandero Táctil UI

## 1. Executive Summary
- **Work Package:** WP-026B — Salón & Comandero Táctil (`/salon`)
- **Framework Profile:** EAAF v1.3.0 (ACR-2026-021 / Lean Profile)
- **Target Route:** `/salon` (Desktop & Terminal Touch Screen 10"-15")
- **Architecture Baseline:** `FRONTEND_ARCHITECTURE.md` (Approved in PR #64), `DATA_MODEL.md`, `VISUAL_SYSTEM.md`, DEC-010 (Item Cancellation), DEC-011 (Table Transfer), DEC-013 (Check Request), DEC-015 (Account Split), DEC-017 (Operator PIN Gating).
- **Security & Integrity:** Renderer maintains strict zero-network isolation (`connect-src 'none'`), all operations mediated through typed IPC bridge (`window.trident.salon`), all monetary values represented in scale-4 fixed point strings (`MoneyText`, zero floats).

---

## 2. Components Implemented (`@trident/pos-renderer/src/features/salon/`)

### 2.1 TableCard (`TableCard.tsx`)
- Táctil accesible (mínimo 140px alto, padding generoso, `role="button"` con ARIA label descriptivo).
- Indicador visual de estado de mesa (`DISPONIBLE`, `OCUPADA`, `EN_CUENTA`, `BLOQUEADA`) utilizando `Badge` de `@trident/ui`.
- Alerta visual animada cuando `attentionSignal.flagged === true`.
- Conteo de comensales, tiempo transcurrido (formato "XX min" o "Xh Ym"), y saldo total formateado con `MoneyText`.

### 2.2 OpenTableDialog (`OpenTableDialog.tsx`)
- Diálogo modal táctil para mesas disponibles.
- Selector de comensales mediante stepper numérico (`+` / `−`) o selección táctil rápida de 1 a 10 personas.
- Atribución de mesero en turno y botón primario de 56px de alto ("Abrir Mesa e Iniciar Comanda").

### 2.3 ModifierSelectorDialog (`ModifierSelectorDialog.tsx`)
- Diálogo para personalización de partidas antes de agregar a la comanda.
- Soporte para grupos de modificadores obligatorios (`required: true`, validación de `minSelect`) y opcionales (`maxSelect`).
- Botones de selección táctiles grandes (56px) con casillas de verificación y precios extra en escala-4.
- Campo de notas libres para cocina (ej. "Término muy sellado, salsa aparte, alérgico a nueces").
- Cálculo en tiempo real de precio total de partida con `MoneyText`.

### 2.4 CancelItemDialog (`CancelItemDialog.tsx` - DEC-010)
- Cancelación de partidas enviadas a cocina con requerimiento estricto de motivo de cancelación (mínimo 3 caracteres).
- Botones de selección rápida para motivos frecuentes ("Error al capturar", "Comensal canceló a tiempo", "Cambio por otro platillo", "Demora de cocina", "Alergia no especificada").
- Soporte para PIN de supervisor (DEC-010).

### 2.5 TransferTableDialog (`TransferTableDialog.tsx` - DEC-011)
- Reubicación de comanda y comensales entre mesas del restaurante.
- Filtra y presenta únicamente mesas en estado `DISPONIBLE`.
- Campo para registrar motivo del cambio de mesa.

### 2.6 ChangeGuestsDialog (`ChangeGuestsDialog.tsx`)
- Ajuste rápido del conteo de comensales directamente desde el comandero táctil.

### 2.7 SplitAccountDialog (`SplitAccountDialog.tsx` - DEC-015)
- Soporta partición equitativa (`EQUAL_PARTS`) con cálculo de prorrateo exacto por persona en escala-4.
- Soporta partición por productos (`BY_ITEMS`), permitiendo seleccionar partidas específicas para transferir a una nueva subcuenta.

### 2.8 ComanderoView (`ComanderoView.tsx`)
- Layout táctil dividido de alto rendimiento:
  - **Barra Superior**: Mesa #, Salón, Folio de cuenta, Contador de comensales (con shortcut de edición), Mesero, Botón "Volver al Salón".
  - **Columna Izquierda (60%) - Catálogo de Menú**: Selector de categorías táctil horizontal (`h-12`) y grid de productos con precios escala-4 (`MoneyText`). Apertura automática de modificadores si el producto tiene opciones.
  - **Columna Derecha (40%) - Comanda & Totales**:
    - Partidas enviadas a cocina con badges de estado y opción de cancelación (DEC-010).
    - Partidas nuevas pendientes con controles táctiles `+` / `−` de cantidad y eliminación.
    - Desglose financiero: Subtotal, IVA (16%), Total a Pagar formateado con `MoneyText`.
    - Botón primario prominente (56px de alto) para despachar la comanda a cocina.
    - Botones para precuenta (`requestCheck`), transferencia (`transferCuenta`), y división (`splitCuenta`).
  - **Control de Concurrencia Optimista (OCC 409)**:
    - Captura errores `CONFLICT_VERSION` y renderiza `ConflictNotice` con recarga inmediata sin pérdida de estado local.

### 2.9 SalonRoute (`SalonRoute.tsx`)
- Orquestador de la ruta `/salon`:
  - Cabecera con métricas en tiempo real (Mesas libres, ocupadas, en cuenta) y botón de refresco.
  - Pestañas horizontales de filtrado por zona/área ("Todas las Zonas", "Salón Principal", "Terraza", "Barra").
  - Grid responsivo de tarjetas de mesa con fallback a `EmptyState` si la zona está vacía.
  - Flujo fluido: clic en mesa disponible abre `OpenTableDialog`; clic en mesa ocupada/en cuenta abre `ComanderoView`.
  - Suscripción a eventos de dominio para auto-refresco del salón.

---

## 3. Verification & Test Evidence

### 3.1 Unit & Integration Test Suite (`@trident/pos-renderer/src/index.test.ts`)
- **21/21 Tests PASSING:**
  1. `returns valid package metadata and strictly governed dependencies` (PASS)
  2. `authenticates valid operator credentials and returns sanitized session view` (PASS)
  3. `rejects invalid PIN with FORBIDDEN error and no credential leakage` (PASS)
  4. `handles step-up supervisor PIN authorization (DEC-010/012/013)` (PASS)
  5. `returns enrolled station profile and connectivity signals` (PASS)
  6. `invalidates salon queries on dining events` (PASS)
  7. `invalidates KDS queries on kitchen ticket events` (PASS)
  8. `invalidates cash and floor-plan queries on payment settlement (CuentaPagada)` (PASS)
  9. `triggers full resync (invalidateAll) on connectivity.restored (ADR-005)` (PASS)
  10. `fails closed and invalidates all on unknown major eventContractVersion (ACR-2026-020)` (PASS)
  11. `extracts initial route cleanly from hash` (PASS)
  12. `retrieves salon floor plan with room areas, table statuses and metrics` (PASS)
  13. `retrieves catalog categories and products with modifiers and scale-4 prices` (PASS)
  14. `opens an available table and transitions state to OCUPADA with new account` (PASS)
  15. `dispatches items to kitchen, updates account version, subtotal and totals with zero floats` (PASS)
  16. `detects OCC 409 conflict when sending order with stale expectedVersion` (PASS)
  17. `cancels item with reason, deducting balance and marking CANCELADO (DEC-010)` (PASS)
  18. `transfers account to another available table, reassigning table states (DEC-011)` (PASS)
  19. `requests check, changing account to IMPRESA and table to EN_CUENTA` (PASS)
  20. `updates guest count on active table and account` (PASS)
  21. `releases a table returning it to DISPONIBLE state` (PASS)

### 3.2 Monorepo Policy Checks
- `npm run graph:check`: **44/44 PASS** (0 circular dependencies, architecture boundary rules satisfied).
- `npm run lint`: **13/13 workspaces PASS** (0 errors).
- `npm run typecheck`: **22/22 tasks PASS** (TypeScript strict mode, 0 errors).
- `npm run format:check`: **Prettier verified clean**.
- `npm run build`: **13/13 workspaces built successfully**.

---

## 4. Sign-Off
- **Status:** READY FOR REVIEW & MERGE
- **Deliverables:** Complete Salón overview, Table cards, Open table flow, Comandero touch workspace, modifiers selector, DEC-010 item cancellations, DEC-011 transfers, DEC-015 split, Precuenta requests, and IPC bridge contracts.
