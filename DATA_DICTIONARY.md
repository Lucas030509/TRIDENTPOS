# DATA DICTIONARY — ERP RESTAURANTES / TRIDENTPOS

**Document ID:** `ARCH-DIC-001`  
**Version:** `1.0 APPROVED / FROZEN`  
**Status:** `APPROVED / FROZEN — 2026-09-01`  
**Date:** 2026-09-01  
**Framework:** `EAAF v1.2.0 @ 7e036f43240b3dc28ccb996e350263598275b2cd`  
**Author Agent:** `03_Data_Architect`  
**Approved Solution Baseline:** `e35205906055a8425ab875d05789652b3c3497b7` (Tag `solution-architecture-v1.3-approved`)  

---

## 1. Diccionario de Entidades y Agregados por Bounded Context

### 1.1 Bounded Context: Platform Core

| Tabla / Entidad | Atributo | Tipo de Dato | Nulable | Clasificación | Descripción y Regla de Negocio |
|---|---|---|---|---|---|
| `organizations` | `id` | UUID | NO | Internal | Identificador único global del Tenant / Empresa corporativa. |
| `organizations` | `tax_id` | VARCHAR(50) | NO | Confidential | RFC o Tax ID legal. Clave única global. |
| `branches` | `id` | UUID | NO | Internal | Identificador único de la sucursal física. Clave compuesta `(organization_id, id)`. |
| `branches` | `code` | VARCHAR(50) | NO | Internal | Código corto de sucursal (ej. 'BR-01'). Único por tenant `(organization_id, code)`. |
| `users` | `id` | UUID | NO | Internal | Identificador único del usuario vinculado canónicamente a Supabase Auth `sub` (`jwt.sub`). Clave compuesta `(organization_id, id)`. |
| `users` | `email` | VARCHAR(255) | NO | Confidential | Correo electrónico administrativo. Único por tenant `(organization_id, email)`. |
| `users` | `is_active` | BOOLEAN | NO | Internal | Estado operativo. Si es FALSE, el middleware de autenticación rechaza el acceso de inmediato. |
| `roles` | `id` | UUID | NO | Internal | Identificador único del rol. Clave compuesta `(organization_id, id)`. |
| `roles` | `code` | VARCHAR(50) | NO | Internal | Código semántico del rol (ej. 'ADMIN', 'GERENTE'). Único por tenant `(organization_id, code)`. |
| `roles` | `permissions` | JSONB | NO | Internal | Array canónico de strings de permisos concedidos al rol (RBAC). |
| `user_roles` | `(org,user,branch,role)` | UUIDs | NO | Internal | Asignación compuesta de roles a usuarios por sucursal y tenant con llaves foráneas compuestas. |
| `user_branch_credentials` | `pin_hash` | VARCHAR(255) | NO | Restricted | Hash criptográfico salteado con Argon2id del PIN de 4 dígitos. Aprovisionado en Cloud (WP-005), verificado en Edge (WP-010). |
| `user_branch_credentials` | `credential_version` | INTEGER | NO | Internal | Contador monotónico incrementado en cada cambio de contraseña/PIN. |
| `user_branch_credentials` | `is_revoked` | BOOLEAN | NO | Internal | Bandera de revocación de credencial operativa de sucursal. |
| `products` | `base_price` | DECIMAL(12,4)| NO | Internal | Precio base corporativo antes de branch overrides e impuestos. |
| `branch_product_overrides`| `price_override` | DECIMAL(12,4)| SÍ | Internal | Sobreescritura local de precio para la sucursal específica. |
| `folio_leases` | `epoch_id` | VARCHAR(50) | NO | Internal | Identificador de generación/época (`ep_1`, `ep_2`) para aislamiento de desastres. |
| `folio_leases` | `fencing_token` | VARCHAR(100)| NO | Restricted | Token criptográfico de autorización de escritura de folios. |
| `folio_leases` | `status` | VARCHAR(50) | NO | Internal | `ALLOCATED`, `ACTIVE`, `ABANDONED_CONTINGENCY_RANGE`, `RECONCILED`. |

---

### 1.2 Bounded Context: TRIDENTPOS

