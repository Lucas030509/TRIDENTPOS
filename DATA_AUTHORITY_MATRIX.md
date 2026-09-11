# DATA AUTHORITY MATRIX — ERP RESTAURANTES / TRIDENTPOS

> [!NOTE]
> **ACR-2026-011 PRODUCT OWNER APPROVED OVERLAY — PENDING MERGE TO MAIN**
> 
> The additions in this document relating to WP-009 (`enrollment_tokens`, `station_credentials`, `edge_security_audit`) represent governance overlays formally approved by the Product Owner via ACR-2026-011, pending promotion into canonical main. The underlying baseline remains `APPROVED / FROZEN — 2026-09-01`.

**Document ID:** `ARCH-AUT-001`  
**Version:** `1.0 APPROVED / FROZEN` (with ACR-2026-011 Approved Overlay)  
**Status:** `APPROVED / FROZEN — 2026-09-01` (`ACR-2026-011 PRODUCT OWNER APPROVED — PENDING MERGE TO MAIN`)  
**Date:** 2026-09-01  
**Framework:** `EAAF v1.2.0 @ 7e036f43240b3dc28ccb996e350263598275b2cd`  
**Author Agent:** `03_Data_Architect` (Overlay Synthesis: `01_Solution_Architect`)  
**Approved Solution Baseline:** `e35205906055a8425ab875d05789652b3c3497b7` (Tag `solution-architecture-v1.3-approved`)  

---

## 1. Matriz Exhaustiva de Autoridad de Datos por Topología

| Agregado / Entidad | Topología | Authoritative Source (SoR) | Writable Node | Read Replica | Dirección de Sync | Política de Conflicto | Autoridad de Reconciliación |
|---|---|---|---|---|---|---|---|
| **Organizaciones & Sucursales** | 1. Full Suite | Cloud PostgreSQL | Cloud | Edge SQLite | Cloud → Edge (Full Bootstrap) | Cloud Wins (Inmutable) | Cloud Platform Core |
| **Usuarios, Roles & PINs** | 1. Full Suite | Cloud PostgreSQL | Cloud | Edge SQLite (CachedUsers) | Cloud → Edge (Deltas) | Cloud Wins (Revocation Delta) | Cloud Platform Core |
| **Estaciones & Terminales (stations)** | 1. Full Suite | Cloud PostgreSQL | Cloud | Edge SQLite (CachedStations) | Cloud → Edge (Delta Sync) | Cloud Wins (Inmutable / Soft Deauth) | Cloud Platform Core |
| **Edge Host Identity & Config (edge_hosts)** | 1. Full Suite | Hybrid: Protected Local Config + Cloud PostgreSQL | Edge Host Local (Runtime) / Cloud (Tenancy) | Cloud Fleet Telemetry | Edge → Cloud (Heartbeats) | Cloud Wins | Edge Host / Cloud Platform Core |
| **Tokens de Enrolamiento (enrollment_tokens)** | 1. Full Suite | Edge SQLite (WAL) | Edge Host Local Console Only | None (LAN-local only) | None (Zero Cloud Sync) | CAS Single-Winner (Consumo Atómico) | Edge Enrollment Subsystem |
| **Credenciales Locales de Estación (station_credentials)** | 1. Full Suite | Edge SQLite (WAL) | Edge Host Local (Enrolamiento / Revocación Local) | Cloud PostgreSQL (Auditoría / Fleet Registry) | Edge → Cloud (Outbox WP-012) / Cloud → Edge (Deltas) | Cloud Wins (Revocación Remota) | Edge Security & IAM Subsystem |
| **Auditoría de Seguridad Local (edge_security_audit)** | 1. Full Suite | Edge SQLite (WAL) | Edge Host Local (Runtime Security Subsystem) | None (Local Append-Only; WP-012 owns future WAN replication) | None (Zero Cloud Sync in WP-009) | Append-Only (Tamper-Evident Hash Chain) | Edge Security & Governance Subsystem |
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

DOCUMENT STATUS: APPROVED / FROZEN — 2026-09-01 (ACR-2026-011 PRODUCT OWNER APPROVED — PENDING MERGE TO MAIN)
