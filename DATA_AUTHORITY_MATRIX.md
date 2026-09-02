# DATA AUTHORITY MATRIX — ERP RESTAURANTES / TRIDENTPOS

**Document ID:** `ARCH-AUT-001`  
**Version:** `1.0 APPROVED / FROZEN`  
**Status:** `APPROVED / FROZEN — 2026-09-01`  
**Date:** 2026-09-01  
**Framework:** `EAAF v1.2.0 @ 7e036f43240b3dc28ccb996e350263598275b2cd`  
**Author Agent:** `03_Data_Architect`  
**Approved Solution Baseline:** `e35205906055a8425ab875d05789652b3c3497b7` (Tag `solution-architecture-v1.3-approved`)  

---

## 1. Matriz Exhaustiva de Autoridad de Datos por Topología

| Agregado / Entidad | Topología | Authoritative Source (SoR) | Writable Node | Read Replica | Dirección de Sync | Política de Conflicto | Autoridad de Reconciliación |
|---|---|---|---|---|---|---|---|
| **Organizaciones & Sucursales** | 1. Full Suite | Cloud PostgreSQL | Cloud | Edge SQLite | Cloud → Edge (Full Bootstrap) | Cloud Wins (Inmutable) | Cloud Platform Core |
| **Usuarios, Roles & PINs** | 1. Full Suite | Cloud PostgreSQL | Cloud | Edge SQLite (CachedUsers) | Cloud → Edge (Deltas) | Cloud Wins (Revocation Delta) | Cloud Platform Core |
| **Catálogo Maestro (Prod/Menús/Mod)** | 1. Full Suite | Cloud PostgreSQL | Cloud | Edge SQLite (local_products) | Cloud → Edge (Atomic Staging) | Cloud Wins (Checksum Verification)| Cloud Platform Core |
| **Precios Base & Impuestos** | 1. Full Suite | Cloud PostgreSQL | Cloud | Edge SQLite | Cloud → Edge (Deltas) | Cloud Wins (Preserva Open Sales) | Cloud Platform Core |
| **Branch Overrides (Precios Locales)**| 1. Full Suite | Cloud PostgreSQL | Cloud | Edge SQLite | Cloud → Edge (Deltas) | Cloud Wins | Cloud Platform Core |
| **Salones & Mesas** | 1. Full Suite | Edge SQLite | Edge Host Local | Cloud (Analytics Read Replica)| Edge → Cloud (Outbox) | OCC (`expectedVersion` on Edge) | Edge TRIDENTPOS |
| **Cuentas & Comandas Activas** | 1. Full Suite | Edge SQLite | Edge Host Local | Cloud (Consolidación) | Edge → Cloud (Outbox) | OCC (`expectedVersion` on Edge) | Edge TRIDENTPOS |
| **KDS (Preparación Cocina/Barra)** | 1. Full Suite | Edge SQLite | Edge Host Local | Cloud (Analytics) | Edge → Cloud (Outbox) | Causal Sequence Number | Edge TRIDENTPOS |
| **Turnos de Caja & Arqueos** | 1. Full Suite | Edge SQLite | Edge Host Local | Cloud (Finance) | Edge → Cloud (Outbox) | OCC + Fencing Token | Edge TRIDENTPOS |
| **Pagos & Transacciones de Cobro** | 1. Full Suite | Edge SQLite | Edge Host Local | Cloud (Finance) | Edge → Cloud (Outbox) | Append-Only + Idempotency Key | Edge TRIDENTPOS |
| **Cortes X y Z Diarios** | 1. Full Suite | Edge SQLite | Edge Host Local | Cloud (Finance SoR) | Edge → Cloud (Outbox) | Lease Preasignado + Época | Edge TRIDENTPOS |
| **Recetas, Almacenes & Kárdex** | 1. Full Suite | Cloud PostgreSQL | Cloud | N/A | Inter-Module Durable Events | ACID Transactional Outbox | Cloud Inventory |
| **Compras & Órdenes de Compra** | 1. Full Suite | Cloud PostgreSQL | Cloud | N/A | Inter-Module Events | Transactional Outbox | Cloud Procurement |
| **Finanzas (CxP, CxC, Gastos)** | 1. Full Suite | Cloud PostgreSQL | Cloud | N/A | Inter-Module Events | Append-Only Ledger | Cloud Finance |
| **Facturación Fiscal (CFDI)** | 1. Full Suite | Cloud PostgreSQL | Cloud | Edge (Emisión Local si Stand.)| API Gateway | PAC / SAT Authority | Cloud Billing |
| **Clientes & Cuentas Corporativas** | 1. Full Suite | Cloud PostgreSQL | Cloud | Edge (Cache de Búsqueda) | Cloud → Edge (Deltas) | Cloud Wins | Cloud CRM |
| **Delivery Flota Propia** | 1. Full Suite | Cloud PostgreSQL | Cloud / Edge | Edge (Despacho Local) | Edge ↔ Cloud Sync | Outbox Queue | Cloud Delivery |
| **Lealtad & Monedero RestCard** | 1. Full Suite | Cloud PostgreSQL | Cloud | Edge (Cache Saldo Offline) | Edge ↔ Cloud Sync | Cloud Central Authority | Cloud Loyalty |
| **Conectores Delivery Externos** | 1. Full Suite | Cloud PostgreSQL | Cloud | N/A (Inyección a Edge) | Cloud → Edge (Commands) | Integrations Normalization | Cloud Integrations |
| **Suite Completa Standalone POS** | 2. Standalone POS | Edge SQLite (100%)| Edge Host Local | N/A | Local Only | N/A (Autónomo 100%) | Edge Host Local |
| **Backoffice Standalone** | 3. Standalone BO | Cloud PostgreSQL | Cloud | N/A | Ingesta vía API Externa | Schema Validation | Cloud SoR |
| **Híbrido (TRIDENTPOS + ERP Ext.)**| 4. Hybrid ERP | Cloud / ERP Ext. | Edge (Piso) / ERP (Fin.) | Cloud / ERP Ext. | Edge → Cloud → ERP Ext. | Interface Policy Contract | ERP Corporativo Externo |

---

DOCUMENT STATUS: APPROVED / FROZEN — 2026-09-01
