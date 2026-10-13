# TRIDENTPOS Builder Evidence: WP-026C KDS Station UI

## 1. Executive Summary
- **Work Package:** WP-026C — KDS Station UI (`/kds/:estacionId`)
- **Framework Profile:** EAAF v1.3.0 (ACR-2026-021 / Lean Profile)
- **Target Route:** `/kds/:estacionId` (Kitchen Display System Táctil & Bump Bar, pantallas 15"-24")
- **Architecture Baseline:** `FRONTEND_ARCHITECTURE.md` (Approved in PR #64), `IMPLEMENTATION_PLAN.md` Sec. 1110–1133, `ADR-005` (WebSocket LAN pub/sub & Full-State Resync), `ADR-012` (Fixed point scale-4 & zero floats), `FUNCTIONAL_ARCHITECTURE.md` Sec. 6.1 (Contrato TRIDENTPOS <-> KDS), `VISUAL_SYSTEM.md` (Dark theme by default, WCAG 2.2 AA).
- **Security & Network Boundary:** Renderer enforces strict isolation (`connect-src 'none'`), consuming events strictly through typed IPC bridge (`window.trident.kds` and `window.trident.events`), zero business rule ownership defined in UI (pure state projection).

---

## 2. Components Implemented (`@trident/pos-renderer/src/features/kds/`)

### 2.1 KdsHeader (`KdsHeader.tsx`)
- Selector táctil de estaciones de cocina (`Cocina Caliente`, `Cocina Fría & Ensaladas`, `Parrilla & Cortes`, `Bar & Bebidas`) con targets táctiles ≥ 44px.
- Reloj digital en tiempo real sincronizado (`HH:MM:SS`) con fuente monoespaciada tabular.
- Contadores operacionales en tiempo real:
  - Total de tickets en cola.
  - Tickets en estado `PENDIENTE`.
  - Tickets en estado `EN_PREPARACION`.
  - Alerta dinámica de tickets `ATRASADOS` (rojo de alto contraste con icono de advertencia y soporte para `prefers-reduced-motion`).
- Semáforo de conectividad LAN con el Edge Host (`LAN OK` / `Reconectando`).
- Indicador de estado de impresora de comandas (`Impresora OK` / `Impresora Alerta`).
- Botón táctil de **Recall** con badge dinámico de pedidos despachados recientes y atajo `[R]`.
- Botón de ayuda para atajos de teclado industrial y Bump Bar (`?`).

### 2.2 KdsTicketCard (`KdsTicketCard.tsx`)
- Tarjeta de comanda estructurada de 340px de ancho con contenedor semántico `article`:
  - Folio de comanda destacado (`#101`, `#102`, etc.).
  - Píldora de atajo numérico para Bump Bar (`[1]` a `[8]`).
  - Identificador de mesa o canal (`Mesa 4`, `Terraza - M2`, `Para Llevar / Rappi`).
  - Nombre del mesero o repartidor en turno.
  - Badge de nivel de urgencia (`NORMAL`, `ALTA`, `URGENTE`).
- Temporizador reactivo de SLA (`Timer` de `@trident/ui`):
  - Tiempo transcurrido en tiempo real desde `createdAt`.
  - Semáforo visual y textual tri-estado:
    - `EN_TIEMPO`: Menor al 75% del SLA (verde con icono de reloj).
    - `POR_VENCER`: Entre 75% y 100% del SLA (ámbar con icono de advertencia).
    - `ATRASADO`: Mayor al 100% del SLA (rojo parpadeante de alta visibilidad).
  - Tiempo objetivo (SLA) visible en minutos.
- Lista interactiva de partidas (`partidas`):
  - Píldora táctil de cantidad destacada (ej. `2x`, `1x`).
  - Nombre del platillo o bebida.
  - Modificadores agrupados en tags de alto contraste (ej. `Término Medio`, `Sin Cebolla`, `Extra Queso`).
  - Notas de comensal / alergias destacadas en recuadro ámbar con icono de aviso.
  - Táctil / clickable por partida: el cocinero puede marcar partidas individuales como listas (`LISTO` con tachado y check verde).
- Botones de acción ergonómicos:
  - Si el ticket está `PENDIENTE`: Botón **"Iniciar Preparación"** (tamaño `lg` = 56px de alto).
  - Si el ticket está `EN_PREPARACION`: Botón gigante **"DESPACHAR (BUMP)"** (tamaño `xl` = 72px de alto) con target táctil extra grande, indicador de tecla numérica y feedback táctil inmediato.

### 2.3 KdsRecallDrawer (`KdsRecallDrawer.tsx`)
- Panel lateral deslizable basado en la primitiva `Drawer` de `@trident/ui` (ancho 420px).
- Historial de comandas despachadas en los últimos 15 a 120 minutos (ventana configurable de Recall per `FUNCTIONAL_ARCHITECTURE.md` Sec. 6.1).
- Muestra folio, mesa, hora de finalización, tiempo total de preparación registrado (`X min prep`) y resumen de platillos.
- Botón táctil **"Reabrir en Cocina (Deshacer Bump)"**:
  - Restaura de forma idempotente (`clientOpId`) el ticket despachado a la cola activa en estado `EN_PREPARACION`.
  - Dispara evento de dominio `KdsTicketActualizado` con acción `REOPEN`.

### 2.4 KdsShortcutHelpDialog (`KdsShortcutHelpDialog.tsx`)
- Modal accesible basado en `Dialog` de `@trident/ui`.
- Detalla los atajos mapeados para Bump Bars USB estándar (Logic Controls, Bematech) y teclados industriales:
  - `1` a `8`: Despachar / Iniciar ticket visible correspondiente.
  - `Espacio` / `Enter`: Despachar el ticket más urgente / antiguo en cola.
  - `R` / `r`: Abrir / Cerrar Recall de tickets despachados.
  - `?`: Abrir diálogo de atajos.
  - `Escape`: Cerrar cualquier panel o modal.

### 2.5 KdsBoard (`KdsBoard.tsx`)
- Orquestador del tablero de cocina en tiempo real:
  - Suscripción reactiva a `window.trident.events` (`ComandaEnviadaACocina`, `OrdenProduccionIniciadaEnKDS`, `OrdenProduccionConfirmadaEnKDS`, `KDS_RESYNC`, `connectivity.restored`).
  - Filtros rápidos por estado: "Todos", "Pendientes", "En Preparación", "Atrasados" con conteos actualizados.
  - Banner de atención visual y auditiva cuando ingresa una nueva comanda.
  - Contenedor táctil horizontal fluido optimizado para resoluciones 1024×768, 1280×800 y 1440×900.
  - Estado vacío optimizado (`EmptyState`) cuando la estación está al día ("Todos los pedidos han sido despachados").
  - Listener global de teclado para Bump Bar (teclas 1-8, Espacio, R, ?).

### 2.6 KdsRoute (`KdsRoute.tsx`)
- Integra `KdsBoard` en el router de la aplicación (`/kds/:estacionId`).
- Sincroniza la estación activa con el hash de navegación (`#/kds/${estacionId}`).
- Aplica el tema oscuro de cocina (`[data-theme='dark']`) por defecto.

---

## 3. Typed IPC Bridge & Domain Event Contracts

Actualizado `@trident/pos-renderer/src/bridge/trident-bridge.ts`:
- **DTOs Canónicos:**
  - `KdsEstacionDTO`: `id`, `name`, `stationType ('COCINA' | 'BARRA')`, `status ('ACTIVA' | 'INACTIVA')`.
  - `KdsTicketPartidaModifierDTO`: `modifierId`, `modifierNameSnapshot`.
  - `KdsTicketItemDTO`: `id`, `productName`, `quantity (scale-4 string | number)`, `notes`, `status ('PENDIENTE' | 'EN_PREPARACION' | 'LISTO' | 'ENTREGADO')`, `modifiers`.
  - `KdsTicketDTO`: `id`, `folio`, `cuentaId`, `tableNumber`, `waiterName`, `kdsEstacionId`, `urgencyLevel ('NORMAL' | 'ALTA' | 'URGENTE')`, `status ('PENDIENTE' | 'EN_PREPARACION' | 'LISTO')`, `printStatus`, `printerId`, `createdAt`, `updatedAt`, `completedAt`, `preparationTimeMinutes`, `targetSeconds`, `items`.
- **API `window.trident.kds`:**
  - `getTickets(estacionId)`: Consulta tickets activos de la estación.
  - `getEstaciones()`: Consulta estaciones configuradas.
  - `startPreparation(ticketId, estacionId, clientOpId)`: Inicia preparación y emite `OrdenProduccionIniciadaEnKDS`.
  - `bumpTicket(ticketId, clientOpId, preparationTimeMinutes)`: Despacha comanda, calcula tiempo transcurrido en minutos enteros, traslada a historial de recall y emite `OrdenProduccionConfirmadaEnKDS`.
  - `recallTicket(ticketId, windowMinutes)`: Consulta ticket completado dentro de la ventana de recall.
  - `getRecentCompletedTickets(estacionId, windowMinutes)`: Consulta tickets finalizados recientes.
  - `reopenTicket(ticketId, clientOpId)`: Reabre ticket despachado hacia la cola activa.
  - `toggleItemStatus(ticketId, itemId, newStatus)`: Actualiza estado individual de platillo y emite `KdsTicketActualizado`.
- **Interconexión Salón ↔ KDS:**
  - El mock de `salon.enviarComanda` genera automáticamente un `KdsTicketDTO` asociado y emite `ComandaEnviadaACocina`, logrando actualización en vivo simultánea en KDS.

---

## 4. Verification & Test Evidence

### 4.1 Test Suites Passing
```
> @trident/pos-renderer@0.1.0 test
> node --test dist/index.test.js

▶ @trident/pos-renderer Architecture & Shell Harness
  ✔ returns valid package metadata and strictly governed dependencies
  ▶ Typed IPC Bridge Client & Session Contracts (4 tests PASS)
  ▶ EventInvalidator & Cache Synchronization Policy (5 tests PASS)
  ▶ Routing & Hash Path Helpers (1 test PASS)
  ▶ WP-026B Salón & Comandero Táctil Integration Suite (10 tests PASS)
  ▶ WP-026C KDS Cocina Táctil Integration Suite
    ✔ retrieves kitchen stations and filters active tickets by estacionId
    ✔ transitions ticket from PENDIENTE to EN_PREPARACION with canonical event broadcast
    ✔ bumps ticket from EN_PREPARACION to LISTO, moving to completed and broadcasting confirmation
    ✔ retrieves completed tickets in recall window and reopens ticket to kitchen (undo bump)
    ✔ toggles individual item status between PENDIENTE, EN_PREPARACION and LISTO
    ✔ dispatches comanda from Salón and automatically reflects new ticket in KDS via ComandaEnviadaACocina
    ✔ handles full-state resync upon reconnect without state divergence (ADR-005)
    ✔ enforces zero floats and canonical scale-4 quantities in KDS contracts
  ✔ WP-026C KDS Cocina Táctil Integration Suite (8/8 PASS)
✔ @trident/pos-renderer Architecture & Shell Harness (29/29 PASS)
```

### 4.2 Monorepo Checks
- `npm run graph:check`: **44/44 PASS** (Cero dependencias circulares, conformidad arquitectónica estricta).
- `npm run typecheck`: **22/22 PASS** (TypeScript estricto sin errores).
- `npm run lint`: **13/13 PASS** (ESLint sin errores ni advertencias en pos-renderer).
- `npm run format:check`: **PASS** (Prettier 100% verificado).
- `@trident/pos-edge-runtime`: **47/47 PASS** (KDS Runtime, Cash Shift & Payments).

---

## 5. Architectural Compliance Gate
- [x] **No Business Rules in UI (`FE-COND-015-03`):** Cero máquinas de estado inventadas; todas las transiciones y eventos provienen de los contratos canónicos de `WP-015`.
- [x] **Visual System Consistency (`UX-COND-015-01` / `UX-COND-015-02`):** Consume únicamente tokens y primitivas de `@trident/ui` (`Button`, `IconButton`, `Badge`, `Timer`, `Drawer`, `Dialog`).
- [x] **Touch Targets Ergonomics:** Targets mínimos de 44×44px, acciones primarias de 56px, botón de despacho Bump de 72px (`size="xl"`).
- [x] **Accessibility WCAG 2.2 AA:** El estado del ticket nunca se comunica solo con color; se acompaña de iconos y etiquetas legibles. Soporte para `prefers-reduced-motion`.
- [x] **Zero Floats Policy (`ADR-012`):** Cantidades en escala-4 / enteros, duraciones en minutos enteros.
- [x] **Reconnect Full-State Resync (`ADR-005`):** Manejo explícito de reconexión y cuadro de resincronización `KDS_RESYNC`.
