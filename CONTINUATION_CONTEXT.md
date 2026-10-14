# TRIDENTPOS / ERP RESTAURANTES — CONTEXTO MAESTRO DE CONTINUACIÓN

> **Propósito:** Documento de transferencia de contexto completo y de alta fidelidad que certifica la arquitectura, completitud e historial de implementación de la plataforma TRIDENTPOS bajo EAAF v1.3.0.  
> **Fecha de Estado:** Octubre 2026  
> **Framework de Gobernanza:** EAAF v1.3.0 (Perfil Lean, ACR-2026-021 / Solo Maintainer Model ADR-010)  
> **Repositorio:** `https://github.com/Lucas030509/TRIDENTPOS.git`  
> **Rama Actual:** `feat/wp-028-release-packaging`  
> **Hito:** **100% COMPLETADO (34 de 34 Work Packages Cerrados — Release Readiness)**

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
   - `@trident/crm`: Clientes, Cuentas corporativas, RestCard (lealtad y puntos), Promociones.
   - `@trident/delivery`: Agregadores externos (Uber Eats, Rappi, Didi) y logística de flota propia.
3. **Capa 3: Infraestructura Técnica (Únicamente dependen de `@trident/core`)**
   - `@trident/database`: Migraciones PostgreSQL 16+, RLS multi-tenant estricto (`current_app_org_id()`), Cloud Outbox, Repositorios.
   - `@trident/edge`: Host Electron endurecido (`contextIsolation: true`, `sandbox: true`), SQLite WAL local duradero, IAM offline, mDNS enrollment.
   - `@trident/sync`: Cliente y servidor de sincronización bidireccional resiliente a desconexión WAN.
   - `@trident/ui`: Sistema de diseño accesible (WCAG 2.2 AA), tokens canónicos, componentes táctiles (targets $\ge$ 48px, teclados 72px).
4. **Capa 4: Raíces de Composición (Composition Roots)**
   - `@trident/pos-edge-runtime`: Servidor Fastify local LAN en la sucursal, base de datos SQLite WAL local, WebSockets para KDS y controladores de hardware (impresoras ESC/POS, cajón de dinero, básculas y terminales pinpad).
   - `@trident/pos-renderer`: Aplicación SPA táctil nativa (React + Vite) con 4 terminales completas:
     - `/salon`: Salón interactivo, distribución de mesas, comanda rápida, modificadores.
     - `/kds/:estacionId`: Pantalla táctil de cocina, control de tiempos con semáforo, bump bar táctil y por teclado.
     - `/caja`: Control de turnos, cobro multi-método (Efectivo, Tarjeta, Transferencia, Pago Dividido), propinas, arqueo ciego estricto (DEC-017) y cortes X/Z.
   - `@trident/cloud-server`: Orquestación cloud multi-sucursal, APIs REST corporativas, portal administrativo backoffice, despacho de Outbox/DLQ.

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
6. **Cadena de Suministro y Auto-Update Seguro (`SUPPLY_CHAIN_SECURITY.md`):**
   - Paquetes de distribución multi-plataforma firmados con Ed25519.
   - Manifests `latest*.yml` con firma criptográfica y checksums SHA-256 / SHA-512.
   - Generación estricta de CycloneDX 1.5 SBOM y atestación de procedencia SLSA Nivel 3.

---

## 3. Estado Cuantitativo del Proyecto (100% Release Readiness)

| Métrica | Valor | Estado |
|---|---|---|
| **Work Packages Totales (EAAF)** | **34** | **100%** |
| **Work Packages Completados** | **34** | **100% COMPLETADO** |
| **Work Packages Pendientes** | **0** | **0% (Release Ready)** |
| **Reglas de Grafo Arquitectónico** | **44 / 44 PASS** | **0 ciclos, pureza estricta** |
| **TypeScript Typecheck** | **26 / 26 paquetes PASS** | **0 errores** |
| **ESLint & Prettier** | **17 / 17 paquetes PASS** | **0 errores, 100% formateado** |
| **Pruebas Automatizadas Totales** | **> 850 assertions PASS** | **100% Verdes** |
| **Vulnerabilidades de Seguridad** | **0** | **SAST, SCA, Secret Scan limpios** |

