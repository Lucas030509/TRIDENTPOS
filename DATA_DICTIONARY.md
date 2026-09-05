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
| `stations` | `id` | UUID | NO | Internal | Identificador único de estación / terminal. Claves compuestas `(organization_id, branch_id, id)` y `(organization_id, id)`. |
| `stations` | `code` | VARCHAR(50) | NO | Internal | Código de estación (ej. 'POS-01'). Único por sucursal `(organization_id, branch_id, code)`. |
| `stations` | `station_type` | VARCHAR(50) | NO | Internal | Tipo de terminal (`POS`, `KDS`, `COMANDERO`, `DISPLAY`). |
| `stations` | `is_authorized` | BOOLEAN | NO | Internal | Estado de autorización del dispositivo para operar en la red local/Cloud. |
| `audit_log_events` | `id` | UUID | NO | Internal | Identificador único del evento de auditoría. Inmutable, append-only. |
| `audit_log_events` | `organization_id` | UUID | NO | Internal | Identificador del Tenant propietario. Clave de partición lógica en RLS (`current_app_org_id()`). |
| `audit_log_events` | `branch_id` | UUID | SÍ | Internal | Sucursal donde ocurrió el evento (NULL para eventos corporativos). Clave foránea `(organization_id, branch_id)` con `ON DELETE SET NULL (branch_id)` preservando `organization_id`. |
| `audit_log_events` | `actor_id` | UUID | SÍ | Internal | Usuario autor del evento (NULL si fue automatizado por sistema). Clave foránea `(organization_id, actor_id)` con `ON DELETE SET NULL (actor_id)` preservando `organization_id`. |
| `audit_log_events` | `station_id` | UUID | SÍ | Internal | Estación origen. Clave foránea `(organization_id, branch_id, station_id)` con `ON DELETE SET NULL (station_id)` preservando `organization_id` y `branch_id`. |
| `audit_log_events` | `event_type` | VARCHAR(100) | NO | Internal | Tipo canónico de evento (ej. 'auth.login.success', 'order.cancelled', 'audit.checkpoint.created'). |
| `audit_log_events` | `severity` | VARCHAR(20) | NO | Internal | Severidad operativa ('INFO', 'WARN', 'ERROR', 'CRITICAL'). |
| `audit_log_events` | `action` | VARCHAR(100) | NO | Internal | Acción ejecutada (ej. 'CREATE', 'UPDATE', 'CANCEL', 'AUTHORIZE'). |
| `audit_log_events` | `entity_name` | VARCHAR(100) | NO | Internal | Nombre del agregado afectado (ej. 'order', 'user', 'shift', 'role'). |
| `audit_log_events` | `entity_id` | VARCHAR(100) | SÍ | Internal | Identificador del registro o entidad afectada. |
| `audit_log_events` | `client_timestamp` | TIMESTAMPTZ | SÍ | Internal | Marca de tiempo UTC reportada por el cliente/estación de origen. |
| `audit_log_events` | `server_timestamp` | TIMESTAMPTZ | NO | Internal | Marca de tiempo UTC oficial de recepción y persistencia en Cloud PostgreSQL. |
| `audit_log_events` | `sequence_number` | BIGINT | NO | Internal | Secuencia estrictamente monotónica por flujo `(organization_id, branch_id)`. |
| `audit_log_events` | `previous_record_hash` | VARCHAR(64) | NO | Restricted | Hash SHA-256 del registro previo en la cadena. Bloque génesis utiliza 64 caracteres de cero. |
| `audit_log_events` | `record_hash` | VARCHAR(64) | NO | Restricted | Hash SHA-256 del payload canónico serializado (RFC 8785). Único por tenant `(organization_id, record_hash)`. |
| `audit_log_events` | `source` | VARCHAR(50) | NO | Internal | Origen de emisión ('CLOUD', 'EDGE_POS', 'EDGE_KDS', 'SYSTEM'). |
| `audit_log_events` | `request_id` | VARCHAR(100) | SÍ | Internal | Identificador de correlación de petición HTTP / RPC. |
| `audit_log_events` | `metadata` | JSONB | NO | Confidential | Metadatos estructurados sanitizados previamente. Credenciales censuradas y PII enmascarada. Retención: `PROVISIONAL RETENTION — LEGAL/PRIVACY VALIDATION REQUIRED (SEC-VAL-11)`. |
| `security_telemetry_events`| `id` | UUID | NO | Internal | Identificador único del evento de detección de telemetría de seguridad. Append-only. |
| `security_telemetry_events`| `organization_id` | UUID | NO | Internal | Identificador del Tenant propietario (RLS). |
| `security_telemetry_events`| `branch_id` | UUID | SÍ | Internal | Sucursal involucrada en la detección. Clave foránea `(organization_id, branch_id)` con `ON DELETE SET NULL (branch_id)` preservando `organization_id`. |
| `security_telemetry_events`| `station_id` | UUID | SÍ | Internal | Estación asociada a la alerta. Clave foránea `(organization_id, branch_id, station_id)` con `ON DELETE SET NULL (station_id)` preservando `organization_id` y `branch_id`. |
| `security_telemetry_events`| `actor_id` | UUID | SÍ | Internal | Usuario asociado a la alerta. Clave foránea `(organization_id, actor_id)` con `ON DELETE SET NULL (actor_id)` preservando `organization_id`. |
| `security_telemetry_events`| `rule_code` | VARCHAR(100) | NO | Internal | Código de regla de seguridad ('PIN_BRUTE_FORCE', 'LEASE_REVOKED_ACCESS', 'AUDIT_HASH_CHAIN_BREAK', etc.). |
| `security_telemetry_events`| `severity` | VARCHAR(20) | NO | Internal | Nivel de severidad ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL'). |
| `security_telemetry_events`| `category` | VARCHAR(50) | NO | Internal | Categoría ('AUTHENTICATION', 'AUTHORIZATION', 'INTEGRITY', 'NETWORK', 'TIMING'). |
| `security_telemetry_events`| `details` | JSONB | NO | Confidential | Parámetros técnicos del incidente sanitizados (conteos, umbrales, hashes observados vs esperados). Retención: `PROVISIONAL RETENTION — LEGAL/PRIVACY VALIDATION REQUIRED (SEC-VAL-11)`. |
| `security_telemetry_events`| `action_taken` | VARCHAR(100) | NO | Internal | Mitigación ejecutada de forma automática (ej. 'STATION_TEMPORARY_BLOCK', 'REJECT_403_LEASE_REVOKED'). |
| `security_telemetry_events`| `source` | VARCHAR(50) | NO | Internal | Origen de la detección ('CLOUD', 'EDGE_POS', 'EDGE_SERVER', 'SYSTEM'). |
| `security_telemetry_events`| `request_id` | VARCHAR(100) | SÍ | Internal | Identificador de correlación de petición. |
| `security_telemetry_events`| `timestamp` | TIMESTAMPTZ | NO | Internal | Marca de tiempo UTC de la detección. |
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
