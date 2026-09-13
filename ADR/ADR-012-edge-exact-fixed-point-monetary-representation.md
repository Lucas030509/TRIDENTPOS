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
  1. **Exactitud 100% Determinista:** Todos los valores monetarios se almacenan como enteros con signo de 64 bits en SQLite (`INTEGER`), representando unidades fixed-point de escala 4 (diezmilésimas, $1.0000 = 10,000$).
  2. **Isomorfismo Exacto con Cloud `DECIMAL(12,4)`:** La escala 4 en Edge empata 1:1 con los 4 decimales de PostgreSQL `DECIMAL(12,4)` sin truncación, redondeo intermedio, ni pérdida de precisión.
  3. **Rango Común Interoperable y Autoridad de BigInt:** 
     - El rango canónico interoperable está gobernado por el tipo más restrictivo: Cloud PostgreSQL `DECIMAL(12,4)` (12 dígitos decimales totales, 4 fraccionarios, 8 enteros), lo que delimita estrictamente el rango de importes a $[-99,999,999.9999, +99,999,999.9999]$. En Edge SQLite a escala 4, esto equivale al rango de enteros $[-999999999999, +999999999999]$ ($[-999\_999\_999\_999\text{n}, +999\_999\_999\_999\text{n}]$).
     - Se define validación de límites antes de la persistencia, aceptación de resultados aritméticos, sincronización y serialización Cloud.
     - Toda la aritmética en el dominio TypeScript se ejecuta exclusivamente con `bigint`. Debido a que la multiplicación a escala 4 genera productos intermedios a escala 8, se prohíbe el uso de `number` de JavaScript para aritmética financiera autoritativa a fin de prevenir desbordamientos de precisión.
  4. **Semántica de Agregaciones en SQLite:**
     - *Permitidas para operaciones autoritativas de punto fijo:* `MIN(integer)`, `MAX(integer)` y `SUM(integer)`, siempre que cada entrada sea `INTEGER`, que los límites de la aplicación/base de datos garanticen ausencia de desbordamiento de 64 bits con signo, y que cualquier desbordamiento sea tratado como falla explícita.
     - *Prohibidas para cálculo monetario autoritativo:* `AVG()` y `TOTAL()`, debido a que SQLite retorna números en punto flotante (`REAL`). Cuando se requiera un promedio, debe computarse como `sumScale4 = SUM(col)`, `count = COUNT(col)` y `averageScale4 = roundDiv(sumScale4, count)` utilizando la primitiva canónica de redondeo con BigInt.
- *Verdict:* **Seleccionada como estándar canónico oficial.**

---

## 4. Decision

Se establece como **norma arquitectónica obligatoria e inmutable**:

### 4.1 Representación Física en SQLite y Gobernanza de Nulabilidad
Todos los valores numéricos monetarios, tasas impositivas y cantidades fraccionarias persistidos en Edge SQLite se almacenan como `INTEGER` con escala fija de **4 decimales** (factor de escala $S = 10,000$).

La nulabilidad de las columnas permanece gobernada por el ciclo de vida y el modelo de datos de cada campo individual. Los campos de balance transaccional y totales de partida son `INTEGER NOT NULL`. Por el contrario, los campos cuyo ciclo de vida exige que no estén disponibles antes de un evento de negocio (por ejemplo, en `turnos_caja`: `closing_declared_cash`, `calculated_cash_total` y `cash_difference`) permanecen como `INTEGER NULL` durante el turno abierto y solo se asignan al momento del arqueo y cierre.

Queda **terminantemente prohibido** el uso de `REAL`, `FLOAT` o números flotantes de JavaScript en cualquier esquema, consulta o payload de base de datos Edge.

### 4.2 Escalas Canónicas y Taxonomía de Precisión Cloud
Se distingue formalmente la precisión entre conceptos de negocio:
- **Importes Monetarios, Precios Unitarios, Costos y Cantidades:** En Cloud se definen como `DECIMAL(12,4)`; en Edge SQLite se almacenan como `INTEGER` escala 4 ($S = 10,000$).
- **Tasas Impositivas (`tax_rate_applied`):** En Cloud se definen como `DECIMAL(6,4)`; en Edge SQLite se almacenan como `INTEGER` escala 4 ($S = 10,000$, ej. 16% IVA = `1600`).
- **Otras Razones y Factores Gobernados:** Utilizan su precisión explícita congelada en Cloud; en Edge se representan como `INTEGER` escala 4.

