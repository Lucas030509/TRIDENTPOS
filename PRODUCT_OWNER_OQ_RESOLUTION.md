# PRODUCT OWNER — RESOLUCIÓN DE CUESTIONES ABIERTAS (OQ)

**Document ID:** `ARCH-DEC-002`
**Status:** `APPROVED — PRODUCT_OWNER_HUMAN`
**Authority:** Simón Sánchez (Product Owner)
**Date:** 2026-10-06
**Governing framework:** EAAF v1.3.0 + Lean Delivery Profile (ACR-2026-021, §2.8 batched PO decisions)
**Resolves:** `OPEN_QUESTIONS.md` §3 (9/9). `OPEN_QUESTIONS.md` and `PRODUCT_DECISIONS.md` remain frozen; this record is additive and continues the series from `DEC-009`.

Each decision fills a policy point that the architecture already left open as a neutral extension point. No ADR, data-ownership or bounded-context boundary changes. Implementation follows the owning Work Package and its risk class under the Lean profile.

---

## Resumen

| ID      | OQ         | Decisión                                                         | WP afectados                           |
| ------- | ---------- | ---------------------------------------------------------------- | -------------------------------------- |
| DEC-010 | OQ-SSOT-01 | Cancelación post-cocina según estado en KDS                      | WP-014/014A, WP-015, WP-018, WP-026B/C |
| DEC-011 | OQ-SSOT-02 | Transferencia de cuenta con PIN del mesero receptor              | WP-014A, WP-025, WP-026B               |
| DEC-012 | OQ-SSOT-03 | Sobregiro de crédito solo con override de gerente                | WP-016C, WP-020, WP-026D               |
| DEC-013 | OQ-SSOT-04 | Cancelación de cuenta impresa desde móvil con PIN de gerente     | WP-014A, WP-025                        |
| DEC-014 | OQ-SSOT-05 | Sugerencia de compras: mínimo/máximo y consumo promedio, ambas   | WP-019                                 |
| DEC-015 | OQ-SSOT-06 | Prorrateo proporcional de descuentos y propinas al dividir       | WP-014A, WP-016C, WP-026D              |
| DEC-016 | OQ-SSOT-07 | Modificadores aditivos y sustractivos en la explosión de recetas | WP-017, WP-018                         |
| DEC-017 | OQ-ARCH-01 | Turno de caja compartido con PIN por cobro                       | WP-016, WP-016C, WP-026D               |
| DEC-018 | OQ-ARCH-02 | Factura global manual asistida                                   | WP-021 (batch), WP-024                 |

---

### DEC-010 — Cancelación post-cocina según estado en KDS (OQ-SSOT-01)

- **Regla:**
  1. Ítem enviado a cocina **sin iniciar** en KDS: mesero o cajero puede cancelar con motivo obligatorio del catálogo. No genera merma.
  2. Ítem **en preparación o listo**: requiere PIN de supervisor/gerente, motivo obligatorio y genera automáticamente una merma (`MERMA`) por la receta consumida, ligada a la cancelación.
  3. Ítem **entregado**: mismo tratamiento que el punto 2.
- **Arquitectura:** el estado del ítem en KDS decide la política; la merma usa el ledger canónico (`stock_ledger`) con idempotencia. La cancelación y la autorización se auditan (usuario, autorizador, motivo, terminal).

### DEC-011 — Transferencia de cuenta con PIN del receptor (OQ-SSOT-02)

- **Regla:** el mesero emisor elige al receptor; la transferencia se aplica solo cuando el receptor ingresa su PIN. Si lo rechaza o no confirma, la cuenta sigue con el emisor.
- **Arquitectura:** el comando de transferencia exige la credencial del receptor; el historial de la comanda y la atribución de propinas registran ambos meseros y el momento de la transferencia.

### DEC-012 — Sobregiro de crédito con override de gerente (OQ-SSOT-03)

