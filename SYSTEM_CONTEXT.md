# SYSTEM CONTEXT & TOPOLOGY ARCHITECTURE — ERP RESTAURANTES

**Document ID:** `ARCH-CTX-001`  
**Version:** `1.3 NORMALIZED / REMEDIATED`  
**Status:** `READY FOR INDEPENDENT REVIEW`  
**Date:** 2026-09-01  
**Baseline:** `EAAF v1.2.0 @ 7e036f43240b3dc28ccb996e350263598275b2cd`  
**Supersedes:** `SYSTEM_CONTEXT.md v1.1`  

---

## 1. C4 Model — Nivel 1: Diagrama de Contexto del Sistema

El sistema `ERP RESTAURANTES` atiende la operación integral gastronómica y corporativa a través de tres planos de ejecución: **Cloud Control Plane**, **Branch Operational Plane** y **External Integration Plane**.

```mermaid
graph TD
    UserAdmin["Administrador Corporativo / Gerente (Web Browser)"]
    UserFloor["Personal Operativo: Cajero, Mesero, Cocinero (POS / KDS / Tablet)"]
    UserCustomer["Comensal / Cliente Final (Portal Web / Facturación)"]

    subgraph ERP_RESTAURANTES["Ecosistema ERP RESTAURANTES"]
        CloudPlane["Cloud Control Plane (Modular Monolith en Render + Supabase + Vercel)"]
        BranchPlane["Branch Operational Plane (TRIDENTPOS Edge Server en Sucursal)"]
    end

    ExternalPlatforms["Plataformas Externas (Delivery Hub, PAC CFDI, PMS Hotel, ERP Corporativo)"]

    UserAdmin -->|HTTPS / Web GUI| CloudPlane
    UserFloor -->|HTTP REST / WebSockets en LAN| BranchPlane
    UserCustomer -->|HTTPS / Portal [PROPOSED / FUTURE]| CloudPlane
    BranchPlane <-->|WSS / HTTPS Sync Outbox Bidireccional| CloudPlane
    CloudPlane <-->|HTTPS REST / Webhooks Seguros| ExternalPlatforms
```

---

## 2. Definición de Planos de Ejecución

1. **Cloud Control Plane (Plano de Control en la Nube):**
   - Centraliza el gobierno multi-tenant de Organizaciones, Sucursales, Usuarios, Roles, Catálogo Maestro de Productos, Menús, Modificadores, Precios Base, Compras, Finanzas y Analítica.
   - Orquesta la sincronización asíncrona de eventos transaccionales provenientes de las sucursales.
2. **Branch Operational Plane (Plano Operacional en Sucursal):**
   - Ejecutado localmente mediante el **Edge Host Server** en cada restaurante.
   - Posee autonomía operativa para continuar la toma de comandas, actualización de KDS, impresión térmica de comandas/cuentas y cobro en caja durante desconexiones a internet.
3. **External Integration Plane (Plano de Integraciones Externas):**
   - Gestionado por el módulo `Integrations Hub` en Cloud. Posee las credenciales, conectores y mapeos hacia agregadores de delivery (Uber Eats, Rappi, Didi Food), PACs de facturación fiscal y ERPs corporativos.

---

## 3. Matriz Exhaustiva de Autoridad de Datos por Topología (REM-03)

