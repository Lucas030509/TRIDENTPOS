# ADR-013: Topología de Paquetes por Bounded Context y Modelo de Composición en Capas

**Status:** `PROPOSED ARCHITECTURE CHANGE — PENDING GOVERNANCE APPROVAL`  
**Date:** 2026-09-13  
**Owners:** `01_Solution_Architect`  
**Related Documents:** `SOLUTION_ARCHITECTURE.md`, `MODULE_CATALOG.md`, `IMPLEMENTATION_PLAN.md`, `ADR-001`, `ADR-002`, `ACR-2026-013`  
**Classification:** `STRUCTURAL ARCHITECTURE DECISION`  

---

## 1. Context

TRIDENTPOS se rige bajo el principio arquitectónico fundamental:
$$\mathbf{MODULAR\ BY\ DESIGN\ —\ INTEGRATED\ BY\ CONTRACT}$$

Formalizado en `ADR-001` (Modular Monolith por Bounded Contexts) y `ADR-002` (Autoridad de Datos Cloud/Branch por Topología), el sistema define 11 Bounded Contexts de negocio:
1. **Platform Core** (Kernel, Tenancy, IAM, Auditoría)
2. **TRIDENTPOS** (Salones, Mesas, Cuentas, Comandas de Piso, KDS LAN, Turnos de Caja, Arqueos, Cobro POS, Cortes X/Z)
3. **Inventory** (Catálogo de Insumos, Multialmacén, Recetas, Subrecetas, Kárdex)
4. **Procurement** (Proveedores, Órdenes de Compra, Recepciones Físicas)
5. **Finance** (Tesorería Central, Cuentas por Pagar/Cobrar, Gastos, Conciliación Bancaria, Interfaz Contable)
6. **Billing** (Facturación Fiscal Digital CFDI, Timbrado, Leases de Folios)
7. **CRM** (Clientes, Cuentas Corrientes, Historial de Consumo)
8. **Delivery** (Repartidores, Logística Propia, Agregadores Externos)
9. **Loyalty** (Monedero Electrónico RestCard, Puntos, Fidelización)
10. **Analytics** (BI, Reportes Gerenciales, Rentabilidad de Menú)
11. **Integrations** (Conectores de Terceros, Dispositivos de Hardware POS)

Durante el inicio de `WP-014: Dining Room, Tables & Orders Domain Engine with OCC`, el Pre-Flight detectó un bloqueador estructural (`WP-014 PRE-FLIGHT PACKAGE COMPOSITION BLOCKER`):
- La política actual de grafo (`scripts/check-graph.mjs`) solo reconoce 6 paquetes en el monorepo (`@trident/core`, `@trident/database`, `@trident/pos`, `@trident/sync`, `@trident/ui`, `@trident/edge`) y permite como única dependencia interna en tiempo de ejecución `@trident/core`:
  `ALLOWED_INTERNAL_DEPENDENCIES: { '@trident/pos': ['@trident/core'], '@trident/edge': ['@trident/core'], ... }`
- Por tanto, `@trident/pos` no puede importar `@trident/edge`, ni `@trident/edge` puede importar `@trident/pos`.
- Sin embargo, `WP-014` requiere:
  1. Lógica y reglas de dominio del contexto TRIDENTPOS (agregados `Mesa`, `Cuenta`, `Partida`, OCC).
  2. Persistencia embebida ACID en SQLite WAL vía `EdgeDatabaseService` (propiedad de `@trident/edge`).
  3. Encolamiento atómico de eventos en `outbox_queue` vía `EdgeOutboxPersistence` (propiedad de `@trident/edge`).
  4. Endpoints HTTP REST locales (Fastify) y pruebas de concurrencia e integración sobre bases de datos SQLite reales.

Si se colocara la persistencia y endpoints dentro de `@trident/edge`, se violaría el aislamiento del Bounded Context TRIDENTPOS, transformando a `@trident/edge` (que es infraestructura de host / runtime Electron) en dueño de lógica de negocio restaurantera. Si se forzara a `@trident/pos` a depender de `@trident/edge`, se acoplaría el dominio puro a la infraestructura y se rompería la política de grafos.

Asimismo, los paquetes de trabajo futuros como `WP-017` (Inventory) carecen de un paquete definido en el monorepo y enfrentarían exactamente el mismo bloqueo al intentar persistir en PostgreSQL (`@trident/database`).

---

## 2. Problem