- **Regla:** si el cobro con "Crédito a Cliente" excede el crédito disponible, el POS advierte y solo permite completar el cobro con PIN de gerente. Sin override, el cobro se rechaza.
- **Arquitectura:** la verificación del saldo ocurre del lado del servidor (Finance); el override es un evento auditado con monto excedido, autorizador y cliente.

### DEC-013 — Cancelación de cuenta impresa desde móvil con PIN de gerente (OQ-SSOT-04)

- **Regla:** una cuenta con precuenta impresa (folio asignado) puede cancelarse desde el comandero solo con PIN de gerente y motivo obligatorio. El folio se anula, no se reutiliza.
- **Arquitectura:** el evento de anulación exige motivo y token de autorización; se audita la terminal móvil, el solicitante y el autorizador.

### DEC-014 — Sugerencia de compras con ambas estrategias (OQ-SSOT-05)

- **Regla:** se soportan las dos estrategias, configurables por insumo y sucursal:
  - **Mínimo/máximo:** si existencia ≤ mínimo, sugerir `máximo − existencia`.
  - **Consumo promedio:** consumo diario promedio de los últimos N días × tiempo de entrega del proveedor (+ stock de seguridad configurable).
- **Default (supuesto del Orquestador, confirmar):** mínimo/máximo cuando no hay historial suficiente; el usuario puede cambiar a consumo promedio por insumo.
- **Arquitectura:** la estrategia es intercambiable dentro de Procurement (`replenishment-provider`); la sugerencia no genera orden de compra sin confirmación humana.

### DEC-015 — Prorrateo proporcional al dividir cuenta (OQ-SSOT-06)

- **Regla:** al dividir, los descuentos generales, propinas y cargos se reparten de forma proporcional al subtotal de cada subcuenta. El residuo de redondeo se asigna a la última subcuenta, de modo que la suma de las subcuentas es exactamente igual al total original.
- **Arquitectura:** cálculo con aritmética exacta de punto fijo (ADR-012); prueba de invariante: Σ subcuentas = total original.

### DEC-016 — Modificadores aditivos y sustractivos (OQ-SSOT-07)

- **Regla:** los modificadores "Extra X" suman los insumos de su receta; los modificadores "Sin X" restan el gramaje de X definido en la receta base, sin bajar de cero.
- **Arquitectura:** el motor de explosión de recetas consume `selectedModifiers[]` del evento de KDS; cada modificador debe declarar tipo (aditivo/sustractivo) e insumo afectado. Cierra `OQ-SSOT-07`, que seguía abierta según ACR-2026-017.

### DEC-017 — Turno de caja compartido con PIN por cobro (OQ-ARCH-01)

- **Regla:** varios operadores autorizados pueden cobrar en la misma caja durante un turno, con fondo y arqueo mancomunados. Cada cobro exige el PIN del operador y queda ligado a su usuario. El turno tiene un responsable de apertura y cierre; los cortes X/Z muestran el total del turno y el desglose por operador.
- **Arquitectura:** el agregado `TurnoCaja` admite operadores participantes; cada pago guarda `operator_user_id`. Cambio de modelo en el dominio de caja (RC3, revisión de Data y Security dentro del WP).

### DEC-018 — Factura global manual asistida (OQ-ARCH-02)

- **Regla:** el administrador revisa en pantalla los folios no facturados del periodo y genera la factura global al público en general. No hay timbrado automático programado.
- **Arquitectura:** usa la capacidad de lote de Billing (consulta de candidatos ya existente); el timbrado sigue sujeto al kill switch `FISCAL_STAMPING_ENABLED` y a GD-001..003. La periodicidad y los plazos se validan con el contador antes de activar el timbrado. La versión automática programada queda como evolución futura y requerirá su propia decisión.

---

## Estado formal

```
OPEN_QUESTIONS_RESOLVED=9/9
AUTHORITY=PRODUCT_OWNER_HUMAN
ARCHITECTURE_CHANGE=NO (policy points only)
ADR_CHANGE=NO
PAC_SELECTED=NO
FISCAL_STAMPING_FLAG=OFF
OQ_ARCH_02=RESOLVED (manual assisted; automatic scheduling not authorized)
```
