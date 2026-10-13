# TRIDENTPOS Builder Evidence: WP-023 Delivery Hub & Aggregators Webhook Integration Engine

## 1. Executive Summary
- **Work Package:** WP-023 — Delivery Hub & Aggregators Webhook Integration Engine
- **Framework Profile:** EAAF v1.3.0 (ACR-2026-021 / Lean Profile)
- **Target Subsystem:** Third-party Delivery Aggregators (Uber Eats, Rappi, Didi Food, Direct Fleet), Cryptographic Webhook Ingestion, Anti-Replay Defense, Catalog Resolution, Auto-Accept Engine, and Kitchen KDS Dispatching.
- **Architecture Baseline:** `ADR-012` (Exact Fixed-Point Scale-4 & zero floats), `ADR-013` (Domain purity & Core-only internal dependency), `SEC-VAL-10` (Mandatory HMAC-SHA256 Cryptographic Webhook Verification, Timing-Safe Equality, Replay Windows, and Clock Drift Limits).
- **Security & Integrity Boundary:** Multi-tenant RLS forzado (`current_app_org_id()`), `FORCE ROW LEVEL SECURITY` en toda tabla física de integraciones y pedidos externos, fail-closed cryptographic signature verification con `crypto.timingSafeEqual`, ventana anti-replay estricta de ≤300s, derivación horaria futura tolerada ≤60s, y tienda de deduplicación de idempotencia de eventos (`eventId`).

---

## 2. Components & Artifacts Implemented

### 2.1 Pure Domain Engine (`packages/delivery/`)

Conformando estrictamente a `ADR-013`, `@trident/delivery` no posee dependencias externas de infraestructura ni de base de datos; depende únicamente de `@trident/core`.

1. **`packages/delivery/package.json` & `tsconfig.json`:**
   - Declaración de workspace monorepo `@trident/delivery` con `type: "module"` y dependencia canónica `@trident/core: "*"`.
   - Compilación con TypeScript `NodeNext`.

2. **`packages/delivery/src/types.ts`:**
   - Enums canónicos:
     - `DeliveryChannel`: `UBER_EATS`, `RAPPI`, `DIDIFOOD`, `DIRECT_FLEET`.
     - `ExternalOrderStatus`: `PLACED`, `ACCEPTED`, `PREPARING`, `READY_FOR_PICKUP`, `OUT_FOR_DELIVERY`, `DELIVERED`, `CANCELLED`, `REJECTED`.
     - `RejectionReason`: `KITCHEN_BUSY`, `STORE_CLOSED`, `ITEM_OUT_OF_STOCK`, `UNAUTHORIZED_CHANNEL`, `PRICE_MISMATCH`, `AMOUNT_OUT_OF_BOUNDS`, `INTERNAL_ERROR`.
   - Modelos de datos canónicos:
     - `ConnectorContract`: Configuración canónica por agregador (cabeceras de firma, algoritmo, ventana de replay).
     - `DeliveryFinancials`: Desglose exacto en escala-4 (subtotal, impuestos, delivery fee, comisiones, propinas, descuentos, total).
     - `DeliveryItem` & `DeliveryItemModifier`: Items con opciones de preparación, instrucciones especiales y códigos SKU resueltos.
     - `DeliveryOrder`: Representación unificada normalizada del pedido.
     - `KdsComandaDispatch`: Comanda estructurada para inyección directa en el Kitchen Display System (`@trident/pos`).
     - `CatalogMappingProvider`: Puerto para mapeo de identificadores externos de platillos/modificadores a SKUs internos.
     - `AutoAcceptRule` & `AutoAcceptDecision`: Políticas automatizadas de aprobación de pedidos.

3. **`packages/delivery/src/numerics.ts`:**
   - Cumplimiento de `ADR-012` y `SYS-INV-001` mediante aritmética de punto fijo en escala-4 (`0.0000`) respaldada por `BigInt`.
   - Operaciones seguras sin punto flotante: `toScale4BigInt`, `fromScale4BigInt`, `addScale4`, `subScale4`, `multiplyScale4`, `divideScale4`, `compareScale4`.

