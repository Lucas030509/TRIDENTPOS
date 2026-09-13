# ADR-012: Representación Monetaria Exacta en Borde (Fixed-Point Scale 4 en SQLite)

**Status:** `PROPOSED ARCHITECTURE CHANGE — PENDING GOVERNANCE APPROVAL`  
**Date:** 2026-09-13  
**Owners:** `01_Solution_Architect`  
**Related Documents:** `DATA_MODEL.md`, `DATA_ARCHITECTURE.md`, `DATA_DICTIONARY.md`, `TECH_STACK_DECISIONS.md`, `ACR-2026-013`  
**Classification:** `TECHNICAL ARCHITECTURE DECISION`  

---

## 1. Context

En la arquitectura distribuida de TRIDENTPOS (Full Suite Topology), las operaciones de piso del restaurante (apertura de cuentas, comandas, adición de partidas, modificadores, precuentas y cierres) se ejecutan con autoridad primaria de escritura en el **Edge Host Local** sobre SQLite 3 en modo WAL (`ADR-004`).

Durante el Pre-Flight del paquete de trabajo `WP-014: Dining Room, Tables & Orders Domain Engine with OCC`, se identificó una contradicción normativa interna en la especificación congelada:
1. **Regla General (`DATA_MODEL.md` Sec. 1, Línea 21):**
   > *"Valores Monetarios: `DECIMAL(12, 4)` en Cloud y `INTEGER` en centavos o `DECIMAL(12, 4)` en Edge. Prohibido punto flotante (`REAL` / `FLOAT`)."*
2. **Esquema DDL Local SQLite (`DATA_MODEL.md` Sec. 3, Líneas 840–875):**
   Las columnas de `cuentas`, `cuenta_items`, `cuenta_item_modificadores`, `turnos_caja` y `pagos` fueron declaradas con el tipo de almacenamiento SQLite `REAL` (punto flotante IEEE 754 de doble precisión de 64 bits), por ejemplo: `subtotal REAL NOT NULL DEFAULT 0.0`, `unit_price_applied REAL NOT NULL`, `total REAL NOT NULL`.
3. **Diccionario de Datos (`DATA_DICTIONARY.md` Sec. 1.2):**
   Declaraba `cuenta_items.unit_price_applied` como `DECIMAL(12,4)` y `tax_rate_applied` como `DECIMAL(6,4)`.

El almacenamiento en punto flotante (`REAL`) es categóricamente inadmisible en sistemas financieros, fiscales y de punto de venta debido a la imprecisión inherente en la representación binaria fraccionaria (ej. `0.1 + 0.2 = 0.30000000000000004`), pérdida de asociatividad en sumatorias, y riesgo de discrepancias de redondeo frente a los registros fiscales y de facturación digital del SAT.

---

## 2. Problem

Se requiere establecer una única representación física y lógica, determinista, canónica y exacta para todos los valores monetarios, tasas impositivas y cantidades fraccionarias en la base de datos embebida Edge SQLite, garantizando:
1. **Cero punto flotante IEEE 754** en toda la capa de persistencia y procesamiento del Edge.
2. **Preservación estricta de la escala canónica de 4 decimales** del Cloud (`DECIMAL(12,4)`), evitando la pérdida irreversible de precisión que ocurriría si se forzara una truncación a centavos enteros (escala 2).
3. **Aritmética entera determinista** y sumas acumulativas exactas en SQLite (`SUM()`, comparaciones `WHERE`, balances de cuentas).
4. **Conversión bidireccional determinista** entre Cloud PostgreSQL `DECIMAL(12,4)` y Edge SQLite sin deriva numérica.
5. **Regla de redondeo comercial uniforme** para cálculo de impuestos y subtotales.

---

## 3. Options Considered

### Option A: `TEXT` con cadenas formateadas (ej. `'150.5000'`)
- *Pros:* Exactitud decimal absoluta, representación directa de `DECIMAL(12,4)`.
- *Cons:* Ineficiencia severa en almacenamiento y procesamiento en SQLite; requiere funciones de extensión o conversión para operaciones de agregación (`SUM(subtotal)`) y comparaciones numéricas; riesgo de errores de ordenamiento lexicográfico si las cadenas difieren en longitud o signo.
- *Verdict:* Rechazada.

