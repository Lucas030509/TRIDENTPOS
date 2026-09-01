# OPEN QUESTIONS & DECISION LOG — ERP RESTAURANTES

**Document ID:** `ARCH-OQ-001`  
**Version:** `1.3 NORMALIZED / REMEDIATED`  
**Status:** `READY FOR INDEPENDENT REVIEW`  
**Date:** 2026-09-01  
**Baseline:** `EAAF v1.2.0 @ 7e036f43240b3dc28ccb996e350263598275b2cd`  
**Supersedes:** `OPEN_QUESTIONS.md v1.1`  

---

## 1. Declaración de Principios sobre Decisiones Abiertas

En estricto apego a las directivas arquitectónicas y a la especificación funcional SSOT v1.1 APPROVED, **ninguna cuestión catalogada como `OPEN / PENDIENTE DE DEFINICIÓN` ha sido cerrada de forma unilateral**. 

Este documento formaliza el catálogo de decisiones de negocio y políticas operativas que requieren **aprobación explícita del Product Owner** antes de la fase de modelado de datos detallado e implementación técnica. Las preguntas se dividen formalmente en:
1. **Preguntas Heredadas del SSOT** (Vacíos o ambigüedades documentales en los manuales de origen).
2. **Preguntas Descubiertas en Arquitectura** (Decisiones de orquestación modular y gobierno de datos identificadas durante el diseño).

Para cada cuestión se documenta el contexto fáctico, las opciones de diseño analizadas y el **tratamiento arquitectónico neutral** adoptado, asegurando que la arquitectura no elija de forma prematura ninguna opción de negocio.

---

## 2. Matriz General de Cuestiones Abiertas