Se requiere formalizar la topología canónica de paquetes del monorepo y el modelo de ensamblado/composición para resolver simultáneamente:
1. **Composición de `WP-014`:** Permitir que el motor de dominio TRIDENTPOS se ensamble con el motor SQLite y Outbox de Edge sin acoplamientos prohibidos entre dominio e infraestructura.
2. **Topología para `WP-017` y posteriores:** Definir cómo los 11 Bounded Contexts se ubican en paquetes del monorepo, cómo interactúan y cómo se conectan a bases de datos e interfaces de transporte.
3. **Preservación Inviolable de Límites:** Impedir que los módulos de negocio se importen entre sí, asegurando que TRIDENTPOS pueda operar sin Inventory, Inventory sin TRIDENTPOS, y Procurement sin importar Inventory.
4. **Actualización Normativa del Graph Checker:** Definir las reglas exactas que `scripts/check-graph.mjs` debe validar para admitir raíces de composición sin abrir vulnerabilidades de acoplamiento indiscriminado.

---

## 3. Options Considered

### Option A: Monorepo Monolítico Plano (Permitir `@trident/pos -> @trident/edge` y `@trident/* -> @trident/database`)
- *Pros:* Simplicidad inmediata en configuración de manifests.
- *Cons:* Destruye el principio de arquitectura hexagonal; acopla el dominio de negocio a infraestructura tecnológica específica (driver SQLite o pg); crea dependencias transitivas descontroladas; imposibilita la reutilización de dominios en otros entornos (ej. móvil o cloud serverless).
- *Verdict:* Rechazada categóricamente.

### Option B: Absorción en Infraestructura (Colocar toda la lógica de negocio en `@trident/edge` y `@trident/database`)
- *Pros:* No requiere paquetes nuevos.
- *Cons:* Destruye la cohesión modular; convierte a `@trident/edge` en un monolito inmanejable que mezcla Electron, IPC, Bonjour, SQLite, IAM, mesas, cuentas y facturación; viola frontalmente `ADR-001`.
- *Verdict:* Rechazada categóricamente.

### Option C: Arquitectura Hexagonal / Puertos y Adaptadores con Raíces de Composición Separadas — *Seleccionada*
- *Pros:*
  1. **Separación Estricta por Capas:**
     - **Kernel:** `@trident/core` (contratos, interfaces, eventos, Value Objects como `Money`).
     - **Dominio de Negocio:** Paquetes de dominio puros por cada Bounded Context (`@trident/pos`, `@trident/inventory`, etc.) que dependen **única y exclusivamente de `@trident/core`**.
     - **Adaptadores de Infraestructura Técnica:** Módulos de persistencia, red y runtime (`@trident/database`, `@trident/edge`, `@trident/sync`, `@trident/ui`) que dependen de `@trident/core`.
     - **Raíces de Composición (Composition Roots):** Aplicaciones ejecutables/ensambladores (`@trident/pos-edge-runtime`, `@trident/cloud-server`) que importan dominio e infraestructura y realizan la inyección de dependencias y arranque de servidores (Fastify, Electron).
  2. **Independencia Total de Bounded Contexts:** Los dominios de negocio jamás se importan entre sí (`@trident/pos` $\not\leftrightarrow$ `@trident/inventory`).
  3. **Alineación con Estándares de la Industria:** Patrón universal en arquitecturas limpias y Domain-Driven Design (DDD).
- *Verdict:* **Seleccionada como estándar arquitectónico oficial.**

---

## 4. Decision

### 4.1 Taxonomía de Capas del Monorepo
El monorepo clasifica todos sus paquetes de trabajo en cuatro categorías formales:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    CAPA 4: COMPOSITION ROOTS                            │
│  @trident/pos-edge-runtime (Edge LAN Host) | @trident/cloud-server      │
└───────────────────┬─────────────────────────────────┬───────────────────┘
                    │                                 │
                    ▼                                 ▼
┌─────────────────────────────────────┐   ┌───────────────────────────────┐
│     CAPA 2: BUSINESS DOMAINS        │   │    CAPA 3: INFRASTRUCTURE     │
│ @trident/pos                        │   │ @trident/database (PostgreSQL)│
│ @trident/inventory                  │   │ @trident/edge (SQLite/Host)   │
│ @trident/procurement                │   │ @trident/sync (WebSockets)    │
│ @trident/finance                    │   │ @trident/ui (Componentes)     │
│ ... (10 Bounded Contexts de negocio)│   │                               │
└───────────────────┬─────────────────┘   └───────────────┬───────────────┘
                    │                                     │
                    └─────────────────┬───────────────────┘
                                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     CAPA 1: PLATFORM KERNEL                             │