### Option B: Declaración `DECIMAL(12,4)` en DDL de SQLite
- *Pros:* Sintaxis familiar coincidente con PostgreSQL.
- *Cons:* SQLite 3 no posee un tipo de dato nativo `DECIMAL`. Asigna a las columnas con afinidad `DECIMAL` la afinidad `NUMERIC`. Al insertar números con punto flotante desde JavaScript (ej. `150.5`), SQLite los almacena internamente con tipo de almacenamiento `REAL` (IEEE 754), reinstalando inadvertidamente la imprecisión de punto flotante.
- *Verdict:* Rechazada.

### Option C: `INTEGER` en Centavos (Escala 2: factor multiplicador $10^2 = 100$)
- *Pros:* Mapeo directo a centavos de moneda de curso legal ($1.00 = 100$ centavos).
- *Cons:* Destruye la precisión canónica de 4 decimales requerida por la nube (`DECIMAL(12,4)`) para precios unitarios de insumos, overrides de catálogo, factores de merma, tasas de descuento y prorrateos de cuentas divididas; genera errores de redondeo prematuro que impiden la sincronización simétrica e idempotente con Cloud.
- *Verdict:* Rechazada.

### Option D: `INTEGER` Fixed-Point con Escala 4 (Factor Multiplicador $10^4 = 10,000$) — *Seleccionada*
- *Pros:*
  1. **Exactitud 100% Determinista:** Todos los valores monetarios se almacenan como enteros con signo de 64 bits en SQLite (`INTEGER`), representando micro-unidades de escala 4 ($1.0000 = 10,000$).
  2. **Isomorfismo Exacto con Cloud `DECIMAL(12,4)`:** La escala 4 en Edge empata 1:1 con los 4 decimales de PostgreSQL `DECIMAL(12,4)` sin truncación, redondeo intermedio, ni pérdida de precisión.
  3. **Rango de Seguridad Absoluto:** El tipo `INTEGER` de SQLite es un entero de 64 bits con signo (hasta $\pm 9.22 \times 10^{18}$). A escala 4 ($10^4$), soporta transacciones de hasta $\pm 922$ billones de pesos/dólares ($9.22 \times 10^{14}$ unidades monetarias). En JavaScript, los valores caben holgadamente dentro de `Number.MAX_SAFE_INTEGER` ($9 \times 10^{15}$, equivalente a 900 mil millones a escala 4) y se procesan nativamente con `BigInt` para garantizar aritmética libre de desbordamiento.
  4. **Agregaciones Nativas en SQLite:** Las funciones nativas `SUM()`, `AVG()`, `MIN()`, `MAX()` y los operadores de comparación sobre `INTEGER` son computacionalmente óptimos y matemáticamente exactos.
- *Verdict:* **Seleccionada como estándar canónico oficial.**

---

## 4. Decision

Se establece como **norma arquitectónica obligatoria e inmutable**:

### 4.1 Representación Física en SQLite
En todos los esquemas locales de Edge SQLite (incluyendo `cuentas`, `cuenta_items`, `cuenta_item_modificadores`, `turnos_caja`, `pagos` y catálogos en caché), **todas las columnas monetarias, tasas de impuesto y cantidades fraccionarias se declaran como `INTEGER NOT NULL`** con escala fija de **4 decimales** (factor de escala $S = 10,000$).

Queda **terminantemente prohibido** el uso de `REAL`, `FLOAT` o números flotantes de JavaScript en cualquier esquema, consulta o payload de base de datos Edge.

### 4.2 Escalas Canónicas
| Concepto | Escala ($10^N$) | Divisor / Factor | Ejemplo Decimal | Ejemplo SQLite `INTEGER` |
|---|---|---|---|---|
| **Importes Monetarios** (subtotal, total, propinas, descuentos) | 4 | $10,000$ | `$150.5000` | `1505000` |
| **Precios Unitarios** (`unit_price_applied`) | 4 | $10,000$ | `$45.0000` | `450000` |
| **Precios de Modificadores** (`modifier_price_applied`) | 4 | $10,000$ | `$8.5000` | `85000` |
| **Tasas Impositivas** (`tax_rate_applied`, ej. IVA 16%) | 4 | $10,000$ | `0.1600` (16%) | `1600` |
| **Cantidades Fraccionarias** (`quantity`, insumos/recetas) | 4 | $10,000$ | `1.0000` unidad | `10000` |
| **Cantidades Fraccionarias** (`quantity`, ej. 250 g) | 4 | $10,000$ | `0.2500` kg | `2500` |