---

## 4. Matriz de los 34 Work Packages Completados

### Fase 1: Kernel & Fundaciones Cloud (WP-001 a WP-006)
- `WP-001`: Monorepo Structure & Build Tooling
- `WP-002`: Automated CI/CD Pipelines & Security Scanning
- `WP-003`: Cloud PostgreSQL Database Scaffolding & Migration Engine
- `WP-004`: Organization & Branch Multi-Tenant RLS Foundation
- `WP-005`: Cloud IAM & Administrative Authentication
- `WP-006`: Tamper-Evident Security Logging & Cloud Audit Trail

### Fase 2: Plataforma Edge & Sincronización WAN (WP-007 a WP-013)
- `WP-007`: Edge Host Runtime Scaffolding & Electron Security Hardening
- `WP-008`: Edge Local Database (SQLite WAL) & Durability Manager
- `WP-009`: Edge Enrollment & Trust Bootstrap Protocol
- `WP-010`: Edge Offline IAM & Floor PIN Authentication Engine
- `WP-011`: Folio Lease Allocation & Fencing Protocol Engine
- `WP-012`: Transactional Outbox & Ingested Idempotency Engine
- `WP-013`: Bidirectional Synchronization Service & WAN Reconnection Protocol

### Fase 3: Dominios Operativos de Restaurante (WP-014 a WP-021)
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
- `WP-021`: Fiscal Invoicing Engine (PAC CFDI 4.0 / Electronic Invoicing)

### Fase 4: Fidelización, Agregadores & Experiencia Táctil (WP-022 a WP-026D)
- `WP-022`: CRM & Lealtad RestCard (Puntos, niveles, monedero electrónico)
- `WP-023`: Delivery Hub & Aggregator Webhook Integration (Uber Eats, Rappi, Didi)
- `WP-024`: Corporate Backoffice Web Portal (Consolidación, reportes, gestión)
- `WP-025`: Mobile Waiter Handheld Client (Comandero Móvil PWA)
- `WP-026A`: Native POS App Shell & Design System Foundation (`@trident/ui`)
- `WP-026B`: Salón & Comandero Táctil UI (`/salon`)
- `WP-026C`: KDS Station UI & Bump Bar (`/kds/:estacionId`)
- `WP-026D`: Caja & Payment UI, Cobro Táctil, Arqueo Ciego (`/caja`)

### Fase 5: Chaos Testing, Benchmarking & Release Readiness (WP-027 a WP-028)
- `WP-027`: Cross-Context E2E Integration Across 11 Bounded Contexts & Non-Functional Chaos Testing (`SEC-VAL-09`, `DAT-08`, `RSK-15`, `ADR-012`).
- `WP-028`: Hardware Benchmarking under Constrained Profile ($\le 2\text{ GB}$ RAM, 2 vCPUs), Multi-Platform Release Packaging, Ed25519 Auto-Update Protocol, CycloneDX 1.5 SBOM, SLSA Level 3 Provenance Attestation.

---

## 5. Comandos de Verificación del Monorepo

```bash
# 1. Chequeo estricto del grafo de dependencias y modularidad (44 reglas)
npm run graph:check

# 2. Verificación de tipos estática en todos los paquetes
npm run typecheck

# 3. Linter del código fuente
npm run lint

# 4. Formateo y estilo de código
npm run format:check

# 5. Compilación del proyecto completo
npm run build

# 6. Ejecución de la suite completa de pruebas unitarias e integración
npm run test

# 7. Ejecución de benchmarks de hardware (WP-028)
npm run test:native:benchmarks

# 8. Empaquetado y verificación de firmas de release
npm run package:release
npm run verify:release
```
