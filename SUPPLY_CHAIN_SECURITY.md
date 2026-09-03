# SUPPLY CHAIN & RELEASE SECURITY SPECIFICATION — ERP RESTAURANTES

**Document ID:** `ARCH-SUP-001`  
**Version:** `1.0 DRAFT`  
**Status:** `READY FOR INDEPENDENT REVIEW`  
**Date:** 2026-09-01  
**Framework:** `EAAF v1.2.0 @ 7e036f43240b3dc28ccb996e350263598275b2cd`  
**Author Agent:** `08_Security_Architect`  
**Approved Baseline Commit:** `9d076c1a8f674b2411991b20fa4faa83b85f708a` (Tag `data-architecture-v1.0-approved`)  

---

## 1. Integridad de la Cadena de Suministro de Software (Supply Chain)

Para prevenir la introducción de dependencias maliciosas o vulnerabilidades conocidas:
1. **Lockfiles Estrictos:** Inclusión obligatoria de `package-lock.json` verificado mediante `npm ci` en todos los entornos de construcción.
2. **Escaneo Automatizado de Dependencias:** Integración en pipelines CI/CD de análisis de vulnerabilidades (SCA) y escaneo de secretos antes de compilar.
3. **Generación de SBOM (Software Bill of Materials):** Generación de inventario en formato SPDX o CycloneDX con cada versión de producción.

---

## 2. Protocolo de Confianza para Actualizaciones de Electron (Secure Auto-Updates)

Para validar que los instaladores y actualizaciones remotas distribuidas a los servidores de sucursal provienen exclusivamente de fuentes autorizadas:

```mermaid
sequenceDiagram
    autonumber
    participant CI as Pipeline CI/CD Corporativo
    participant Release as Servidor de Releases (S3 Seguro)
    participant Edge as Edge Server Host (Electron)

    CI->>CI: Compilar binario Electron
    CI->>CI: Firmar binario con Certificado de Código (Code Signing RSA/Ed25519)
    CI->>CI: Generar archivo `latest.yml` con SHA-512 y firma digital
    CI->>Release: Publicar binario firmado y metadatos
    
    Note over Release,Edge: Detección y Descarga de Actualización
    Edge->>Release: Consultar `latest.yml`
    Edge->>Edge: Validar firma digital de `latest.yml`
    Edge->>Release: Descargar paquete de actualización
    Edge->>Edge: Validar SHA-512 y firma criptográfica del instalador
    alt Firma Válida
        Edge->>Edge: Aplicar actualización de forma atómica y reiniciar
    else Firma Inválida o Paquete Corrupto
        Edge->>Edge: Descartar paquete, abortar instalación y emitir alerta
    end
```

---

DOCUMENT STATUS: READY FOR INDEPENDENT REVIEW