| Concepto | Escala ($10^N$) | Divisor / Factor | Tipo Cloud | Ejemplo Decimal Canónico | Ejemplo SQLite `INTEGER` |
|---|---|---|---|---|---|
| **Importes Monetarios** (subtotal, total, propinas, descuentos) | 4 | $10,000$ | `DECIMAL(12,4)` | `"150.5000"` | `1505000` |
| **Precios Unitarios** (`unit_price_applied`) | 4 | $10,000$ | `DECIMAL(12,4)` | `"45.0000"` | `450000` |
| **Precios de Modificadores** (`modifier_price_applied`) | 4 | $10,000$ | `DECIMAL(12,4)` | `"8.5000"` | `85000` |
| **Tasas Impositivas** (`tax_rate_applied`, IVA 16%) | 4 | $10,000$ | `DECIMAL(6,4)` | `"0.1600"` | `1600` |
| **Cantidades Fraccionarias** (`quantity`, insumos/recetas) | 4 | $10,000$ | `DECIMAL(12,4)` | `"1.0000"` | `10000` |
| **Cantidades Fraccionarias** (`quantity`, ej. 250 g) | 4 | $10,000$ | `DECIMAL(12,4)` | `"0.2500"` | `2500` |

### 4.3 Regla de Redondeo y Secuencia de Aritmética Comercial
Se establece **Half Away From Zero** como el **MODO DE REDONDEO CANÓNICO DEL PROYECTO** (Project Canonical Rounding Mode).

1. **Primitiva Genérica de Redondeo Sign-Safe (`roundDiv`):**
   $$\text{roundDiv}(A, B) = \text{sign}(A \times B) \times \left\lfloor \frac{|A| + \lfloor |B| / 2 \rfloor}{|B|} \right\rfloor \quad (\text{con } B \neq 0)$$
   
   En TypeScript con `bigint`:
   ```typescript
   export function roundDiv(a: bigint, b: bigint): bigint {
     if (b === 0n) throw new RangeError("Division by zero");
     const sign = (a < 0n !== b < 0n) ? -1n : 1n;
     const absA = a < 0n ? -a : a;
     const absB = b < 0n ? -b : b;
     const halfB = absB / 2n;
     const quotient = (absA + halfB) / absB;
     return sign * quotient;
   }
   ```
   *Vectores de prueba normativos obligatorios:*
   - `roundDiv(  5000n, 10000n) =  1n`
   - `roundDiv( -5000n, 10000n) = -1n`
   - `roundDiv( 14999n, 10000n) =  1n`
   - `roundDiv(-14999n, 10000n) = -1n`
   - `roundDiv( 15000n, 10000n) =  2n`
   - `roundDiv(-15000n, 10000n) = -2n`

2. **Aritmética de Partida (`cuenta_items`):**
   $$\text{lineSubtotal} = \text{roundDiv}(\text{unitPriceScale4} \times \text{quantityScale4}, 10000\text{n})$$
   $$\text{netSubtotal} = \text{lineSubtotal} - \text{discountAmountScale4}$$
   $$\text{taxAmount} = \text{roundDiv}(\text{netSubtotal} \times \text{taxRateScale4}, 10000\text{n})$$
   $$\text{lineTotal} = \text{netSubtotal} + \text{taxAmount}$$

3. **Totales del Agregado de Cuenta (`cuentas`):**
   Los totales de la cuenta (`subtotal`, `tax_total`, `discounts_total`, `total_amount`) se calculan **exclusivamente como la suma entera exacta** de los valores de sus partidas hijas (`cuenta_items`). El total de la cuenta nunca se recalcula aplicando la tasa impositiva globalmente al subtotal de la cuenta:
   $$\text{cuentas.total\_amount} \equiv \sum \text{cuenta\_items.total}$$

