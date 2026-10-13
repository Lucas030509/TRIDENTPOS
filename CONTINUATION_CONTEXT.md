# TRIDENTPOS / ERP RESTAURANTES — CONTEXTO MAESTRO DE CONTINUACIÓN

> **Propósito:** Documento de transferencia de contexto completo y de alta fidelidad para que cualquier modelo LLM o ingeniero agente reanude la construcción y finalización de la plataforma TRIDENTPOS sin pérdida de contexto ni degradación arquitectónica.
> **Fecha de Estado:** Octubre 2026
> **Framework de Gobernanza:** EAAF v1.3.0 (Perfil Lean, ACR-2026-021 / Solo Maintainer Model ADR-010)
> **Repositorio:** `https://github.com/Lucas030509/TRIDENTPOS.git`
> **Rama Base Actualizada:** `main` (commit canónico reciente con WP-026D mergeado vía PR #72)
> **Rama de Trabajo Activa:** `feat/wp-022-crm-loyalty`

---

## 1. Visión General del Sistema y Arquitectura

**TRIDENTPOS** es una suite integral ERP / POS de alta concurrencia y tolerancia a fallos diseñada para la industria gastronómica y restaurantera, estructurada bajo el principio fundacional:
$$\mathbf{MODULAR\ BY\ DESIGN\ —\ INTEGRATED\ BY\ CONTRACT}$$

### Topología de Capas (ADR-001, ADR-013)
1. **Capa 1: Kernel del Sistema (`@trident/core`)**
   - Tipos base, Money exacto (Fixed-Point Escala 4 `ADR-012`), PIN hashing (Argon2id), RBAC canónico, contratos de sincronización y sanitización de datos. Cero dependencias internas.
2. **Capa 2: Dominios Puros de Negocio (Domain Purity: Únicamente dependen de `@trident/core`)**
   - `@trident/pos`: Salón, Mesas, Cuentas, OCC, Turnos de caja, Cobros, Arqueo Ciego, Cortes X/Z.
   - `@trident/inventory`: Multialmacén, Recetas, Escandallos, Kárdex, Mermas.
   - `@trident/procurement`: Proveedores, Órdenes de Compra, Recepciones, Políticas de variación de precio.
   - `@trident/finance`: Cuentas por Pagar (CxP), Cuentas por Cobrar (CxC), Conciliación, Gastos.
   - `@trident/billing`: Facturación electrónica CFDI 4.0, integración con PAC, lotes y timbrado.
   - `@trident/crm`: Clientes, Cuentas corporativas, RestCard (lealtad y puntos), Promociones. *(En construcción activa — WP-022)*.
   - `@trident/delivery`: Agregadores externos (Uber Eats, Rappi, Didi) y logística de flota propia. *(Siguiente — WP-023)*.
3. **Capa 3: Infraestructura Técnica (Únicamente dependen de `@trident/core`)**
   - `@trident/database`: Migraciones PostgreSQL 16+, RLS multi-tenant estricto (`current_app_org_id()`), Cloud Outbox, Repositorios.
   - `@trident/edge`: Host Electron endurecido (`contextIsolation: true`, `sandbox: true`), SQLite WAL local duradero, IAM offline, mDNS enrollment.
   - `@trident/sync`: Cliente y servidor de sincronización bidireccional resiliente a desconexión WAN.
   - `@trident/ui`: Sistema de diseño accesible (WCAG 2.2 AA), tokens canónicos, componentes táctiles (targets $\ge$ 48px, teclados 72px).
4. **Capa 4: Raíces de Composición (Composition Roots)**
   - `@trident/pos-edge-runtime`: Servidor Fastify local LAN en la sucursal, base de datos SQLite WAL local, WebSockets para KDS y controladores ESC/POS (impresoras y apertura de cajón).
   - `@trident/pos-renderer`: Aplicación SPA táctil nativa (React + Vite) con 4 terminales completas:
     - `/salon`: Salón interactivo, distribución de mesas, comanda rápida, modificadores.
     - `/kds/:estacionId`: Pantalla táctil de cocina, control de tiempos con semáforo, bump bar táctil y por teclado.
     - `/caja`: Control de turnos, cobro multi-método (Efectivo, Tarjeta, Transferencia, Pago Dividido), propinas, arqueo ciego estricto (DEC-017) y cortes X/Z.
   - `@trident/cloud-server`: Orquestación cloud multi-sucursal, APIs REST corporativas, despacho de Outbox/DLQ.

---

## 2. Invariantes y Reglas No Negociables

1. **Aritmética Exacta (`SYS-INV-001` / `ADR-012`):**
   - Prohibido el uso de números flotantes (`float`/`double`) para dinero, saldos, puntos y cantidades.
   - Todo número opera como entero en base escala-4 (`DECIMAL(12, 4)` en SQL, `BigInt` escala 4 en TypeScript con strings formateados `"0.0000"`).
2. **Pureza de Dominios y Reglas de Grafo (`ADR-013`):**
   - Los dominios de negocio jamás se importan entre sí (`@trident/pos` $\not\leftrightarrow$ `@trident/inventory`).
   - Se valida obligatoriamente con `npm run graph:check` (44 reglas estrictas, cero ciclos).
3. **Seguridad Multi-Tenant RLS:**
   - Toda tabla multi-tenant en PostgreSQL debe tener `ENABLE ROW LEVEL SECURITY` y `FORCE ROW LEVEL SECURITY`.
   - Política `default-deny` aislando por `organization_id = current_app_org_id()`.
4. **Arqueo Ciego Estricto (`DEC-017`):**
   - La interfaz y endpoints jamás devuelven ni muestran el saldo esperado del sistema antes de capturar el efectivo físico contado por el cajero. La conciliación y diferencia se calcula y devela únicamente tras registrar el conteo ciego.
5. **Ergonomía Táctil y WCAG 2.2 AA (`VISUAL_SYSTEM.md`):**
   - Touch targets interactivos mínimos de 48px.
   - Teclas de teclado numérico de 72px.
   - Botones de acción primaria de cobro/liquidación de 72px.

---

## 3. Estado Cuantitativo del Proyecto

| Métrica | Valor |
|---|---|
| **Work Packages Totales (EAAF)** | **34** |
| **Work Packages Completados y Mergeados en `main`** | **28 (82.4%)** |
| **Work Packages en Ejecución Activa** | **1 (WP-022 CRM & Loyalty — 2.9%)** |
| **Work Packages Restantes** | **5 (14.7%)** |
| **Tests Automatizados Totales** | **> 750 (100% PASS)** |
| **Reglas de Grafo Arquitectónico** | **44 / 44 PASS (0 ciclos)** |
| **Vulnerabilidades de Seguridad** | **0 (SAST, SCA, SBOM, Secret Scan limpios)** |

---

## 4. Estado de los Work Packages

### Completados y en `main`:
- `WP-001`: Monorepo Structure & Build Tooling
- `WP-002`: Automated CI/CD Pipelines & Security Scanning
- `WP-003`: Cloud PostgreSQL Database Scaffolding & Migration Engine
- `WP-004`: Organization & Branch Multi-Tenant RLS Foundation
- `WP-005`: Cloud IAM & Administrative Authentication
- `WP-006`: Tamper-Evident Security Logging & Cloud Audit Trail
- `WP-007`: Edge Host Runtime Scaffolding & Electron Security Hardening
- `WP-008`: Edge Local Database (SQLite WAL) & Durability Manager
- `WP-009`: Edge Enrollment & Trust Bootstrap Protocol
- `WP-010`: Edge Offline IAM & Floor PIN Authentication Engine
- `WP-011`: Folio Lease Allocation & Fencing Protocol Engine
- `WP-012`: Transactional Outbox & Ingested Idempotency Engine
- `WP-013`: Bidirectional Synchronization Service & WAN Reconnection Protocol
- `WP-014`: Dining Room, Tables & Orders Domain Engine with OCC
- `WP-014A`: Dining Operations Expansion (Dividir cuentas, transferir mesas)
- `WP-015`: Kitchen Display System (KDS) LAN Event Dispatcher & Printer Service
- `WP-016`: Cash Management, Shifts & Arqueo Ciego (Cortes X & Z)
- `WP-016B`: Platform Core Master Catalog Foundation (Categories & Products)
- `WP-016C`: POS Payment Orchestration & Account Settlement
- `WP-017`: Inventory Catalog, Multi-Warehouse & Recipe Explosion Engine
- `WP-018`: Real-Time Kárdex, Waste Tracking & KDS Depletion Service
- `WP-019`: Procurement, Supplier Management & Physical Receiving
- `WP-020`: Finance, Accounts Payable/Receivable & Cash Reconciliation
- `WP-021`: Fiscal Invoicing Engine (PAC CFDI / Electronic Invoicing)
- `WP-026A`: Native POS App Shell & Design System Foundation (`@trident/ui`)
- `WP-026B`: Salón & Comandero Táctil UI (`/salon`)
- `WP-026C`: KDS Station UI & Bump Bar (`/kds/:estacionId`)
- `WP-026D`: Caja & Payment UI, Cobro Táctil, Arqueo Ciego (`/caja`)

---

## 5. Tarea en Curso: `WP-022` (CRM & Lealtad RestCard)

**Rama Git Activa:** `feat/wp-022-crm-loyalty`

### Objetivos de WP-022:
1. Paquete `@trident/crm` (`packages/crm/`):
   - [x] `package.json` y `tsconfig.json` creados y alineados a `@trident/core`.
   - [x] `src/types.ts`: Tipos canónicos (`Customer`, `CustomerDeliveryAddress`, `LoyaltyAccount`, `LoyaltyTransaction`, `Promotion`).
   - [x] `src/errors.ts`: Jerarquía de errores de dominio CRM.
   - [x] `src/numerics.ts`: Aritmética fija escala-4 con `BigInt`.
   - [ ] `src/loyalty-engine.ts`:
     - Cálculo de puntos por nivel (`BRONZE`, `SILVER`, `GOLD`, `PLATINUM`).
     - Redención de puntos contra saldo actual con garantía de no-doble-gasto.
     - Operaciones de monedero electrónico prepagado (RestCard Top-Up / Cargo).
     - Expiración periódica determinista de puntos antiguos.
     - Evaluación de promociones de cumpleaños y multiplicadores.
   - [ ] `src/customer-service.ts`:
     - Normalización de números telefónicos (10 dígitos limpios para búsqueda instantánea por identificador de llamadas / Caller-ID en POS).
     - Validación de formato fiscal de RFC mexicano (12 caracteres personas morales, 13 físicas).
     - Verificación de límites de crédito y sobregiro (`allowOverdraft`).
     - Procedimiento de anonimización y purga de datos por retención (`SEC-VAL-11`).
   - [ ] `src/index.ts`: Barril de exportaciones de dominio.
   - [ ] `src/index.test.ts`: Suite de pruebas unitarias cubriendo todos los casos límite.
2. Migración SQL en `packages/database/migrations/20261014000000_crm_loyalty_rewards.sql`:
   - Tablas físicas: `customers`, `customer_delivery_addresses`, `loyalty_accounts`, `loyalty_transactions`, `promotions`.
   - Restricciones: RLS habilitado y forzado en todas las tablas, candidate keys (`uq_customers_org_code`, `uq_loyalty_card`), índice `(organization_id, phone)` para Caller-ID de alta velocidad, trigger append-only en `loyalty_transactions` para prohibir `UPDATE` y `DELETE`.
   - Función de rollback down migration limpia.
3. Tests de persistencia e integración en `packages/database/src/crm.test.ts`.
4. Exposición de rutas en `packages/cloud-server` (`/api/v1/crm/*`, `/api/v1/lealtad/*`).
5. Generación de evidencia `evidence/WP-022_BUILDER_EVIDENCE.md`, PR y Merge a `main`.

---

## 6. Hoja de Ruta Restante para Completar al 100%

### Wave 7:
* **WP-023: Delivery Hub & Aggregator Webhook Integration Engine**
  - Paquete `@trident/delivery`.
  - Verificación de firma criptográfica HMAC en webhooks entrantes (Uber Eats, Rappi, Didi Food).
  - Protección anti-replay con ventana de tiempo tolerable y deduplicación de eventId.
  - Mapeo de comanda externa al `OrderAggregate` interno y despacho automático a KDS en la sucursal.

### Wave 8:
* **WP-024: Corporate Backoffice Web Portal (Next.js / React)**
  - Portal administrativo central para consolidación de ventas, menú maestro, reportes de compras e inventarios.
* **WP-025: Mobile Waiter Handheld Client (Comandero Móvil)**
  - Cliente PWA/React optimizado para teléfonos y terminales handheld para toma de comandas al pie de mesa.

### Wave 9:
* **WP-027: Cross-Context E2E Integration & Non-Functional Chaos Testing**
  - Pruebas integrales de partición de red LAN, desconexión WAN abrupta y recuperación tras corte de energía imprevisto (`SIGKILL` en Electron y SQLite WAL).
* **WP-028: Hardware Benchmarking & Release Packaging**
  - Empaquetado final de binarios de instalación para macOS, Linux y Windows, benchmarks de latencia de impresión y firma de release con SLSA-3.

---

## 7. Comandos de Verificación del Monorepo

Para asegurar que cualquier cambio mantenga la estabilidad absoluta:

```bash
# 1. Chequeo estricto del grafo de dependencias y modularidad (44 reglas)
npm run graph:check

# 2. Verificación de tipos estática en los 13 paquetes
npm run typecheck

# 3. Linter del código fuente
npm run lint

# 4. Formateo y estilo de código
npm run format:check

# 5. Compilación del proyecto completo
npm run build

# 6. Ejecución de la suite completa de pruebas
npm run test
```
