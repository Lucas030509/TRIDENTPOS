# WP-021 PR61 — Code Review R2 (última)
Revisor: 11_Code_Reviewer
Fecha: 2026-10-06
Framework: EAAF v1.3.0 @ 167cea36c09c1031c763971ff790db2e0d0f7362 + perfil Lean.
Sujeto: 782d50d1622efd2d3030f0d7df8c9eb9b3d657c9
Base de comparación: 043673f5b01dbbf36602060ba4428f059b024769
Antecedente: 2c046fcbab50d7cd7e41e0449af9aa03c0513628, evidence/wp021-pr61-code-review-r1/CODE_REVIEW_CORRECTED.md.
Veredicto: PASS
IDs: BLK-CODE-WP021-R1-01; ADV-CODE-WP021-R1-01; ADV-CODE-WP021-R2-01; ADV-CODE-WP021-R2-02.
Backend: GIT_SIDECAR separado del sujeto, base canónica 21999149e259273eaa99850d683a850626fb1f91.

## Alcance y método
Únicamente diff entre los dos SHAs indicados: cierre del blocker CI nativo, advisory del audit y calidad de dependencia/fronteras/regresiones del diff. Se leyó el antecedente exacto; este rol no sustituye Security ni reabre su dictamen. HEAD observado del PR coincide con el sujeto. No se implementaron cambios ni se modificó el candidato.
Se inspeccionó el compare completo, manifiestos/lockfile, código XML, cambios de telemetry y preflight nativo. Se corroboró ejecución CI en GitHub sobre el SHA final; no se reejecutó localmente el workspace.

## Cierre por hallazgo
### BLK-CODE-WP021-R1-01 — CERRADO
Cita: .github/workflows/ci.yml §jobs.native-postgres, pasos Ensure PostgreSQL 16 binaries in PATH, Run native physical PITR test y Run native multi-connection concurrency test.
Ambos scripts npm se ejecutan expresamente con REQUIRE_NATIVE_PG: '1'. No hay continue-on-error para estos pasos.
Cita: tests/native/wp021-pitr.mjs y tests/native/wp021-concurrency.mjs §requiredBinaries/missingBinaries: cuando falta un ejecutable y REQUIRE_NATIVE_PG === '1', escriben FATAL y process.exit(1); el camino NOT EXECUTED con exit 0 queda solo fuera del modo obligatorio. findBinary verifica acceso X_OK, no solo existencia.
Esperado: ejecución nativa real y fallo si faltan binarios. Actual: código fail-closed y ejecución real aprobada en CI run 37458555256, job native-postgres 112252059976.
Log de ese job: REQUIRE_NATIVE_PG=1 en ambos pasos; PostgreSQL 16.15; All 8 PITR physical assertions PASSED; Physical PITR Test: PASS; Native Concurrency Test: PASS.
El cierre es de ejecución CI, no cierre de los vacíos de cobertura que Security re-acotó a staging.

### ADV-CODE-WP021-R1-01 — CERRADO
Cita: packages/cloud-server/src/index.ts, catch de audit en stampFiscalInvoice y cancelFiscalInvoice (hunks antiguos 5305/5986).
El catch vacío se reemplaza por process.stderr.write con evento FISCAL_KILL_SWITCH_AUDIT_FAILED, operación STAMP/CANCEL y contexto. Se conserva el throw FiscalStampingDisabledError y el rechazo de nuevas operaciones. No se afirma persistencia durable del stderr ni se prueba fallo del logger en ejecución; el cambio de observabilidad solicitado está implementado.
Riesgo residual de mensaje sin sanitizar: advisory R2-02.

## Calidad del diff y regresiones
packages/billing/package.json §dependencies: exclusivamente @trident/core y saxes: "6.0.0"; pin exacto.
package-lock.json: saxes 6.0.0 con integrity SHA512; xmlchars resuelto a 2.2.0 con integrity. La dependencia transitiva declarada por saxes usa ^2.2.0, pero npm ci conserva la resolución exacta del lock.
xml-validator.ts solo importa saxes y errores locales. El parser mantiene estado local por invocación, acumula primer error, rechaza DTD, impone límite de tamaño y conserva orden de texto/elementos para comparar; no añade acceso a red/DB ni dependencias de otros dominios.
graph:check en CI build job 112252060158: 44/44 PASS, cero ciclos runtime y todas las fronteras manifest/test/dev satisfechas.
CI run 37458555256 y Security Scan 37458555174: success sobre el SHA final. Jobs build, lint, typecheck, unit-tests, native-postgres, SAST, secrets, SCA y SBOM success.
No regresión bloqueante demostrada dentro del diff revisado. No se emite cierre Security del XML ni aprobación general de arquitectura.

## Advisories
### ADV-CODE-WP021-R2-01 — skipLibCheck
Cita: packages/billing/tsconfig.json §compilerOptions.
skipLibCheck: true reduce la comprobación de declaraciones de tipos, incluida consistencia entre archivos .d.ts; no elimina la comprobación del código fuente del paquete ni modifica strict global. Evaluado como ADVISORY conforme alcance solicitado. Documentar motivo y considerar retirarlo cuando se resuelva compatibilidad de declaraciones.

### ADV-CODE-WP021-R2-02 — Sanitización de fallo del audit
Cita: packages/cloud-server/src/index.ts nuevos catch del audit.
El log serializa err.message/String(err) sin sanitizer. No se reprodujo exposición de secretos ni se afirma que haya secretos en los mensajes reales; no se convierte en blocker hipotético. Recomendar mensaje/código opaco o sanitizado y conservar operación en metadata del evento durable para facilitar diagnóstico.

## Evidencia externa y limitaciones
ZIP wp021_pr61_r2_verification(1).zip: SHA-256 54d875e0a9d2f2660e5b04f81e44ffbe2dd54879f58e58d2a4f589231cb874a7.
Manifiesto: 6/6 digests verificados. Declara checkout probado f167ab132a8cc649653028db2d51f8c030e30428, no el sujeto final. Comparación f167ab13→782d50d agrega únicamente ACR, aprobación PO, disposición PO y manifest; no cambia los archivos runtime/test/CI. Se conserva esa limitación histórica y no se relabela el ZIP como ejecución del HEAD final.
La evidencia final del cierre CI/graph proviene de los runs GitHub del SHA solicitado, no de una atribución retroactiva del ZIP.
Links:
- https://github.com/Lucas030509/TRIDENTPOS/actions/runs/37458555256
- https://github.com/Lucas030509/TRIDENTPOS/actions/runs/37458555174
- https://github.com/Lucas030509/TRIDENTPOS/actions/runs/37458555256/job/112252059976
- https://github.com/Lucas030509/TRIDENTPOS/actions/runs/37458555256/job/112252060158

## Custodia y handoff
Digest SHA-256 de bytes UTF-8 de este informe en CODE_REVIEW_R2.md.sha256, evitando digest autorreferencial. PR review solo notificación del artefacto y vinculada a SHA final.
Estado: PASS exclusivo Code Review R2. Siguiente destino: Coordinator Synthesis, con Security independiente sobre el mismo SHA y controles de merge aplicables. No merge, staging, producción ni selección PAC ejecutados/autorizados por este review.
PAC_SELECTED=NO; OQ_ARCH_02=OPEN.
