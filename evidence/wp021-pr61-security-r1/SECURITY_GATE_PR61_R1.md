# WP-021 PR61 — Security Gate, ronda 1 técnica
Fecha: 2026-10-05
Revisor independiente: 08_Security_Architect
Framework: EAAF v1.3.0 @ 167cea36c09c1031c763971ff790db2e0d0f7362 + Lean §5.A/§5.B.
Sujeto: 043673f5b01dbbf36602060ba4428f059b024769
Árbol: ab10943b3cb3a65e6c5b97e18469ef452ac777ad
Padres: 9992db056672eb3947606595e29d6bb7a533774e; deccca26f86b1800d4d0bdbc769caece4fb4d282.
PR: Lucas030509/TRIDENTPOS #61; rama feat/wp-021-security-remediation-r7.
Veredicto: BLOCK
Backend: GIT_SIDECAR, separado del sujeto sobre main deccca26f86b1800d4d0bdbc769caece4fb4d282.
IDs bloqueantes: SEC-WP021-R4-HIGH-04; SEC-PR61-R1-HIGH04-A6; SEC-PR61-R1-HIGH04-A7.

## Corrección de identidad y custodia
La autoridad humana corrigió el sujeto en esta conversación: 043673f4e242… fue transcripción errónea. El HOLD previo a97b49ae7127612d3114d677195b6976c631ea5f se conserva como histórico; su obstáculo de identidad queda resuelto para esta revisión. La interrupción previa no fue ronda técnica.
ZIP recibido SHA-256 bed158d358be63464b9563652f83c762f534e4e7815a8ec3b38bffaf94e84f83, digest verificado y los cinco hashes del manifiesto coincidentes. Contiene 22/22 nativas, PITR físico y concurrencia PASS declarados por tercero; no es un veredicto. El texto del ZIP aún contiene SHA erróneo: no se lo reescribe ni se presume vinculación histórica probada por hashes del checkout.
Identidad del commit corregido comprobada por API GitHub, incluidas tree y parents. Código y tests leídos a ese SHA. CI run 37372630950 asociado al HEAD, job unit-tests 111973305601 success: log leído muestra las 22 pruebas WP021 ejecutadas, sin skips (23/23 agregado con una prueba WP013). Esto aporta corroboración nativa ligada al PR; no equivale a CI global PASS. Ambos runs 37372630950/37372630920 tienen conclusion failure; otros jobs aparecen cancelled.
Registros de PITR/concurrencia del ZIP se evalúan como evidencia externa con limitación de vinculación; no fueron reejecutados aquí. No se recibió un ZIP v2 en esta activación.

## Tabla por hallazgo y decisión del mismo Security Gate (§5.B)
| Hallazgo | Disposición | Evidencia y límites |
|---|---|---|
| HIGH-02 | RE-ACOTADO a STAGING_GATE y antes de migración sobre instalación poblada o activación fiscal en cualquier entorno | tests/native/wp021-pitr.mjs contiene pg_basebackup, archive/WAL, recovery.signal, target time, promoción y comprobaciones de versión/hash/identidad en operaciones/outbox/inbox; pitr.log evidencia recuperación real de clúster. No acredita migración de datos existentes: aplica todas las migraciones en vacío antes de poblar. Exit: ejecución ligada a SHA/árbol, migración desde esquema anterior poblado y comparación completa de envelopes pre/post, más PITR físico y correlación. Contención: flag OFF, sin PAC ni staging/producción; operaciones instaladas fuera del alcance PO. No se declara PITR NOT EXECUTED para el tercero ni PASS de staging. |
| HIGH-03 | RE-ACOTADO a STAGING_GATE y antes de cualquier DOWN en instalación | guards reales contienen row_security=off, ACCESS EXCLUSIVE, rechazo de tablas pobladas; integración nativa/CI prueba DOWN fiscal y RLS. tests/native/wp021-concurrency.mjs ejecuta SQL copiado para inbox/operaciones, no el Down real de 20261002000000_wp021_consumer_restore_marker.sql. Exit: ejecutar SQL DOWN real de cada migración relevante bajo rol instalado no-bypass y escritor concurrente, incluyendo marker aislado, filas ocultas RLS, rechazo sin pérdidas y sesión limpia. Este Gate conserva la obligación; no la cierra por el log genérico. |
| HIGH-04 | ABIERTO — BLOCK | Casos originales A1 valor de complemento y A2 separación de atributos/raw ampersand endurecidos, pero A6/A7 reproducidos abajo conservan el defecto de integridad y well-formedness. |
| HIGH-06 | CERRADO dentro del contrato revisado | index.ts processEventWithInbox/reconcileConsumerRestore rechaza EXTERNAL, transacción SQL/inbox, verifyEffect, conflicto de envelope; marker por tenant/context bloquea delivery ordinario y se conserva tras error. Migración marker ENABLE/FORCE RLS y política USING/WITH CHECK. CI prueba bloqueo, éxito/verificación/duplicate, fallo y aislamiento. No acredita efectos externos productivos ni detección automática de restore; consumidor-only inconsistente permanece bloqueado, conducta permitida. |
| HIGH-07 | RE-ACOTADO a STAGING_GATE y antes de activar fiscal en cualquier entorno | .github/workflows/ci.yml configura WP021_SECURITY_TEST_DATABASE_URL; CI ejecuta 22 pruebas WP021 sin skip. No prueba cobertura exhaustiva uno-a-uno REQ75..92 ni PITR/concurrencia scripts en CI; su invocación no existe en ci.yml. Exit: matriz requisito→caso ejecutable, evidencia nativa del SHA de release, incluyendo migración poblada, scripts reales y recuperaciones. No confundir prueba SQL llamada Native PITR/Migration con el script físico. |
| HIGH-01 | CERRADO dentro del alcance revisado; sin regresión demostrada | pac-connector.ts authorizePacCapabilityUse valida digest de bytes, ámbito, autoridades/firmas, revocación fresca y secuencia; llamadas cloud preceden usos y validan evidencia correlacionada. Nada acredita proveedor/registro productivo. |
| HIGH-05 | CERRADO dentro del alcance revisado; sin regresión demostrada | index.ts upsertEmisorConfig allowlist, rechazo PEM y referencias opacas; integración/CI verifica rechazo previo a persistencia y ausencia PEM en DTO. |
| MED-01 | CERRADO dentro del alcance revisado; sin regresión demostrada | sanitización fiscal opaca preservada; integración/CI verifica error JSON/multilínea en rutas persistidas/externas. |
| Kill switch | OFF por defecto verificado estáticamente; nuevo STAMP/CANCEL fail-closed antes de INSERT/PAC/CSD | index.ts constructor ~4632 acepta solo true o "true"; guard ~5295/~5976 antes de nueva operación y acceso CSD. Operaciones existentes siguen ruta de reconciliación/replay contractual; OFF no es prohibición universal de acceso PAC. No se acredita runtime de despliegue ni PAC. |

