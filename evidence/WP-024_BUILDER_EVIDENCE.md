# TRIDENTPOS Builder Evidence: WP-024 Corporate Backoffice Web Portal

## 1. Executive Summary
- **Work Package:** WP-024 — Corporate Backoffice Web Portal (Next.js / React)
- **Framework Profile:** EAAF v1.3.0 (ACR-2026-021 / Lean Profile)
- **Target Subsystem:** Backoffice Web Portal, Presentation Layer (Layer 4 Composition Root), Catalog Management & Recipe Engineering (Escandallos con merma real), Inventory & Kárdex Audit, Multi-Warehouse Minimum-Par Alerts, Procurement Replenishment Suggestions (`OQ-SSOT-05`) & Price Variance Tracking, Shift Cash Reconciliation & Variance Detection, Global Invoicing Batches (`OQ-ARCH-02` / `DEC-018`), Business Intelligence & Omnichannel Sales Analytics, Staff RBAC & Branch-Scoped Routing.
- **Architecture Baseline:**
  - `ADR-012` & `SYS-INV-001`: Zero floating-point math, fixed-point scale-4 integer arithmetic backed by `BigInt` for all financial figures, quantities, costs, percentages, and prices.
  - `ADR-013`: Composition Root purity. `@trident/backoffice-web` belongs to Layer 4 (Composition Roots) and depends strictly on `@trident/core` and `@trident/ui`.
  - `SEC-VAL-07`: Mandatory Content Security Policy (CSP) engine, strict `frame-ancestors 'none'`, `object-src 'none'`, `default-src 'self'`, and robust multi-vector XSS sanitization.
- **Security & Integrity Boundary:**
  - Strict RBAC matrix (`ADMIN`, `GERENTE`, `CHEF`, `CAJERO`, `MESERO`, `AUDITOR`) with fail-closed route guards.
  - Multi-tenant and branch-scoped navigation guards preventing unauthorized cross-branch or cross-tenant data access.
  - Optimistic UI mutation engine with automatic rollback on network/server errors.

---

## 2. Components & Artifacts Implemented

### 2.1 Monorepo Policy & Architectural Boundary (`scripts/check-graph.mjs`)
- En cumplimiento estricto con `ADR-013`, `@trident/backoffice-web` fue registrado como nodo de Capa 4 (Composition Roots) con dependencias permitidas limitadas a `['@trident/core', '@trident/ui']`.
- Actualización de políticas de prueba en `scripts/check-graph.test.mjs` garantizando la correspondencia canónica de políticas bidireccionales.
- Verificación exitosa en `npm run graph:check` con 44/44 tests pasando.

### 2.2 Core Presentation Package (`packages/backoffice-web/`)

1. **`packages/backoffice-web/package.json` & `tsconfig.json`:**
   - Workspace monorepo `@trident/backoffice-web` con `type: "module"`, exports tipados y dependencias permitidas: `@trident/core`, `@trident/ui`, `react` (v19) y `@types/react`.
   - Configuración de compilación TypeScript modular `NodeNext`.

2. **`packages/backoffice-web/src/types.ts`:**
   - Modelos de datos canónicos para:
     - Catálogo y Escandallos: `CategoryItem`, `ProductItem`, `RecipeItemEntry`, `RecipeDefinition`.
     - Inventarios y Kárdex: `WarehouseItem`, `StockBalanceEntry`, `KardexMovementEntry`, `KardexMovementType`.
     - Compras y Proveedores: `PurchaseOrderEntry`, `ReplenishmentSuggestion`, `PriceVarianceAlert`.
     - Finanzas y Facturación: `CashShiftReconciliation`, `CashShiftDiscrepancyStatus`, `GlobalInvoicingBatch`.
     - BI y Analítica: `DailySalesSummary`, `ChannelVelocityMetric`, `HourlySalesHeatmapEntry`, `TopSellingProductMetric`.
     - RBAC y Navegación: `BackofficeRole`, `BackofficePermission`, `BackofficeUser`, `BackofficeSession`, `RouteGuardResult`.
     - Tablas de Datos: `TableColumn`, `TableSortState`, `TableFilterState`, `TablePaginationState`.