4. **`packages/delivery/src/errors.ts`:**
   - Jerarquía exhaustiva de errores de dominio fail-closed:
     - `InvalidWebhookSignatureError`: Firma HMAC forjada o faltante (HTTP 401).
     - `StaleWebhookTimestampError`: Replay attack o deriva de reloj superior a políticas (HTTP 400).
     - `DuplicateWebhookEventError`: Evento duplicado ya procesado (HTTP 409).
     - `UnknownDeliveryProviderError`: Canal de agregador no soportado o inválido.
     - `IntegrationDisabledError`: Canal desactivado administrativamente para la sucursal.
     - `UnmappedCatalogItemError`: Platillo externo sin equivalencia en catálogo maestro.
     - `DeliveryOrderRejectedError`: Pedido declinado por políticas de negocio.

5. **`packages/delivery/src/webhook-verifier.ts` (`SEC-VAL-10`):**
   - Verificador criptográfico universal multi-canal:
     - Uber Eats: HMAC-SHA256 de cuerpo crudo, cabeceras `x-uber-signature`.
     - Rappi: HMAC-SHA256 con timestamp concatenado, cabeceras `x-rappi-signature` y `x-rappi-timestamp`.
     - Didi Food: HMAC-SHA256, cabeceras `x-didifood-signature`.
   - Comparación criptográfica timing-safe mediante `crypto.timingSafeEqual` con buffers de longitud fija para prevenir timing side-channel attacks.
   - Ventana de tolerancia anti-replay configurable (por defecto 300,000 ms / 5 minutos).
   - Rechazo estricto de eventos con deriva de reloj hacia el futuro (>60,000 ms).
   - Tienda de deduplicación de eventos (`WebhookDeduplicationStore`) con limpieza automática por TTL para prevenir replay attacks a nivel de carga útil.

6. **`packages/delivery/src/order-transformer.ts`:**
   - Mapeador de esquemas externos al modelo canónico `DeliveryOrder`.
   - Resolución de catálogo a través de `CatalogMappingProvider` con modo estricto fail-closed.
   - Normalización de desgloses financieros en escala-4 `0.0000`.
   - Motor de decisión de auto-aceptación:
     - Validación de estado de integración de la sucursal.
     - Verificación de límites mínimos y máximos de compra.
     - Detección de sobrecarga de cocina (`KITCHEN_BUSY`) y horario comercial (`STORE_CLOSED`).

7. **`packages/delivery/src/kds-dispatcher.ts`:**
   - Convertidor de pedido aceptado a comanda de cocina `KdsComandaDispatch`.
   - Formateo de notas de preparación e identificadores de display para el personal de cocina.
   - Fail-closed: prohíbe el envío a KDS de pedidos que no estén en estado `ACCEPTED`.

8. **`packages/delivery/src/delivery-service.ts`:**
   - Orquestador central `DeliveryHubService`:
     - Recibe webhook crudo -> Verifica criptografía y replay -> Transforma pedido -> Resuelve catálogo -> Evalúa auto-accept -> Despacha a KDS -> Retorna orden procesada y decisión.

---

### 2.2 PostgreSQL Database Multi-Tenant Layer (`packages/database/`)