Las tres re-acotaciones son decisiones explícitas de 08_Security_Architect sobre este nuevo SHA, no aceptación de riesgo ni cierre ficticio de evidencia. No levantan BLOCK de HIGH04. Deben registrarse como obligaciones del Gate posterior citando este sidecar por Coordinator; aquí no se modifica el manifest ni el registro del sujeto.

## Defectos reproducidos — esperado REJECTED, actual ACCEPTED
SEC-PR61-R1-HIGH04-A6 (HIGH): XML certificado mal formado aceptado.
Cita: packages/billing/src/xml-validator.ts parseNode, tagContent .trim(), y parseAttributes rawVal.
Reproducción: validar CFDI control válido con expectedOriginalXml válido; luego añadir espacio entre "<" y "cfdi:Comprobante" en XML certificado. validateAndExtractTimbreFiscalDigital retorna éxito. parseXmlStructure también acepta "< Root/>" y referencia al carácter nulo "&#0;".
Riesgo: parser acepta XML que no es well-formed como éxito fiscal; diferentes parsers pueden rechazarlo o interpretarlo de forma distinta.
Cierre verificable: control legítimo continúa aceptado; ambos casos mal formados son rechazados por validador público y ruta fiscal antes de estado terminal/outbox.

SEC-PR61-R1-HIGH04-A7 (HIGH): reubicación de texto de complemento aceptada.
Cita: xml-validator.ts parseNode acumula node.content independientemente de children; validateAndExtractTimbreFiscalDigital normalize compara esa representación con pérdida de orden.
Original: <p:Data xmlns:p="urn:example">before<p:Child/>after</p:Data>.
Alterado: <p:Data xmlns:p="urn:example">before after<p:Child/></p:Data>, más inserción legítima de TFD.
Actual: ACCEPTED, porque ambos normalizan content="before after" y mismos children.
Riesgo: cambio de complemento respecto del XML original no se detecta; no se afirma validez SAT del complemento de ejemplo ni explotación de proveedor, se demuestra fallo del comparador estructural del contrato.
Cierre verificable: reubicación/alteración de texto y orden de contenido en cualquier complemento original rechazada; inserción exclusiva de TFD válida continúa aceptada.

Ejecución propia: Node v24.19.0, fuente del SHA leído en copia aislada, solo import local errors.js→errors.ts para type stripping. Ningún cambio al candidato. Resultado:
control ACCEPTED
malformed_certified ACCEPTED
A2_numeric_null ACCEPTED
A2_tag_whitespace ACCEPTED
A1_mixed_content_relocation ACCEPTED
Script exacto reproducible acompañante: HIGH04_REPRO.mjs. No reejecución propia de PostgreSQL; ejecución externa y CI identificadas por separado.

## Advisories
ADV-PR61-01: auditoría de rechazo por kill switch usa catch vacío; documentar observabilidad de fallos del sink. No prueba bypass por sí misma.
ADV-PR61-02: runbook antes de STAGING debe fijar registro durable del marker antes de delivery, autoridad para reconciliar, horizon/retención/fuente y operación fail-closed para consumidor-only con inbox retenido. No se acredita fuente de replay productiva.
ADV-PR61-03: scripts nativos devuelven exit 0 con NOT EXECUTED si faltan binarios. CI que los incorpore deberá distinguir ejecución efectiva de skip; actualmente el CI no los invoca.
ADV-PR61-04: completar required CI checks sobre release SHA; éxito unit-tests no es verde global.
ADV-PR61-05: pruebas de integración usan mocks y registries de test; no acreditan PAC, registro ni CSD operativos.

## Persistencia y límites
SHA-256 del informe en SECURITY_GATE_PR61_R1.md.sha256, calculado sobre bytes UTF-8; no digest autorreferencial. Comentario PR solo notificación vinculada al SHA correcto.
STOP → Governance Coordinator, con BLOCK y dos reproducciones dentro de HIGH04. No activación automática Builder ni tercera ronda; ciclo máximo dos conforme decisión humana aplicable.
PAC_SELECTED=NO; OQ_ARCH_02=OPEN. Sin merge, despliegue, cambio arquitectónico ni aceptación de riesgo.