3. **`packages/backoffice-web/src/security.ts` (`SEC-VAL-07`):**
   - Generador canónico de encabezados CSP (`buildCspHeader`):
     - `default-src 'self'`.
     - `frame-ancestors 'none'` (defensa estricta anti-clickjacking).
     - `object-src 'none'` (neutralización de plugins legacy / Flash / ActiveX).
     - `base-uri 'self'`.
     - Soporte para nonce criptográfico en `script-src` y `style-src`.
   - Validador de directivas CSP (`validateCspPolicy`) fail-closed:
     - Detecta configuraciones inseguras que omitan `frame-ancestors 'none'`, utilicen `default-src *` o permitan `unsafe-inline` sin nonce/hashes.
   - Motor de sanitización XSS:
     - `escapeHtml`: Escapado seguro de entidades HTML (`&`, `<`, `>`, `"`, `'`).
     - `sanitizeHtmlContent`: Sanitizador estricto que elimina scripts, iframes, objetos y pseudo-protocolos `javascript:`, `vbscript:`, `data:`.

4. **`packages/backoffice-web/src/numerics.ts` (`ADR-012`):**
   - Cero floats en toda la interfaz de usuario: enteros escala-4 (`0.0000`) respaldados por `BigInt`.
   - Funciones seguras de cálculo:
     - `toScale4BigInt` / `fromScale4BigInt`: Conversión bidireccional exacta.
     - `addScale4`, `subScale4`, `multiplyScale4`, `divideScale4`, `compareScale4`.
     - `formatCurrencyScale4`: Formateo localizado de moneda (`$1,250.00`) para visualización humana.
     - `parseCurrencyToScale4`: Normalización de inputs de texto a escala-4 canónica.
     - `calculateGrossQuantityScale4`: Cálculo de cantidad bruta requerida con merma real:
       $$\text{Gross} = \frac{\text{Net}}{1 - \frac{\text{Waste}\%}{100}}$$
     - `calculatePortionCostScale4`: Costeo de porción individual a partir del costo total del lote y el rendimiento.

5. **`packages/backoffice-web/src/auth/rbac-guard.ts` & `src/auth/session-store.ts`:**
   - Matriz de permisos RBAC por rol operativo:
     - `ADMIN`: Acceso irrestricto (catálogo, recetas, inventario, compras, finanzas, conciliación, facturación global, analítica, usuarios).
     - `GERENTE`: Gestión operativa completa (catálogo, compras, inventario, finanzas, analítica).
     - `CHEF`: Lectura de catálogo y formulación/edición de recetas y escandallos (`recipe.write`, `catalog.read`).
     - `CAJERO`: Conciliación de caja y corte de turno (`finance.cash_reconciliation`).
     - `AUDITOR`: Lectura de kárdex, auditoría de finanzas y facturación global (`inventory.audit`, `finance.audit`).
   - `evaluateRouteGuard`: Guardia de navegación con resolución de permisos y denegación fail-closed.
   - `canAccessBranch`: Restricción de acceso por asignación de sucursal.
   - `BackofficeSessionStore`: Tienda reactiva de sesión con validación de expiración y cambio controlado de sucursal.

6. **`packages/backoffice-web/src/api/client.ts`:**
   - Cliente HTTP tipado con cabeceras obligatorias de autenticación (`Authorization`), tenant (`x-organization-id`), sucursal (`x-branch-id`) y correlación (`x-correlation-id`).
   - Motor de mutaciones optimistas (`executeOptimisticMutation`):
     - Aplica el cambio inmediatamente en el estado local de la UI.
     - Ejecuta la llamada remota de red.
     - En caso de éxito, consolida el estado final.
     - En caso de error (4xx/5xx o desconexión), ejecuta automáticamente un **rollback atómico** al estado previo y notifica al usuario.