### 4.3 Regla de Redondeo y Secuencia de Aritmética Comercial
Para prevenir discrepancias de redondeo entre partidas individuales y totales de cuenta:
1. **Aritmética de Partida (`cuenta_items`):**
   $$\text{subtotal\_cents4} = \left\lfloor \frac{\text{unit\_price\_applied} \times \text{quantity} + 5,000}{10,000} \right\rfloor$$
   $$\text{net\_subtotal\_cents4} = \text{subtotal\_cents4} - \text{discount\_amount\_applied}$$
   $$\text{tax\_amount\_applied} = \left\lfloor \frac{\text{net\_subtotal\_cents4} \times \text{tax\_rate\_applied} + 5,000}{10,000} \right\rfloor$$
   $$\text{total\_cents4} = \text{net\_subtotal\_cents4} + \text{tax\_amount\_applied}$$
2. **Modo de Redondeo Oficial:**
   Se adopta **Half Away From Zero** (redondeo comercial estándar / SAT México), computado exactamente mediante división entera:
   $$\text{roundDiv}(A, B) = \text{sign}(A \cdot B) \times \left\lfloor \frac{|A| + \lfloor |B| / 2 \rfloor}{|B|} \right\rfloor$$
   Para división entre $10,000$ con números positivos: `(valor + 5000n) / 10000n`.
3. **Totales del Agregado de Cuenta (`cuentas`):**
   Los totales de la cuenta (`subtotal`, `tax_total`, `discounts_total`, `total_amount`) se calculan como la **suma entera exacta** de los valores correspondientes de sus partidas hijas (`cuenta_items`). El total nunca se recalcula aplicando la tasa impositiva globalmente al subtotal de la cuenta, garantizando que:
   $$\text{total\_amount} \equiv \sum \text{partidas.total}$$

### 4.4 Frontera de Conversión y Serialización
1. **Edge SQLite $\leftrightarrow$ Dominio TypeScript:**
   Se procesa internamente como enteros de 64 bits (`bigint` o `number` seguro).
2. **Dominio $\leftrightarrow$ API Transport (Fastify REST / WebSockets):**
   En payloads JSON expuestos a clientes LAN o sincronización Cloud, los valores monetarios se transmiten con su representación decimal canónica formateada a 4 decimales fijos como string (ej. `"150.5000"`), o como número entero de escala 4 documentado.
3. **Edge $\leftrightarrow$ Cloud Sync:**
   El motor de sincronización (`@trident/sync`) mapea `INTEGER` (escala 4) $\leftrightarrow$ PostgreSQL `DECIMAL(12,4)` de forma determinista y sin pérdida:
   $$\text{decimalStr} = \frac{\text{cents4}}{10000.0} \to \text{toExponential/toFixed(4)}$$

### 4.5 Objeto de Valor Canónico en `@trident/core`
Se define el contrato del Value Object `Money` en Platform Core (`@trident/core`), con representación inmutable basada en `bigint` a escala 4 ($10^4$), prohibiendo la instanciación con tipos flotantes no sanitizados.

---

## 5. Consequences

### Positive
- Se elimina de forma definitiva el riesgo de errores de redondeo de punto flotante en el POS local.
- Alineación 100% exacta y reversible con la base de datos central PostgreSQL en Supabase (`DECIMAL(12,4)`).
- Rendimiento ultra-rápido en SQLite al operar exclusivamente con tipos `INTEGER` de 64 bits.
- Cumplimiento estricto con las exigencias de auditoría contable y timbrado fiscal del SAT.

### Negative / Trade-offs
- Requiere multiplicar por $10,000$ en la ingesta y dividir por $10,000$ en la presentación gráfica al usuario.
- Los desarrolladores deben evitar el uso inadvertido del operador flotante `/` de JavaScript, utilizando el Value Object `Money` o división entera.

### Migration Impact
- **Impacto: Cero en producción.** Ninguna base de datos de producción ha sido desplegada con tablas monetarias en Edge. Las tablas de `WP-014` aún no existen.
- **Impacto en Documentación:** Se actualizan formalmente `DATA_MODEL.md` (Sec. 3), `DATA_DICTIONARY.md` (Sec. 1.2), `DATA_ARCHITECTURE.md` (Sec. 3) y `TECH_STACK_DECISIONS.md` para reflejar la sustitución de `REAL` por `INTEGER` (escala 4).

---

## 6. Validation Obligations
1. Pruebas unitarias de aritmética monetaria en `@trident/core` demostrando exactitud en sumas, restas y divisiones con redondeo comercial.
2. Pruebas de integración en `WP-014` verificando que las columnas SQLite de `cuentas` y `cuenta_items` se persisten y leen como `INTEGER` exactos sin truncación ni deriva.
