# PRODUCT DECISIONS — ERP RESTAURANTES

**Versión:** 1.2 (FINAL NORMALIZED)  
**Fecha:** 2026-08-31  
**SSOT Baseline:** [`RESTAURANT_SOFTWARE_RECONSTRUCTION_SPEC.md`](file:///Volumes/SSD_ORICO/BRAIN/TRIDENTPOSREST/RESTAURANT_SOFTWARE_RECONSTRUCTION_SPEC.md) (v1.1 APPROVED) & [`FUNCTIONAL_ARCHITECTURE.md`](file:///Volumes/SSD_ORICO/BRAIN/TRIDENTPOSREST/FUNCTIONAL_ARCHITECTURE.md) (v1.2 APPROVED).  
**Rol:** `02_Functional / Business Architect`

---

## Registro de Decisiones de Producto y Arquitectura Funcional

| ID Decisión | Título | Estado | Categoría |
|---|---|---|---|
| **DEC-001** | Arquitectura Desacoplada: `MODULAR BY DESIGN — INTEGRATED BY CONTRACT` | APROBADA | Arquitectura |
| **DEC-002** | `TRIDENTPOS` como Vertical de Restaurant Operations (POS + KDS + Comandero + Caja) | APROBADA | Dominio / Producto |
| **DEC-003** | Catálogo Maestro Central en Platform Core con Overrides Locales por Sucursal | APROBADA | Modelo de Dominio |
| **DEC-004** | Confirmación en KDS como Disparador Automático de Consumo para TRIDENTPOS | APROBADA | Lógica de Negocio |
| **DEC-005** | Resiliencia Operativa de Red Local en TRIDENTPOS (LAN / WiFi) | APROBADA | Operacional / Resiliencia |
| **DEC-006** | Asignación de Folio de Venta Únicamente al Emitir Precuenta Impresa | APROBADA | Lógica de Negocio |
| **DEC-007** | Soporte de Topologías Full-Suite, Standalone e Integración Externa | APROBADA | Arquitectura |
| **DEC-008** | Preservación Estricta de Cuestiones Funcionales Abiertas (SSOT Alignment) | APROBADA | Gobierno / Producto |
| **DEC-009** | Ownership Completo de Ciclo de Caja y Cortes X/Z en TRIDENTPOS | APROBADA | Dominio / Caja |

---

### DEC-001: Arquitectura Desacoplada: `MODULAR BY DESIGN — INTEGRATED BY CONTRACT`

- **Contexto:** En el sistema fuente analizado (Soft Restaurant® 11), existía acoplamiento directo entre el punto de venta, la base de datos mono-servidor y los módulos complementarios. Para el nuevo producto `ERP RESTAURANTES`, se requiere una plataforma extensible que permita comercializar la suite completa o módulos individuales.
- **Decisión:** La suite se estructura en 11 Bounded Contexts independientes. Cada módulo encapsula sus reglas de negocio y expone interfaces contractuales (Comandos, Consultas y Eventos de Dominio).
- **Consecuencias:**
  - *Positivas:* Alta mantenibilidad, independencia de evolución de cada módulo y facilidad para integrar sistemas de terceros.
  - *Compromisos:* Requiere definición formal y versionado de contratos de eventos para evitar regresiones funcionales.

---

### DEC-002: `TRIDENTPOS` como Vertical de Restaurant Operations

- **Contexto:** La operación en piso del restaurante requiere ultra-baja latencia, interfaces táctiles especializadas y workflows de captura rápida que difieren de los formularios administrativos tradicionales de un ERP.
- **Decisión:** Se formaliza **`TRIDENTPOS`** como la vertical operativa de la suite, englobando Servicio Comedor (mesas), Servicio Rápido (mostrador/take-away), Servicio a Domicilio (despacho), Comandero Móvil, el Monitor de Cocina (KDS) y la operación completa de Caja.
- **Consecuencias:**
  - *Positivas:* Claridad en el posicionamiento de producto; TRIDENTPOS opera como un POS gastronómico autónomo o como el front-end operacional de `ERP RESTAURANTES`.
  - *Compromisos:* Debe mantener contratos limpios para enviar eventos de venta, consumo y cortes hacia los módulos suscriptores.

---

### DEC-003: Catálogo Maestro Central en Platform Core con Overrides Locales por Sucursal

- **Contexto:** Los grupos restauranteros modernos exigen gobernanza central de marcas y productos, permitiendo a la vez adaptar precios e impuestos por región o sucursal. Asimismo, módulos como Inventory o Billing deben poder operar Standalone sin requerir la presencia de TRIDENTPOS.
- **Decisión:** El **Catálogo Maestro unificado** (Productos, Categorías/Grupos, Menús, Modificadores, Precios Base y Branch Overrides) reside en **Platform Core**. Las recetas y su ingeniería de rendimientos residen exclusivamente en **Inventory**. Cada sucursal hereda el catálogo maestro y puede definir *overrides locales* sobre:
  1. Precio de venta al público.
  2. Estado de visibilidad y disponibilidad operativa (activo/inactivo en la sucursal).
  3. Asignación de esquemas de impuestos aplicables en su jurisdicción.
- **Consecuencias:**
  - *Positivas:* Inventory Standalone y TRIDENTPOS Standalone resuelven productos desde Platform Core sin depender entre sí.
  - *Compromisos:* El motor de resolución de productos debe evaluar prioritariamente el override local antes de aplicar la regla por defecto de la organización.

---

### DEC-004: Confirmación en KDS como Disparador Automático de Consumo para TRIDENTPOS

- **Contexto:** En los manuales originales, el momento de descarga de existencias de insumos por receta se describía vagamente como "al vender". Si se descuenta al abrir la cuenta o comandar, se generan inconsistencias si el pedido se modifica antes de cocinarse. Si se descuenta al cobrar la cuenta, no hay reflejo del consumo real mientras el cliente come, desfasando el stock físico.
- **Decisión:** Se establece formalmente que el evento **`OrdenProduccionConfirmadaEnKDS`** (cuando cocina marca la comanda como elaborada y surtida en KDS) es el disparador funcional automático para los consumos de inventario originados en la vertical de `TRIDENTPOS` hacia el Centro de Consumo en `Inventory`. Esta decisión formaliza el flujo operativo de TRIDENTPOS sin restringir los mecanismos globales de Inventory (el cual soporta traspasos, mermas, inventarios físicos, salidas manuales o consumos reportados por POS externos).
- **Consecuencias:**
  - *Positivas:* Sincronía precisa entre lo efectivamente cocinado en TRIDENTPOS y lo descargado del almacén.
  - *Compromisos:* Inventory procesa la descarga de insumos cuando su capability se encuentra activa y suscrita al contrato.

---

### DEC-005: Resiliencia Operativa de Red Local en TRIDENTPOS (LAN / WiFi)

- **Contexto:** La dependencia de conectividad constante a la nube representa un riesgo operativo crítico para cocinas y puntos de venta en situaciones de saturación o falla de internet.
- **Decisión:** El transporte operativo entre terminales POS, comanderos móviles, cajas y pantallas KDS pertenece y es resuelto dentro de la vertical **`TRIDENTPOS`**, operando primordialmente sobre la red local de la sucursal (LAN / WiFi). `Platform Core` aporta las primitivas transversales de identidad y seguridad. La sincronización con el backoffice y servicios en la nube se realiza de manera asíncrona.
- **Consecuencias:**
  - *Positivas:* Cero interrupciones en la atención a comensales, preparación en cocina, cobro y emisión de cortes ante contingencias de internet.
  - *Compromisos:* Los servicios externos (pagos bancarios PinPAD en línea, timbrado fiscal) dependen de sus propios enlaces y no se asumen offline.

---

### DEC-006: Asignación de Folio de Venta Únicamente al Emitir Precuenta Impresa

- **Contexto:** El ciclo de vida de una cuenta en mesa puede sufrir cancelaciones, uniones o transferencias antes de que el comensal solicite el pago.
- **Decisión:** El número consecutivo formal de **Folio de Venta** se asigna en el momento exacto en que se genera e imprime la precuenta (cambio a estado `Pendiente por Pagar`), y no al abrir la mesa o capturar comanda.
- **Consecuencias:**
  - *Positivas:* Evita huecos en la foliación operativa y garantiza consistencia fiscal en los cortes de caja y facturación posterior.
  - *Compromisos:* Si se borra una cuenta vacía en estado `Abierta`, no se requiere anular folio alguno pues aún no había sido asignado.

---

### DEC-007: Soporte de Topologías Full-Suite, Standalone e Integración Externa

- **Contexto:** El mercado gastronómico abarca desde pequeños restaurantes independientes hasta grandes cadenas que ya cuentan con sistemas de ERP corporativos (ej. SAP, Odoo) o que desean contratar únicamente el módulo de inventarios y costeo de recetas.
- **Decisión:** La suite soporta nativamente 4 topologías de despliegue:
  1. *Full-Suite:* Operación integral con los 11 módulos de `ERP RESTAURANTES`.
  2. *Standalone:* Despliegue autónomo de cualquier módulo sobre Platform Core.
  3. *Módulos Opcionales:* Habilitación selectiva por sucursal.
  4. *Integración Externa:* Conexión vía contratos funcionales con POS o ERPs de terceros.
- **Consecuencias:**
  - *Positivas:* Amplio mercado direccionable y flexibilidad de monetización modular.
  - *Compromisos:* Cada módulo cuenta con interfaces funcionales de configuración para operar sin depender de la UI del resto de la suite.

---

### DEC-008: Preservación Estricta de Cuestiones Funcionales Abiertas (SSOT Alignment)

- **Contexto:** El SSOT [`RESTAURANT_SOFTWARE_RECONSTRUCTION_SPEC.md v1.1 APPROVED`](file:///Volumes/SSD_ORICO/BRAIN/TRIDENTPOSREST/RESTAURANT_SOFTWARE_RECONSTRUCTION_SPEC.md) documenta brechas donde la fuente original era ambigua o incompleta, y que requieren definición de negocio explícita por parte del Product Owner.
- **Decisión:** Ninguna decisión catalogada como `OPEN / PENDIENTE DE DEFINICIÓN` en el SSOT (como la política de cancelaciones post-cocina, validación de contraseñas al transferir cuentas o reglas de límites en cuentas por cobrar) será resuelta de manera arbitraria en la arquitectura funcional. Se mantienen documentadas formalmente en `OPEN_QUESTIONS.md` con neutralidad arquitectónica.
- **Consecuencias:**
  - *Positivas:* Rigor metodológico y alineación total con la visión de producto del negocio.
  - *Compromisos:* El diseño funcional mantiene puntos de extensión para acomodar la resolución final del Product Owner.

---

### DEC-009: Ownership Completo de Ciclo de Caja y Cortes X/Z en TRIDENTPOS

- **Contexto:** La operación diaria de un restaurante exige realizar cobros, arqueos, retiros y cortes de caja en piso de manera inmediata y sin dependencias de módulos administrativos de backoffice.
- **Decisión:** **`TRIDENTPOS`** es el propietario funcional exclusivo del ciclo de caja P0: apertura de turno, fondo inicial, cobro (split payment), movimientos de efectivo (retiros, depósitos, salvaguardas), arqueo ciego, y la emisión formal del **Corte X** y **Corte Z**. El módulo **`Finance`** no genera Cortes Z; actúa como suscriptor que consume el evento `CorteZGenerado` para conciliación y pólizas contables.
- **Consecuencias:**
  - *Positivas:* TRIDENTPOS opera de forma completamente autónoma en caja y cortes sin requerir Finance.
  - *Compromisos:* Finance debe modelar sus interfaces contables a partir de los eventos emitidos por TRIDENTPOS.

---

PRODUCT DECISIONS V1.1: READY FOR FINAL APPROVAL