│                         @trident/core                                   │
└─────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Matriz de Responsabilidad y Dependencias de Paquetes
| Paquete | Capa | Bounded Context | ¿Contiene Lógica de Dominio? | Dependencias Runtime Permitidas | Dependencias Test Permitidas | Responsabilidad |
|---|---|---|---|---|---|---|
| `@trident/core` | 1 (Kernel) | Platform Core | **SÍ** (Dominio Platform Core + Kernel) | `[]` (Ninguna) | `[]` | Representa tanto el Bounded Context Platform Core como la superficie pública de kernel compartido. Posee lógica de dominio propia para: Organización, Sucursal, Identidad de Estación, Usuarios/RBAC, Module Entitlements, Catálogo Maestro de Productos, Modificadores, Overrides de Sucursal, y primitivas de Auditoría y Criptografía. Expone contratos de capability públicos para consumo de los restantes Bounded Contexts. |
| `@trident/pos` | 2 (Dominio) | TRIDENTPOS | **SÍ** | `['@trident/core']` | `['@trident/core']` | Lógica pura de restaurante y operaciones de piso: Salones, Mesas, Cuentas, Partidas (`cuenta_items`), Modificadores, Comandas de Piso, KDS LAN, Turnos de Caja (`turnos_caja`), Movimientos de Efectivo, Cobro POS (`pagos`), Arqueos de Turno, Cortes X y Cortes Z. Motor OCC con snapshot conflictivo. Puertos de repositorio y contratos de políticas (`CancellationPolicy`, `BillSplitProrationStrategy`). |
| `@trident/inventory` | 2 (Dominio) | Inventory | **SÍ** | `['@trident/core']` | `['@trident/core']` | Lógica pura de inventario: catálogo de insumos, multialmacén, motor de explosión de recetas/subrecetas, cálculo de costo promedio ponderado. Puertos de repositorio e interfaz `ModifierRecipeResolver`. |
| `@trident/procurement`| 2 (Dominio) | Procurement | **SÍ** | `['@trident/core']` | `['@trident/core']` | Proveedores, órdenes de compra, recepciones de almacén. |
| `@trident/finance` | 2 (Dominio) | Finance | **SÍ** | `['@trident/core']` | `['@trident/core']` | Finanzas corporativas y contabilidad central: Cuentas por Pagar (CxP), Cuentas por Cobrar (CxC / Crédito a Clientes), Gastos Operativos, Liquidación de Propinas, Comisiones de Agentes, Conciliación Bancaria e Interfaz con Libros Diarios Contables. (Los turnos de caja operativos, arqueos de piso y cobros POS pertenecen exclusivamente a TRIDENTPOS). |
| `@trident/billing` | 2 (Dominio) | Billing | **SÍ** | `['@trident/core']` | `['@trident/core']` | Facturación fiscal electrónica, folios digitales, leases. |
| `@trident/crm` | 2 (Dominio) | CRM | **SÍ** | `['@trident/core']` | `['@trident/core']` | Clientes, límites de crédito, cuentas corporativas. |
| `@trident/delivery` | 2 (Dominio) | Delivery | **SÍ** | `['@trident/core']` | `['@trident/core']` | Despacho de pedidos, asignación de rutas y repartidores. |
| `@trident/loyalty` | 2 (Dominio) | Loyalty | **SÍ** | `['@trident/core']` | `['@trident/core']` | Monederos electrónicos RestCard, cálculo de puntos y recompensas. |
| `@trident/analytics`| 2 (Dominio) | Analytics | **SÍ** | `['@trident/core']` | `['@trident/core']` | Algoritmos de análisis de ventas, costos y KPI gerenciales. |
| `@trident/integrations`| 2 (Dominio)| Integrations | **SÍ** | `['@trident/core']` | `['@trident/core']` | Lógica de adaptación para hardware de restaurante y APIs externas. |
| `@trident/database` | 3 (Infra) | Platform Core / Cloud | NO | `['@trident/core']` | `['@trident/core']` | Conexión Supabase PostgreSQL 16, migraciones Cloud, aislamiento RLS, repositorios base de infraestructura. |
| `@trident/edge` | 3 (Infra) | Platform Core / Edge | NO | `['@trident/core']` | `['@trident/core']` | Runtime Electron, seguridad IPC, SQLite WAL (`EdgeDatabaseService`), outbox de borde (`EdgeOutboxPersistence`), Bonjour mDNS, criptografía local. |
| `@trident/sync` | 3 (Infra) | Platform Core / Sync | NO | `['@trident/core']` | `['@trident/core', '@trident/edge']` | Protocolo de sincronización bidireccional y WebSocket Gateway. |
| `@trident/ui` | 3 (Infra) | Platform Core / UI | NO | `['@trident/core']` | `['@trident/core']` | Sistema de componentes visuales compartidos. |
| `@trident/pos-edge-runtime` | 4 (Composición) | TRIDENTPOS (Assembly) | **NO** | `['@trident/core', '@trident/pos', '@trident/edge']` | `['@trident/core', '@trident/pos', '@trident/edge']` | **Raíz de Composición Edge POS:** Servidor Fastify local LAN, mapeo de rutas REST (`/cuentas`, `/ordenes/partidas`, `/cuentas/:id/cerrar`), inyección de `EdgeDatabaseService` y `EdgeOutboxPersistence` en repositorios de `@trident/pos`, suite de pruebas de integración e OCC sobre SQLite real. |
| `@trident/cloud-server` | 4 (Composición) | Platform Core (Assembly) | **NO** | `['@trident/core', '@trident/database', ...dominios cloud permitidos]` | Coincidente con runtime | **Raíz de Composición Cloud:** Servidor API Gateway en la nube, inyección de `@trident/database` en dominios empresariales, autenticación centralizada. |