| Dominio / Agregado | Topología Full Suite | Topología TRIDENTPOS Standalone | Topología Backoffice Standalone | Topología Híbrido (TRIDENTPOS + ERP Ext.) |
|---|---|---|---|---|
| **Organization & Branch** | Cloud (SoR) | Local Edge (SoR) | Cloud (SoR) | Cloud (SoR) |
| **Users, RBAC & PINs** | Cloud (SoR) / Edge (Auth Cache) | Local Edge (SoR) | Cloud (SoR) | Cloud (SoR) / Edge (Auth Cache) |
| **Entitlements de Módulo** | Cloud (SoR) | Local Edge (SoR) | Cloud (SoR) | Cloud (SoR) |
| **Catálogo Maestro (Prod/Menús/Mod)** | Cloud (SoR) | Local Edge (SoR) | Cloud (SoR) | Cloud / ERP Ext. (Arbitraje: Master Ext.) |
| **Precios Base & Impuestos** | Cloud (SoR) | Local Edge (SoR) | Cloud (SoR) | Cloud (SoR) |
| **Branch Overrides (Precios Sucursal)** | Cloud (SoR) | Local Edge (SoR) | Cloud (SoR) | Cloud (SoR) |
| **Mesas & Salones** | Local Edge (Primary Write) | Local Edge (SoR) | N/A (Manejado por POS Ext.) | Local Edge (Primary Write) |
| **Cuentas & Comandas Activas** | Local Edge (Primary Write) | Local Edge (SoR) | N/A (Manejado por POS Ext.) | Local Edge (Primary Write) |
| **KDS (Estados de Preparación)** | Local Edge (Primary Write) | Local Edge (SoR) | N/A (Manejado por POS Ext.) | Local Edge (Primary Write) |
| **Turnos de Caja & Arqueos** | Local Edge (Primary Write) | Local Edge (SoR) | N/A (Manejado por POS Ext.) | Local Edge (Primary Write) |
| **Pagos & Transacciones Cobro** | Local Edge (Primary Write) | Local Edge (SoR) | POS Externo (SoR) | Local Edge (Primary Write) |
| **Cortes X y Z** | Local Edge (Primary Write) | Local Edge (SoR) | POS Externo (SoR) | Local Edge (Primary Write) |
| **Recetas & Fórmulas** | Cloud (Inventory SoR) | N/A | Cloud (Inventory SoR) | Cloud (Inventory SoR) |
| **Almacenes & Kárdex / Mermas** | Cloud (Inventory SoR) | N/A | Cloud (Inventory SoR) | ERP Externo (Master SoR) |
| **Órdenes de Compra (Procurement)**| Cloud (Procurement SoR)| N/A | Cloud (Procurement SoR)| ERP Externo (Master SoR) |
| **Cuentas por Pagar (CxP / AP)** | Cloud (Finance SoR) | N/A | Cloud (Finance SoR) | ERP Externo (Master SoR) |
| **Cuentas por Cobrar (CxC / AR)** | Cloud (Finance SoR) | N/A | Cloud (Finance SoR) | ERP Externo (Master SoR) |
| **Billing (Esquemas Fiscales / CFDI)**| Cloud (Billing SoR) | Local Edge (Emisor Local)| Cloud (Billing SoR) | Cloud / PAC Autorizado |

### Reglas de Arbitraje y Sincronización
1. **Piso y Caja:** El Edge Host local es siempre la autoridad de escritura primaria de transacciones activas (`Primary Write Authority`). Cloud actúa como réplica analítica y de consolidación financiera al recibir el evento sincronizado.
2. **Catálogo Corporativo:** Cloud es la autoridad de registro única (`System of Record - SoR`). El Edge Host almacena una réplica de lectura local que se actualiza mediante sincronización descendente atómica sin afectar precios congelados en cuentas abiertas.
3. **Integración con ERPs Externos:** Cuando un ERP externo (ej. SAP / Odoo) actúa como autoridad maestra de finanzas, `ERP RESTAURANTES` actúa como subsistema operativo y emite pólizas de interfaz contable hacia el ERP externo a través del `Integrations Hub`.

---

## 4. Arquitectura de Seguridad e Identidad Offline (REM-09)

1. **Autenticación Administrativa:** Realizada en Cloud mediante Supabase Auth con tokens JWT de corta duración y RBAC multi-rol.
2. **Autenticación Operativa en Borde (Edge Local IAM):**
   - El Edge Host mantiene un snapshot local de credenciales con hashes criptográficos salteados de PIN (Argon2 / PBKDF2).
   - Queda estrictamente prohibido el almacenamiento o transmisión de PINs en texto plano.
   - El snapshot incluye `snapshotVersion`, `credentialVersion`, `issuedAt` y `expiresAt` (ventana máxima de operación offline configurable, por defecto 72 horas).
3. **Auditoría Local:** Toda operación sensible ejecutada offline (cancelaciones, reaperturas, descuentos, aperturas de cajón) se firma y registra en la bitácora local inmutable para su posterior ingesta y auditoría en Cloud.

---

## 5. Delimitación Delivery vs. Integrations Hub (REM-12)

- **`Integrations Hub` (Cloud):** Administra de manera exclusiva las conexiones, credenciales OAuth, webhooks y normalización de pedidos de terceros (Uber Eats, Rappi, Didi Food, Deliverect, Ordatic).
- **`TRIDENTPOS` (Edge / Cloud):** Recibe el pedido normalizado como un comando canónico `IngestarPedidoExterno()` y lo inserta en el flujo de comandas y cocina del restaurante.
- **`Delivery` (Suite Module):** Posee y gestiona de manera exclusiva la logística de flota propia del restaurante: zonas de cobertura, tarifas de envío, asignación de repartidores propios, ruteo y liquidación de propinas/cobros contra choferes.

---

## 6. Declaración de Metas de Calidad (REM-06)

- **Objetivo de Disponibilidad en Sucursal:** `DESIGN OBJECTIVE: Continuidad operativa local en piso y caja ante caída de WAN.`
- **Objetivo de Latencia LAN:** `LATENCY TARGET: < 5 ms en red local cableada o WiFi 5GHz dedicada — REQUIRES HARDWARE BENCHMARK.`
- **Objetivo de Recuperación ante Desastres:** `RTO TARGET: < 30 min para aprovisionamiento de nuevo Edge Host — REQUIRES DR VALIDATION.`

---

DOCUMENT STATUS: READY FOR INDEPENDENT REVIEW