7. **Módulos de Negocio & Pantallas:**
   - **Catálogo & Escandallos (`src/modules/catalog/`):**
     - `catalog-service.ts`: Cálculo de costos de lote, porción y precio sugerido con margen de contribución objetivo.
     - `CatalogView.tsx`: Vista de catálogo maestro con búsqueda, filtros de categoría y estado activo.
     - `RecipeBuilderView.tsx`: Diseñador interactivo de recetas con insumos editables, factor de merma y actualización reactiva de costos.
   - **Inventario & Kárdex (`src/modules/inventory/`):**
     - `inventory-service.ts`: Valuación global de inventarios con `addScale4`, detección de insumos por debajo del stock mínimo (par level) y bitácora de movimientos.
     - `WarehouseStockView.tsx`: Visualizador de existencias por almacén con alertas visuales de stock crítico.
     - `KardexLedgerView.tsx`: Bitácora inmutable de auditoría de movimientos de almacén (entradas, salidas, mermas, transferencias).
   - **Compras & Proveedores (`src/modules/procurement/`):**
     - `procurement-service.ts`: Generador de sugerencias automáticas de reabastecimiento (`OQ-SSOT-05`) y detección de variaciones de precio proveedor vs. costo pactado.
     - `PurchaseOrdersView.tsx`: Gestión de órdenes de compra con indicadores de recepción y alertas de sobreprecio.
   - **Finanzas & Facturación (`src/modules/finance/`):**
     - `finance-service.ts`: Conciliación de caja de turnos operativos, detección de variaciones (faltante, cuadrado, sobrante) y agregación de facturación global mensual (`OQ-ARCH-02` / `DEC-018`).
     - `CashReconciliationView.tsx`: Tabla de arqueo de caja con semáforos de discrepancia y liquidación.
     - `GlobalInvoicingBatchView.tsx`: Panel de facturación global para ventas al público en general no facturadas individualmente.
   - **Analítica & Dashboard BI (`src/modules/analytics/`):**
     - `analytics-service.ts`: Agregador de métricas de ventas omnicanal (Uber Eats, Rappi, Didi Food, Salón), velocidad horaria y productos estrella.
     - `BiDashboardView.tsx`: Panel ejecutivo con KPIs en escala-4, desglose porcentual por canal y mapa de calor de demanda horaria.
   - **Administración & Personal (`src/modules/settings/`):**
     - `StaffRbacView.tsx`: Matriz de usuarios, asignación de roles y visor de permisos efectivos otorgados.

8. **Componentes Base de Interfaz (`src/components/`):**
   - `DataTable.tsx`: Motor de tablas genérico de alto rendimiento con búsqueda por texto libre, filtros específicos por columna, ordenamiento tipado ascendente/descendente y paginación determinista.
   - `BackofficeLayout.tsx`: Shell responsivo con barra lateral filtrada dinámicamente por permisos RBAC, selector de sucursal activa, perfil de usuario y control de cierre de sesión.
   - `OptimisticNotice.tsx`: Notificación flotante con soporte para estados de sincronización, éxito y rollback de errores.

---

## 3. Quality Gates & Verification Evidence

| Quality Gate | Command | Result | Details |
| :--- | :--- | :--- | :--- |
| **Dependency Graph** | `npm run graph:check` | **PASS (44/44 tests)** | `@trident/backoffice-web` validado como Capa 4 Composition Root sin ciclos. |
| **TypeScript Typecheck** | `npm run typecheck` | **PASS (25/25 packages)** | Tipado estricto `NodeNext` sin errores de compilación. |
| **ESLint Analysis** | `npm run lint` | **PASS (16/16 packages)** | Cero errores de linting en todo el monorepo. |
| **Code Formatting** | `npm run format:check` | **PASS (100% compliant)** | Prettier validado en todos los archivos del proyecto. |
| **Package Unit Tests** | `npm run --workspace=@trident/backoffice-web test` | **PASS (28/28 tests)** | 100% de cobertura en seguridad CSP, numerics, RBAC, tablas y servicios de dominio. |
| **Monorepo Test Suite** | `npm run test` | **PASS (32/32 packages + E2E)** | Validación completa de todas las suites del monorepo y test de integración cruzado. |
| **Database Migrations** | `npm run db:test` | **PASS** | Validado contra PostgreSQL 16 con RLS y FORCE RLS. |

---

## 4. Architectural Invariants Sign-off
- [x] **ADR-012 / SYS-INV-001 (Zero Floats):** Todos los componentes de UI, cálculos de escandallo, márgenes, valuaciones de inventario y reconciliaciones financieras operan en escala-4 con `BigInt`.
- [x] **ADR-013 (Layer Purity):** `@trident/backoffice-web` pertenece a Capa 4 y depende exclusivamente de `@trident/core` y `@trident/ui`.
- [x] **SEC-VAL-07 (Security Headers & XSS Defense):** CSP estricto (`frame-ancestors 'none'`, `object-src 'none'`, `default-src 'self'`) y sanitización HTML activa.
- [x] **RBAC & Branch Multi-Tenancy:** Rutas y datos filtrados fail-closed según roles y sucursales asignadas.
- [x] **Resilient UI Operations:** Mutaciones optimistas con garantía de rollback automático ante fallas de conectividad o errores HTTP.