### 4.3 Invariantes de Aislamiento
1. **Invariante de Dominio Puro:** Los paquetes de dominio (`@trident/pos`, `@trident/inventory`, etc.) jamás importan infraestructura (`@trident/database`, `@trident/edge`). Definen contratos de repositorio (*Ports*) que son implementados o provistos por la infraestructura y ensamblados por la raíz de composición.
2. **Invariante de Cero Acoplamiento Cruzado de Dominios:** Un paquete de dominio jamás importa otro paquete de dominio en tiempo de ejecución. La comunicación entre dominios ocurre únicamente mediante contratos de capability en `@trident/core` o eventos de integración asíncronos.
3. **Invariante de Raíz de Composición Aséptica:** Las raíces de composición (`@trident/pos-edge-runtime`, `@trident/cloud-server`) no poseen lógica de negocio propia; su única función es el ciclo de vida del proceso, enrutamiento de transporte (Fastify DTO $\leftrightarrow$ Domain Command) e inyección de dependencias.

---

## 5. Walkthrough de Aplicación: WP-014 y WP-017

### 5.1 Composición Canónica de WP-014 (TRIDENTPOS Floor Engine)
1. **Lógica de Dominio (`@trident/pos`):**
   - Define entidades y agregados: `Mesa`, `Cuenta`, `CuentaItem`, `CuentaItemModificador`, `TurnoCaja`.
   - Implementa motor OCC: `expectedVersion`, compare-and-swap y generación de `OCCConflictError` con snapshot actual.
   - Define interfaces de política: `CancellationPolicy` y `BillSplitProrationStrategy` (ambas neutrales y sin valores por defecto, preservando `OQ-SSOT-01` y `OQ-SSOT-06`).
   - Define el puerto de persistencia: `DiningRoomRepositoryPort`, `AccountRepositoryPort`.
   - **Dependencias:** Exclusivamente `@trident/core`.
2. **Persistencia e Infraestructura de Borde (`@trident/edge`):**
   - Provee `EdgeDatabaseService` (SQLite WAL) y `EdgeOutboxPersistence` (`executeWithOutbox`).
   - **Dependencias:** Exclusivamente `@trident/core`.
3. **Ensamblado y Rutas REST (`@trident/pos-edge-runtime`):**
   - Implementa el adaptador de repositorio `SqliteDiningRoomRepository` que implementa `DiningRoomRepositoryPort` utilizando la conexión de `EdgeDatabaseService`.
   - Inicia el demonio local Fastify en puerto LAN.
   - Registra endpoints canónicos: `POST /cuentas`, `POST /ordenes/partidas`, `PUT /cuentas/:id/cerrar`.
   - Ejecuta las transacciones atómicas de dominio y outbox en SQLite WAL:
     ```ts
     edgeOutboxPersistence.executeWithOutbox(() => {
       accountRepository.save(account);
     }, [outboxEvent]);
     ```
   - Contiene la suite de pruebas automatizadas contra SQLite real: `WP014-T01` a `WP014-T14` (carrera de concurrencia OCC, atomicidad outbox, modo offline y benchmark de latencia).