1. **Migración SQL `packages/database/migrations/20261015000000_delivery_hub_aggregators.sql`:**
   - Tres tablas físicas relacionales multi-tenant:
     - `delivery_integrations`: Configuración de credenciales de API por sucursal y agregador (secretos webhook encriptados, auto-accept toggle, comisiones).
     - `external_orders`: Registro integral de pedidos de terceros con números de orden de agregador, repartidores, desglose financiero en `NUMERIC(14,4)` y timestamps.
     - `webhook_events`: Bitácora inmutable de eventos recibidos para auditoría forense, deduplicación y rastreo de payloads crudos.
   - **Row Level Security (RLS) & FORCE RLS:**
     - Aplicado en las 3 tablas con política `tenant_isolation_policy` evaluada contra `current_app_org_id()`.
     - `FORCE ROW LEVEL SECURITY` habilitado en todas las tablas para evitar bypass accidental.
   - **Índices de Alto Rendimiento:**
     - `idx_delivery_integrations_org_branch` y unicidad compuesta `(organization_id, branch_id, channel)`.
     - `idx_external_orders_org_lookup` y unicidad `(organization_id, channel, external_order_id)`.
     - `idx_webhook_events_dedup` con unicidad `(organization_id, channel, event_id)`.
   - **Down Migration Limpia:**
     - Reversión atómica y no destructiva de las 3 tablas preservando la integridad de tablas predecesoras (CRM, Billing, Finance, etc.).

2. **Suite de Pruebas de Base de Datos (`packages/database/src/delivery.test.ts`):**
   - 7 pruebas automatizadas de integración ejecutadas contra PostgreSQL 16:
     - `WP023-DB-01`: Existencia física de las 3 tablas de WP-023 en el esquema público.
     - `WP023-DB-02`: RLS y FORCE RLS habilitados y forzados en las 3 tablas.
     - `WP023-DB-03`: Tenant default-deny devuelve 0 filas visibles cuando falta el contexto de tenant.
     - `WP023-DB-04`: Separación estricta de visibilidad entre Tenant A y Tenant B.
     - `WP023-DB-05`: Llaves candidatas compuestas rechazan duplicados en el mismo tenant y permiten coexistencia en tenants distintos.
     - `WP023-DB-06`: Validación de unicidad e idempotencia en pedidos externos y eventos de webhook.
     - `WP023-DOWN-01`: Rollback no destructivo de WP-023 elimina exclusivamente las tablas de delivery y preserva CRM, Billing, etc.

---

## 3. Verification & Quality Gates Results

| Check / Gate | Target / Standard | Result | Details |
|---|---|---|---|
| Monorepo Graph | `scripts/check-graph.mjs` | **PASS (44/44)** | 15 paquetes monorepo reconocidos, 0 ciclos de dependencias, frontera de dominio pura respetada. |
| TypeScript Types | `turbo run typecheck` | **PASS (24/24)** | 0 errores de TypeScript en los 15 paquetes del monorepo. |
| ESLint Rules | `turbo run lint` | **PASS (15/15)** | 0 errores de ESLint en todos los paquetes. |
| Prettier Formatting | `npm run format:check` | **PASS** | 100% de archivos formateados con estilo canónico. |
| Unit Tests `@trident/delivery` | `packages/delivery/src/index.test.ts` | **PASS (16/16)** | Numerics scale-4, SEC-VAL-10 HMAC-SHA256, Replay window, Clock drift, Event dedup, Catalog mapping, Auto-accept, KDS dispatch. |
| Database Tests `@trident/database` | `packages/database/src/delivery.test.ts` | **PASS (7/7)** | Esquema físico, RLS, FORCE RLS, default-deny, aislamiento multi-tenant, idempotencia y down-migration. |
| Full Database Suite | `npm run db:test` | **PASS (297/297)** | index, outbox, sync, inventory, procurement, finance, billing, crm, delivery sin regresiones. |

---

## 4. Architectural Invariants Sign-off
- **`SYS-INV-001` / `ADR-012` Zero Floats:** Todos los importes monetarios (subtotal, comisiones, delivery fees, propinas, descuentos) operan exclusivamente con `BigInt` escala-4 (`0.0000`).
- **`ADR-013` Domain Purity:** `@trident/delivery` depende única y exclusivamente de `@trident/core`.
- **`SEC-VAL-10` Cryptographic Webhook Security:** Comparación timing-safe con `crypto.timingSafeEqual`, rechazo de firmas forjadas, control de deriva de reloj (≤60s), ventana anti-replay (≤300s) y deduplicación de eventos.
- **Tenant Isolation:** RLS forzado (`FORCE ROW LEVEL SECURITY`) con separación garantizada entre tenants y política default-deny.