| ID | Origen | Dominio | Cuestión Funcional de Negocio | Severidad | Módulo Afectado |
|---|---|---|---|---|---|
| **OQ-SSOT-01** | SSOT (CRITICAL #4) | Seguridad / Cancelaciones | Política y permisos de cancelación de productos post-cocina. | **CRÍTICA** | TRIDENTPOS / Inventory |
| **OQ-SSOT-02** | SSOT (IMPORTANT #5) | Comandero Móvil | Requerimiento de contraseña de mesero receptor al transferir cuenta. | **IMPORTANTE** | TRIDENTPOS |
| **OQ-SSOT-03** | SSOT (IMPORTANT #6) | Cuentas por Cobrar | Mecanismo y validación de límite de crédito para cargos a clientes. | **IMPORTANTE** | Finance / CRM |
| **OQ-SSOT-04** | SSOT (IMPORTANT #7) | Comandero Móvil | Flujo y validaciones de cancelación total de cuentas impresas desde móvil. | **IMPORTANTE** | TRIDENTPOS |
| **OQ-SSOT-05** | SSOT (IMPORTANT #8) | Compras / Abastecimiento | Criterios de sugerencia automática de compra vs. pedido manual. | **IMPORTANTE** | Procurement |
| **OQ-SSOT-06** | SSOT (IMPORTANT #9) | Operaciones de Mesa | Regla de prorrateo financiero de descuentos y propinas al dividir cuenta. | **IMPORTANTE** | TRIDENTPOS / Finance |
| **OQ-SSOT-07** | SSOT (IMPORTANT #10) | Ingeniería de Recetas | Consolidación y prioridad de recetas en compuestos con modificadores. | **IMPORTANTE** | Inventory |
| **OQ-ARCH-01** | Arquitectura | Control de Caja | Modelo de turnos multi-cajero en terminales de cobro compartidas. | **MENOR** | TRIDENTPOS |
| **OQ-ARCH-02** | Arquitectura | Facturación Fiscal | Tratamiento de folios no facturados en el cierre de mes (Factura Global). | **MENOR** | Billing / Finance |

---

## 3. Fichas de Decisión Pendientes de Aprobación

---

### 3.1 Preguntas Heredadas del SSOT (v1.1 APPROVED)

---

#### OQ-SSOT-01: Política y Permisos de Cancelación Post-Cocina

- **Contexto Funcional:** Cuando un producto ya ha sido enviado a cocina e incluso elaborado/surtido en el KDS, un cliente puede solicitar cancelarlo por demora o error. La anulación en este punto genera un desacople: los insumos ya fueron preparados físicamente y descontados del almacén.
- **Evidencia en Fuente (SSOT):** `[DESCONOCIDO]` El manual exigía captura obligatoria de motivo del catálogo, pero no definía un nivel de permiso diferenciado según la fase de preparación del ítem.
- **Impacto Arquitectónico:** Afecta a la máquina de estados de `ProductoEnCuenta`, al contrato `TRIDENTPOS ↔ Inventory` y a la generación automática de registros de merma/desperdicio.
- **Opciones para Aprobación del Product Owner:**
  - **Opción A (Estricta Gerencial):** La anulación post-cocina requiere forzosamente autorización de Gerente/Admin y genera automáticamente una orden de Merma en el Centro de Consumo.
  - **Opción B (Parametrizable por Sucursal):** Cada sucursal configura si permite cancelación al mesero/cajero con motivo justificado o si restringe a rol supervisor.
  - **Opción C (Flujo de Rechazo en KDS):** El mesero solicita la cancelación y la pantalla de cocina debe aceptar o rechazar según el estado físico de la preparación.
- **Tratamiento Arquitectónico Neutral:** La arquitectura mantiene el contrato desacoplado recibiendo un motivo de cancelación obligatorio y marcando el punto de validación como una política abierta parametrizable, sin seleccionar ninguna opción de negocio de antemano.

---

#### OQ-SSOT-02: Transferencia de Cuentas en Comandero Móvil y Validación de Contraseña

- **Contexto Funcional:** Un mesero transfiere una mesa o cuenta activa a otro mesero (ej. por cambio de turno o relevo de estación).
- **Evidencia en Fuente (SSOT):** `[CONFIRMADO Configurable]` El campo existía en catálogos de SR11, pero la activación por defecto y el comportamiento ante rechazo eran ambiguos.
- **Impacto Arquitectónico:** Contrato de autorización en el Comandero Móvil y reglas de trazabilidad de propinas e historial de comanda.
- **Opciones para Aprobación del Product Owner:**
  - **Opción A (Libre Transferencia):** El mesero emisor selecciona el mesero receptor y la transferencia se aplica de inmediato.
  - **Opción B (Validación por PIN Receptor):** Requiere que el mesero receptor ingrese su PIN de 4 dígitos en el dispositivo móvil para aceptar la cuenta.
  - **Opción C (Autorización de Capitán/Gerente):** Toda transferencia de mesa debe ser validada por un Capitán de Meseros o Gerente.
- **Tratamiento Arquitectónico Neutral:** Se define una interfaz de comando de transferencia que soporta credenciales de confirmación opcionales; la regla de obligatoriedad se define como política abierta sujeta a decisión del PO.

---

#### OQ-SSOT-03: Mecanismo y Validación de Límite de Crédito en Cuentas por Cobrar

- **Contexto Funcional:** Liquidación de una cuenta mediante la forma de pago "Crédito a Cliente" (Cuentas por Cobrar).
- **Evidencia en Fuente (SSOT):** `[CONFIRMADO en Pantalla / DESCONOCIDO Flujo]` Se documentó la pantalla de consulta de saldos en SR11, pero no los bloqueos en piso cuando un cliente excede su límite de crédito.
- **Impacto Arquitectónico:** Contrato de validación en tiempo real entre `TRIDENTPOS` y `Finance / CRM` durante el checkout.
- **Opciones para Aprobación del Product Owner:**
  - **Opción A (Bloqueo Duro):** Si el monto de la cuenta excede el límite de crédito disponible del cliente, el POS rechaza la transacción tajantemente.
  - **Opción B (Override Gerencial):** El POS advierte el sobregiro y permite completar el cobro únicamente si un Gerente autoriza con su PIN/contraseña.
  - **Opción C (Crédito Abierto con Notificación):** Permite el registro del saldo sin bloquear la venta, enviando alerta al departamento de crédito.
- **Tratamiento Arquitectónico Neutral:** El contrato de cobro expone la verificación de saldo crediticio; la política ante sobregiro se modela como un punto de extensión desacoplado sin forzar bloqueo duro ni override predeterminado.

---

#### OQ-SSOT-04: Flujo y Validaciones de Cancelación Total de Cuenta Impresa desde Comandero Móvil

- **Contexto Funcional:** Una cuenta que ya tiene precuenta impresa (con Folio de Venta asignado) necesita ser cancelada en su totalidad desde un dispositivo móvil.
- **Evidencia en Fuente (SSOT):** `[CONFIRMADO Botón / DESCONOCIDO Flujo]` El botón existía en la interfaz móvil, pero no se detallaron los pasos de control para evitar fraudes en salón.
- **Impacto Arquitectónico:** Máquina de estados de `Cuenta`, anulación de Folio consecutivo y auditoría de terminales móviles.
- **Opciones para Aprobación del Product Owner:**
  - **Opción A (Prohibido en Móvil):** Las cuentas con precuenta impresa solo pueden cancelarse físicamente en la terminal de caja fija con presencia del Gerente.
  - **Opción B (Autorización Remota por PIN):** El mesero puede solicitar la cancelación desde el comandero ingresando el PIN de un Gerente autorizado.
- **Tratamiento Arquitectónico Neutral:** La máquina de estados de la cuenta registra el evento de anulación exigiendo motivo y token de autorización; la delegación a terminales fijas vs. móviles permanece como política abierta.

---

#### OQ-SSOT-05: Criterios de Disparo de Pedidos de Abastecimiento Automáticos por Stock

- **Contexto Funcional:** Generación de órdenes de compra sugeridas por el sistema en función de los niveles de existencia en bodega.
- **Evidencia en Fuente (SSOT):** `[DESCONOCIDO Detalle]` Menú existente en manual sin desarrollo descriptivo del algoritmo de sugerencia.
- **Impacto Arquitectónico:** Lógica de cálculo en el Bounded Context de `Procurement`.
- **Opciones para Aprobación del Product Owner:**
  - **Opción A (Punto de Reorden Estático):** Disparo simple: Si `StockActual <= StockMinimo`, sugerir `StockMaximo - StockActual`.
  - **Opción B (Promedio Ponderado de Consumo):** Cálculo dinámico basado en el consumo promedio diario de los últimos N días multiplicado por el tiempo de entrega del proveedor (Lead Time).
- **Tratamiento Arquitectónico Neutral:** Se define la capacidad de cálculo de sugerencia desacoplada de la regla matemática específica, dejando abierta la estrategia de cálculo para definición del PO.

---

#### OQ-SSOT-06: Prorrateo de Descuentos, Propinas y Cargos al Dividir Cuenta

- **Contexto Funcional:** Cuando una mesa con 4 comensales que tiene un descuento general del 15% y propina sugerida decide dividirse en 2 cuentas separadas.
- **Evidencia en Fuente (SSOT):** `[DESCONOCIDO]` No documentado en los manuales de usuario analizados.
- **Impacto Arquitectónico:** Algoritmo financiero de división de cuentas en `TRIDENTPOS`.
- **Opciones para Aprobación del Product Owner:**
  - **Opción A (Prorrateo Porcentual Proporcional):** Los descuentos y propinas acumuladas se distribuyen automáticamente de forma proporcional al subtotal de productos asignados a cada nueva cuenta.
  - **Opción B (Reinicio de Descuentos):** Los descuentos generales se eliminan al dividir y deben volver a aplicarse a cada subcuenta si corresponde.
- **Tratamiento Arquitectónico Neutral:** El contrato de división de cuentas admite parámetros de reasignación financiera; la fórmula de cálculo no se preestablece en la arquitectura.

---

#### OQ-SSOT-07: Consolidación y Prioridad de Recetas en Productos Compuestos con Modificadores

- **Contexto Funcional:** Un producto compuesto (ej. Hamburguesa Especial) tiene una receta base, pero el comensal selecciona modificadores que también tienen recetas propias (ej. Extra Tocino, Sin Cebolla, Salsa BBQ).
- **Evidencia en Fuente (SSOT):** `[INFERIDO]` Se deduce que los insumos de modificadores con costo adicional se suman, pero la exclusión de insumos base no estaba formalizada.
- **Impacto Arquitectónico:** Motor de explosión de recetas en `Inventory`.
- **Opciones para Aprobación del Product Owner:**
  - **Opción A (Aditiva y Sustractiva):** Modificadores positivos suman insumos; modificadores de tipo "Sin X" restan el gramaje del insumo de la receta base.
  - **Opción B (Solo Aditiva):** Los modificadores solo suman insumos adicionales; las notas de "Sin X" son informativas para cocina sin alterar el consumo estándar.
- **Tratamiento Arquitectónico Neutral:** El evento `OrdenProduccionConfirmadaEnKDS` transporta la lista completa de `selectedModifiers[]`. El motor de Inventory mantiene abierta la fórmula de consolidación sin asumir comportamiento aditivo ni sustractivo por defecto.

---

### 3.2 Nuevas Preguntas Descubiertas en Arquitectura Funcional

---

#### OQ-ARCH-01: Gestión de Turnos Multi-Cajero en Terminales Compartidas

- **Contexto Funcional:** Dos cajeros que operan la misma estación física de cobro durante horas pico o relevos de turno.
- **Evidencia en Fuente (SSOT):** `[CONFIRMADO Mono-Cajero por Turno]` En SR11 la apertura de turno bloqueaba la caja a un único usuario cajero hasta su cierre.
- **Impacto Arquitectónico:** Agregado `TurnoCaja` en `TRIDENTPOS`.
- **Opciones para Aprobación del Product Owner:**
  - **Opción A (Cajero Único Estricto):** 1 Estación = 1 Turno Activo = 1 Cajero Responsable del Arqueo.
  - **Opción B (Turnos Compartidos / Fondo de Caja Común):** Múltiples operadores autorizados cobran en la misma caja con responsabilidad mancomunada en el arqueo final.
- **Tratamiento Arquitectónico Neutral:** El agregado `TurnoCaja` se modela vinculado a una estación y un operador principal; la posibilidad de sesiones compartidas se mantiene como decisión de negocio abierta.

---

#### OQ-ARCH-02: Esquema de Facturación Global Automática para Folios No Reclamados

- **Contexto Funcional:** Folios de venta cobrados que no fueron facturados individualmente por los clientes al cierre del período fiscal.
- **Evidencia en Fuente (SSOT):** `[CONFIRMADO Manual]` Se documentó la facturación por lote manual, pero no la automatización de cierre mensual.
- **Impacto Arquitectónico:** Proceso batch en el Bounded Context de `Billing`.
- **Opciones para Aprobación del Product Owner:**
  - **Opción A (Generación Manual Asistida):** El administrador selecciona los folios pendientes en pantalla y genera la Factura Global del Público en General.
  - **Opción B (Cierre Automático Programado):** Proceso desatendido que agrupa y timbra automáticamente todos los folios no facturados al finalizar el mes.
- **Tratamiento Arquitectónico Neutral:** La capability de facturación por lote expone la operación de agrupamiento; el disparador manual vs. programado queda abierto a definición del PO.

---

DOCUMENT STATUS: READY FOR INDEPENDENT REVIEW