### 5.2 Composición Canónica de WP-017 (Inventory Catalog & Recipes)
1. **Lógica de Dominio (`@trident/inventory`):**
   - Define conceptos y agregados de dominio: Almacén (Warehouse), Insumo (Ingredient), Unidad de Medida (Unit of Measure), Receta (Recipe), Partida de Receta (Recipe Item) y Subreceta.
   - Implementa algoritmo recursivo de explosión de recetas con factor de merma y cálculo de costo promedio ponderado.
   - Define interfaz `ModifierRecipeResolver` (neutral, preservando `OQ-SSOT-07`).
   - **Dependencias:** Exclusivamente `@trident/core`.
2. **Infraestructura Cloud (`@trident/database`):**
   - Contiene migraciones PostgreSQL 16 para las tablas físicas canónicas: `warehouses`, `ingredients`, `recipes` y `recipe_items` (con candidate keys `(organization_id, id)` y aislamiento RLS estricto). Queda prohibida la introducción de tablas duplicadas en español (`insumos`, `almacenes`, `recetas`, `subrecetas`).
3. **Ensamblado Cloud (`@trident/cloud-server`):**
   - Inyecta conexión PostgreSQL de `@trident/database` en el servicio de `@trident/inventory`.
   - Expone APIs administrativas de recetas a la consola Backoffice.
   - **Cero dependencia hacia `@trident/pos`:** Inventario opera de forma autónoma. La futura integración con KDS (`WP-018`) se realizará consumiendo el evento durable canónico `OrdenProduccionConfirmadaEnKDS`.

---

## 6. Especificación de Reglas para `scripts/check-graph.mjs` (Para `18_DevOps_Engineer`)

La futura remediación de DevOps actualizará `scripts/check-graph.mjs` bajo las siguientes reglas formales de clasificación:

```js
// Clasificación de Paquetes
const KERNEL_PACKAGES = ['@trident/core'];

const DOMAIN_PACKAGES = [
  '@trident/pos',
  '@trident/inventory',
  '@trident/procurement',
  '@trident/finance',
  '@trident/billing',
  '@trident/crm',
  '@trident/delivery',
  '@trident/loyalty',
  '@trident/analytics',
  '@trident/integrations',
];

const INFRASTRUCTURE_PACKAGES = [
  '@trident/database',
  '@trident/edge',
  '@trident/sync',
  '@trident/ui',
];

const COMPOSITION_PACKAGES = [
  '@trident/pos-edge-runtime',
  '@trident/cloud-server',
];
```

### Reglas de Adyacencia Permitida:
1. **Paquetes Kernel:** No pueden depender de ningún paquete interno (`[]`).
2. **Paquetes de Dominio:** Solo pueden depender de `KERNEL_PACKAGES`.
   Cualquier import hacia otro dominio o hacia infraestructura resulta en `ARCHITECTURAL_BOUNDARY_VIOLATION`.
3. **Paquetes de Infraestructura:** Solo pueden depender de `KERNEL_PACKAGES` (con la excepción de pruebas de integración de `@trident/sync` hacia `@trident/edge`).
4. **Paquetes de Composición:**
   - `@trident/pos-edge-runtime` $\to$ `['@trident/core', '@trident/pos', '@trident/edge']`.
   - `@trident/cloud-server` $\to$ `['@trident/core', '@trident/database', ...DOMAIN_PACKAGES]`.
5. **Fail-Closed:** Cualquier paquete interno no registrado en estas listas debe fallar inmediatamente la validación.

---

## 7. Consequences

### Positive
- Resuelve definitivamente el dilema de composición de `WP-014` sin violar el aislamiento de dominios ni crear dependencias circulares.
- Desbloquea de forma anticipada y limpia a `WP-017` (Inventory) y a los 9 Bounded Contexts restantes.
- Cumple rigurosamente con los patrones de Arquitectura Hexagonal y Domain-Driven Design (DDD).
- Los dominios de negocio se mantienen 100% testeables en memoria y libres de ataduras a tecnologías de almacenamiento específicas.

### Negative / Trade-offs
- Requiere la creación formal de paquetes de composición raíz (`packages/pos-edge-runtime`, etc.) antes o durante la ejecución de los respectivos Work Packages.
- Incrementa la disciplina de diseño al requerir interfaces de repositorio y Value Objects en lugar de accesos directos a drivers.

---

## 8. Rollback and Migration Considerations
- Esta decisión arquitectónica es puramente estructural y aditiva.
- No destruye ningún código preexistente en `main@M13`.
- Preserva la totalidad de las decisiones de producto protegidas (`OQ-SSOT-01` a `OQ-ARCH-02`) en estado `PENDING PO DECISION`.