### 4.4 Frontera de Conversión y Transporte Libre de Punto Flotante
Se define una representación autoritativa por capa:
- **SQLite:** `signed INTEGER` escala 4.
- **Dominio TypeScript:** `bigint` escala 4.
- **Transporte API y Sincronización:** `STRING` decimal canónico con exactamente 4 dígitos fraccionarios (ej. `"150.5000"`).
- **PostgreSQL Cloud:** `DECIMAL/NUMERIC` según la precisión gobernada (`DECIMAL(12,4)` o `DECIMAL(6,4)`).

1. **Conversión Scaled Integer $\to$ Decimal String (Sin Punto Flotante):**
   ```typescript
   export function scaledBigIntToDecimalString(scaled: bigint): string {
     const sign = scaled < 0n ? "-" : "";
     const abs = scaled < 0n ? -scaled : scaled;
     const whole = abs / 10000n;
     const fraction = abs % 10000n;
     return `${sign}${whole.toString()}.${fraction.toString().padStart(4, "0")}`;
   }
   ```
   *Ejemplos:*
   - `1505000n` $\to$ `"150.5000"`
   - `1n` $\to$ `"0.0001"`
   - `-1n` $\to$ `"-0.0001"`
   - `-1505000n` $\to$ `"-150.5000"`

2. **Conversión Decimal String $\to$ Scaled BigInt (Parsing Léxico Estricto):**
   Se realiza mediante análisis sintáctico léxico de cadena. Se valida contra la expresión regular `/^-?\d+\.\d{4}$/`, extrayendo signo, parte entera y los 4 dígitos fraccionarios para componer `(whole * 10000n + fraction) * sign`.
   Queda **estrictamente prohibido** el uso de:
   - `Number()`
   - `parseFloat()`
   - `parseInt(decimal * 10000)`
   - `/ 10000.0`
   - `toFixed()`
   - `Math.round()`
   para conversiones financieras autoritativas.

3. **Transporte JSON Canónico:**
   En todos los payloads JSON externos de APIs (Fastify REST, WebSockets) y en la sincronización Cloud, la representación canónica externa para valores monetarios y cantidades es **cadena decimal fija de 4 decimales** (`canonical fixed 4-decimal string`). Los enteros escala 4 se permiten internamente únicamente detrás de fronteras de persistencia o dominio explícitamente tipadas.

### 4.5 Objeto de Valor Canónico en `@trident/core`
Se define el contrato del Value Object `Money` en Platform Core (`@trident/core`), con representación inmutable respaldada por `amountScale4: bigint` a escala 4 ($10^4$).

---

## 5. Consequences

### Positive
- Eliminación total y permanente del punto flotante IEEE 754 en toda la persistencia y procesamiento del Edge.
- Alineación 100% exacta y reversible con PostgreSQL en Supabase (`DECIMAL(12,4)` y `DECIMAL(6,4)`).
- Aritmética sign-safe determinista en subtotales, descuentos e impuestos.
- Eliminación de ambigüedades en agregaciones de SQLite y transporte JSON.
- Cumplimiento estricto con las exigencias de auditoría contable y fiscal.

### Negative / Trade-offs
- Requiere parseo y serialización de cadenas en las fronteras de red e interfaces de usuario.
- Requiere uso riguroso de `bigint` en el dominio TypeScript, evitando operadores aritméticos flotantes nativos.

### Migration Impact
- **Impacto: Cero en producción.** Ninguna base de datos de producción ha sido desplegada con tablas monetarias en Edge. Las tablas de `WP-014` aún no existen.
- **Impacto en Documentación:** Se actualizan formalmente `DATA_MODEL.md`, `DATA_DICTIONARY.md`, `DATA_ARCHITECTURE.md` y `TECH_STACK_DECISIONS.md` para reflejar la sustitución de `REAL` por `INTEGER` escala 4 y las reglas de precisión y redondeo.

---

## 6. Validation Obligations
1. Pruebas unitarias en `@trident/core` demostrando la exactitud de `roundDiv` con los 6 vectores normativos y operaciones de `Money` con `bigint`.
2. Pruebas unitarias de serialización/deserialización léxica entre `bigint` y cadenas decimales de 4 dígitos.
3. Pruebas de integración en `WP-014` verificando que las columnas SQLite se persisten y recuperan como `INTEGER` exactos sin truncación ni deriva.