| Tabla / Entidad | Atributo | Tipo de Dato | Nulable | Clasificación | Descripción y Regla de Negocio |
|---|---|---|---|---|---|
| `cuentas` | `version` | INTEGER | NO | Internal | Versión monotónica para Control de Concurrencia Optimista (OCC). |
| `cuentas` | `folio_number` | INTEGER | SÍ | Confidential | Folio consecutivo de ticket asignado bajo el lease de la época activa. |
| `cuentas` | `status` | VARCHAR(50) | NO | Internal | `ABIERTA`, `IMPRESA`, `PAGADA`, `ANULADA`. |
| `cuenta_items` | `unit_price_applied` | DECIMAL(12,4)| NO | Confidential | **Frozen Economic Snapshot:** Precio unitario inmutable congelado al ordenar. |
| `cuenta_items` | `tax_rate_applied` | DECIMAL(6,4) | NO | Confidential | Tasa de impuesto congelada vigente al instante de la comanda. |
| `mesas` | `version` | INTEGER | NO | Internal | Versión monotónica OCC para prevenir colisiones entre comanderos móviles. |
| `turnos_caja` | `version` | INTEGER | NO | Internal | Versión monotónica OCC para aperturas y cierres de turno de cajero. |
| `turnos_caja` | `closing_declared_cash`| DECIMAL(12,4)| SÍ | Confidential | Efectivo físicamente contado en arqueo ciego por el operador. |
| `pagos` | `payment_method` | VARCHAR(50) | NO | Confidential | `EFECTIVO`, `TARJETA`, `TRANSFERENCIA`, `RESTCARD`, `CXC`. |
| `outbox_queue` | `client_op_id` | TEXT / UUID | NO | Internal | UUIDv4 generado determinísticamente por el cliente antes del envío. |
| `outbox_queue` | `idempotency_key` | TEXT | NO | Internal | Clave lógica compuesta única: `org:branch:aggType:aggId:action:clientOpId`. |

---

### 1.3 Bounded Context: Inventory & Procurement

| Tabla / Entidad | Atributo | Tipo de Dato | Nulable | Clasificación | Descripción y Regla de Negocio |
|---|---|---|---|---|---|
| `ingredients` | `current_average_cost`| DECIMAL(12,4)| NO | Internal | Costo promedio ponderado calculado a partir de recepciones de compra. |
| `recipes` | `yield_quantity` | DECIMAL(12,4)| NO | Internal | Rendimiento estándar de la fórmula base de producción. |
| `recipe_items` | `gross_quantity` | DECIMAL(12,4)| NO | Internal | Cantidad bruta requerida incluyendo factor de merma estándar de cocina. |
| `stock_ledger` | `movement_type` | VARCHAR(50) | NO | Internal | `COMPRA`, `CONSUMO_KDS`, `MERMA`, `AJUSTE_FISICO`. Append-only. |
| `purchase_receipts` | `receipt_number` | VARCHAR(50) | NO | Confidential | Folio físico de recepción de mercancías emitido en almacén. |
| `purchase_receipts` | `status` | VARCHAR(50) | NO | Internal | `REGISTERED` (dispara evento canónico `RecepcionCompraRegistrada`). |

---

### 1.4 Bounded Context: Finance, Billing, CRM, Delivery & Loyalty

| Tabla / Entidad | Atributo | Tipo de Dato | Nulable | Clasificación | Descripción y Regla de Negocio |
|---|---|---|---|---|---|
| `accounts_payable` | `balance_due` | DECIMAL(12,4)| NO | Confidential | Saldo pendiente de pago a proveedores generado por recepciones de compra. |
| `accounts_receivable`| `balance_due` | DECIMAL(12,4)| NO | Confidential | Saldo por cobrar a clientes originado por pagos de comanda a crédito (CxC). |
| `customers` | `credit_limit` | DECIMAL(12,4)| NO | Confidential | Límite máximo de crédito autorizado para cargos a cuenta corriente. |
| `fiscal_invoices` | `invoice_uuid` | VARCHAR(100)| SÍ | Confidential | Folio Fiscal Digital (UUID) emitido y certificado por el PAC / Autoridad Tributaria. |
| `drivers` | `vehicle_type` | VARCHAR(50) | NO | Internal | Tipo de vehículo de la flota propia (`MOTO`, `BICI`, `AUTO`). |
| `loyalty_accounts` | `wallet_balance` | DECIMAL(12,4)| NO | Confidential | Saldo disponible en moneda corriente en el monedero electrónico RestCard. |
| `external_connectors`| `encrypted_credentials`| BYTEA | NO | Restricted | Credenciales OAuth/API cifradas de agregadores externos (Uber/Rappi/Didi). |

---

DOCUMENT STATUS: APPROVED / FROZEN — 2026-09-01
