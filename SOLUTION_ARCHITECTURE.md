# SOLUTION ARCHITECTURE — ERP RESTAURANTES

**Versión:** 1.1 (SOLUTION ARCHITECTURE NORMALIZED)  
**Fecha:** 2026-08-31  
**SSOT Baseline:** [`FUNCTIONAL_ARCHITECTURE.md`](file:///Volumes/SSD_ORICO/BRAIN/TRIDENTPOSREST/FUNCTIONAL_ARCHITECTURE.md) (v1.2 APPROVED) & [`MODULE_CATALOG.md`](file:///Volumes/SSD_ORICO/BRAIN/TRIDENTPOSREST/MODULE_CATALOG.md) (v1.2 APPROVED).  
**Rol:** `01_Solution Architect`

---

## 1. Estilo Arquitectónico: Monolito Modular con Bounded Contexts Fuertes

Para `ERP RESTAURANTES`, la arquitectura del backend en el Cloud Control Plane se diseña bajo el patrón **Modular Monolith (Monolito Modular)** con aislamiento estricto entre Bounded Contexts y comunicación dual: **In-Process Domain Events** para efectos intra-transaccionales y **Durable Integration Events** para efectos inter-módulo que no pueden perderse.

```mermaid
graph TB
    subgraph Modular_Monolith["Modular Monolith Architecture (Cloud Core Backend)"]
        direction TB
        subgraph Core_Package["Platform & Foundation"]
            PF["Platform Foundation (Tenant, Branch, RBAC, Station, Audit)"]
            MC["Master Catalog Service (Products, Categories, Menus, Modifiers, Overrides)"]
        end

        subgraph Ops_Package["Operations Contexts"]
            TP_CLOUD["TRIDENTPOS Cloud Bridge & Reconciler"]
            DEL["Delivery Module (Logística & Despacho)"]
        end

        subgraph Supply_Package["Supply Chain Contexts"]
            INV["Inventory Module (Recetas, Almacén, Kárdex)"]
            PROC["Procurement Module (Compras, Órdenes, Proveedores)"]
        end

        subgraph Finance_Package["Finance & Fiscal Contexts"]
            FIN["Finance Module (Tesorería, CxP, CxC, Gastos, Consumo Corte Z)"]
            BILL["Billing Module (Impuestos Compuestos, Emisión Fiscal)"]
        end

        subgraph Customer_Package["Customer Experience"]
            CRM["CRM Module (Clientes, Directorio)"]
            LOY["Loyalty Module (Monedero RestCard, Puntos)"]
        end

        subgraph Cross_Package["Cross-Cutting & Integration"]
            ANA["Analytics & Reporting Engine"]
            INT["Integrations Hub (Connectors, Mappings, Webhooks)"]
        end

        subgraph Event_Infrastructure["Infraestructura de Eventos"]
            InMemBus["In-Process Mediator (Efectos Inmediatos / Validaciones)"]
            CloudOutbox[("Durable Cloud Integration Outbox (Supabase Postgres)")]
        end
    end

    PF <--> InMemBus
    MC <--> InMemBus
    TP_CLOUD <--> InMemBus
    DEL <--> InMemBus
    INV <--> InMemBus
    PROC <--> InMemBus
    FIN <--> InMemBus
    BILL <--> InMemBus
    CRM <--> InMemBus
    LOY <--> InMemBus
    ANA <--> InMemBus
    INT <--> InMemBus

    TP_CLOUD --> CloudOutbox
    PROC --> CloudOutbox
    CloudOutbox -. "Despacho Asíncrono Confiable" .-> INV
    CloudOutbox -. "Despacho Asíncrono Confiable" .-> FIN
    CloudOutbox -. "Despacho Asíncrono Confiable" .-> BILL
```

### 1.1 Justificación del Monolito Modular y Manejo de Eventos Durables
1. **Aislamiento por Contratos Fuertes:** Cada módulo se encapsula en un paquete de código con su propia API pública (Comandos, Queries y Eventos). Queda **estrictamente prohibido el acceso a estructuras internas o almacenamiento privado de otro módulo sin pasar por su contrato público**.
2. **Diferenciación de Eventos:**
   - **In-Process Domain Events:** Eventos que se ejecutan dentro del mismo límite de transacción y ciclo de vida de la petición (ej. validación de reglas de negocio, sincronización en memoria).
   - **Durable Integration Events:** Eventos de negocio que representan transacciones inter-módulo críticas (ej. `CorteZGenerado`, `RecepcionCompraRegistrada`, `OrdenProduccionConfirmadaEnKDS`). Estos eventos **se persisten de forma durable en la tabla `CloudIntegrationOutbox` dentro de la transacción principal** para garantizar que no se pierdan ante caídas de proceso antes de ser consumidos por los módulos de Inventory, Finance o Billing.
3. **Sin Broker Externo Prematuro:** No se introduce Kafka ni RabbitMQ inicialmente; la tabla de Outbox en PostgreSQL gestionada por workers internos proporciona garantías transaccionales suficientes con menor costo y complejidad operativa.

---

## 2. Diagrama de Contenedores del Sistema (C4 Container Level)

```mermaid
C4Container
    title Diagrama de Contenedores — ERP RESTAURANTES

    Person(user_admin, "Admin / Gerente", "Accede a administración y analítica")
    Person(user_floor, "Personal de Piso / Caja / Cocina", "Opera salón, comandas, caja y KDS")

    Container_Boundary(c_cloud, "Cloud Control Plane (Vercel + Render + Supabase)") {
        Container(spa_admin, "Backoffice Web SPA", "Next.js / React (Vercel)", "Panel administrativo SaaS multi-tenant.")
        Container(portal_cust, "Portal Autofacturación [PROPOSED]", "Next.js (Vercel)", "Portal web para comensales.")
        Container(api_cloud, "Core API Modular Monolith", "Node.js / TypeScript (Render)", "Servicios de negocio, catálogos, finanzas, inventarios y contratos.")
        Container(sync_cloud, "Cloud Sync Gateway", "Node.js / WebSockets (Render)", "Ingesta bidireccional asíncrona de eventos de sucursales.")
        ContainerDb(db_cloud, "Cloud Database & Storage", "PostgreSQL (Supabase)", "Almacén central multi-tenant, auditoría y catálogos maestros.")
    }

    Container_Boundary(c_branch, "Branch Operational Plane (TRIDENTPOS Edge)") {
        Container(pos_host, "TRIDENTPOS Local Host Node", "Node.js / Local Host Runtime", "Servidor local de sucursal: despacha API y WebSockets LAN.")
        Container(ui_pos, "POS Floor & Cash UI", "Web / Desktop Client", "Interfaz táctil de toma de pedidos, comanda y caja.")
        Container(ui_kds, "KDS Kitchen Screen UI", "Web / Touch Client", "Monitor táctil de cocina con cronómetro y confirmación de preparación.")
        Container(ui_mobile, "Comandero Móvil UI", "PWA / Responsive Client", "Captura móvil para tablets de meseros.")
        ContainerDb(db_local, "Local Embedded Database", "SQLite 3 (WAL Mode)", "Persistencia transaccional local y cola Outbox de eventos.")
        Container(hw_bridge, "Hardware Gateway", "Local Service (Node/Native)", "Control de impresoras ESC/POS, cajón de dinero, báscula y PinPAD.")
    }

    Container_Boundary(c_int, "External Integration Plane") {
        Container(int_engine, "Integration Adapters Hub", "Node.js Worker (Render)", "Conectores de PAC Fiscal, Delivery Hub, PMS y ERPs.")
    }

    Rel(user_admin, spa_admin, "Usa interfaz administrativa", "HTTPS")
    Rel(spa_admin, api_cloud, "Consume API REST / GraphQL", "HTTPS / JSON")
    Rel(api_cloud, db_cloud, "Lee y escribe datos centrales", "SQL / Pooler")

    Rel(user_floor, ui_pos, "Opera caja y salón", "Táctil")
    Rel(user_floor, ui_kds, "Confirma preparación", "Táctil")
    Rel(user_floor, ui_mobile, "Comanda en mesa", "WiFi LAN")

    Rel(ui_pos, pos_host, "Llama operaciones de piso", "HTTP / WebSocket (LAN)")
    Rel(ui_kds, pos_host, "Recibe comandas y envía surtido", "WebSocket (LAN)")
    Rel(ui_mobile, pos_host, "Envía comandas de mesa", "WebSocket (LAN)")

    Rel(pos_host, db_local, "Persiste transacciones y eventos Outbox", "SQL Local")
    Rel(pos_host, hw_bridge, "Envía tickets y corte de cajón", "Local IPC / TCP")

    Rel(pos_host, sync_cloud, "Sincroniza eventos de venta y recibe catálogo", "WSS / HTTPS (Asíncrono)")
    Rel(sync_cloud, api_cloud, "Despacha eventos de sucursal al outbox cloud", "In-Memory / Durable Outbox")

    Rel(api_cloud, int_engine, "Despacha tareas de integración", "Internal RPC")
    Rel(int_engine, db_cloud, "Registra bitácoras y mapeos", "SQL")
```

---

## 3. Descomposición Interna: Platform Foundation vs. Master Catalog

Funcionalmente, ambos componentes pertenecen a `Platform Core` como Bounded Context unificado. Arquitectónicamente, se implementan en dos submódulos internos con interfaces desacopladas:

```mermaid
graph LR
    subgraph Platform_Core_Package["Platform Core (Bounded Context)"]
        subgraph Sub_Foundation["Submódulo A: Platform Foundation"]
            A1["Tenant & Organization Manager"]
            A2["Branch Registry"]
            A3["Identity, RBAC & PIN Authenticator"]
            A4["Station & Device Identity Manager"]
            A5["Central Audit Trail Engine"]
        end

        subgraph Sub_Catalog["Submódulo B: Master Catalog & Overrides"]
            B1["Master Product & Category Registry"]
            B2["Modifier & ModifierGroup Registry"]
            B3["Base Price Engine"]
            B4["Branch Overrides Engine (Price, Visibility, Tax)"]
            B5["Menu & Schedule Resolver"]
        end

        Sub_Foundation -. "Valida Permiso y Sucursal" .-> Sub_Catalog
    end

    Sub_Catalog ==> "Expone Catálogo Resuelto" ==> Other_Modules["TRIDENTPOS / Inventory / Billing"]
```

---

## 4. Control de Concurrencia en Red Local (Optimistic Concurrency Control)

Para evitar la sobreescritura silenciosa de datos cuando múltiples operadores o comanderos interactúan sobre una misma mesa o cuenta, el sistema implementa **Control de Concurrencia Optimista (OCC)** basado en versionado de agregados:

```mermaid
sequenceDiagram
    autonumber
    participant Waiter1 as Comandero Mesero A
    participant Waiter2 as Comandero Mesero B
    participant Edge as TRIDENTPOS Edge Server
    participant DB as Local Database (SQLite)

    Note over Waiter1,Waiter2: Ambos meseros abren Mesa 5 al mismo tiempo
    Waiter1->>Edge: GET /cuentas/mesa_5 -> Retorna Cuenta (version: 12, items: [...])
    Waiter2->>Edge: GET /cuentas/mesa_5 -> Retorna Cuenta (version: 12, items: [...])

    Waiter1->>Edge: Command: AgregarItems(cuentaId, newItems, expectedVersion: 12)
    Edge->>DB: UPDATE Cuenta SET version = 13, items = [...] WHERE id = 'c_5' AND version = 12
    DB-->>Edge: 1 fila actualizada (Éxito)
    Edge-->>Waiter1: 200 OK (Comanda enviada, version: 13)
    Edge-->>Waiter2: WebSocket Broadcast: CuentaActualizada(mesa_5, version: 13)

    Note over Waiter2: Mesero B intenta agregar bebida usando la versión obsoleta 12
    Waiter2->>Edge: Command: AgregarItems(cuentaId, drinkItems, expectedVersion: 12)
    Edge->>DB: UPDATE Cuenta WHERE id = 'c_5' AND version = 12
    DB-->>Edge: 0 filas actualizadas (Conflicto detectado)
    Edge-->>Waiter2: 409 Conflict (ConcurrencyConflictError: Versión actual es 13)
    Note over Waiter2: La interfaz refresca la cuenta y fusiona el intento de captura
```

- **Mecanismo:** Toda mutación sobre `Cuenta`, `Mesa` o `TurnoCaja` incluye el campo `expectedVersion`.
- **Detección de Conflicto:** Si la versión en base de datos difiere de la esperada, la operación se rechaza atómicamente con error `409 Conflict`, obligando al cliente móvil a recargar el estado actual y reintentar de forma informada sin pérdida accidental de comandas.

---

## 5. Ejecución en TRIDENTPOS (Branch Operational Plane)

El nodo local de sucursal expone servicios de baja latencia para toda la red local:

```mermaid
graph TD
    subgraph LAN_Network["Red Local de Sucursal (LAN / WiFi)"]
        subgraph Edge_Server["TRIDENTPOS Edge Server (Host Local)"]
            LOCAL_API["Local REST & WebSocket Gateway"]
            LOCAL_CORE["TRIDENTPOS Core Engine (Mesas, Cuentas, KDS, Caja)"]
            LOCAL_DB[("Local SQLite WAL Store")]
            OUTBOX_Q[("Transactional Outbox Queue")]
            LOCAL_SYNC["Local Sync Agent"]
            LOCAL_HW["Hardware Service (ESC/POS Driver)"]
        end

        POS_TERM["Terminal Caja / Piso (Táctil)"]
        KDS_TERM["Monitor Cocina KDS (Táctil)"]
        MOB_TERM["Comandero Móvil (Tablet Mesero)"]
        PRINTER_TICKETS["Impresora Tickets Caja (Ethernet/USB)"]
        PRINTER_KITCHEN["Impresora Cocina (Ethernet)"]

        POS_TERM <== "WebSocket / HTTP" ==> LOCAL_API
        KDS_TERM <== "WebSocket" ==> LOCAL_API
        MOB_TERM <== "WiFi / WebSocket" ==> LOCAL_API

        LOCAL_API --> LOCAL_CORE
        LOCAL_CORE --> LOCAL_DB
        LOCAL_CORE --> OUTBOX_Q
        LOCAL_CORE --> LOCAL_HW
        LOCAL_HW --> PRINTER_TICKETS
        LOCAL_HW --> PRINTER_KITCHEN
    end

    OUTBOX_Q --> LOCAL_SYNC
    LOCAL_SYNC <== "HTTPS / WSS (Sincronización Asíncrona)" ==> CLOUD_SYNC["Cloud Sync Gateway"]
```

---

SOLUTION ARCHITECTURE V1.1: READY FOR FINAL APPROVAL
