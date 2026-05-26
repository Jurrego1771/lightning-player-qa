# DRM

Feature: protección de contenido (Widevine, PlayReady, FairPlay).

---

## Descripción

El player soporta los tres esquemas DRM principales del ecosistema web. La selección es automática según el browser y la disponibilidad del CDM (Content Decryption Module). El módulo DRM vive en `src/player/drm/` y es invocado por el handler de reproducción una vez que se detecta contenido protegido.

---

## Archivos del player (src/)

- `src/player/drm/` — lógica central DRM: resolución de esquema, manejo de licencias, EME lifecycle.
- `src/player/drm/getDRMSupport.js` — detecta qué esquemas DRM soporta el browser actual (requestMediaKeySystemAccess).
- `src/platform/loadConfig.js` — aplica `protectionData` para DASH, selecciona esquema según `getDRMSupport`.
- `src/api/api.js` — expone el estado DRM si corresponde.

---

## API pública expuesta

No hay API DRM directa en el player público. La configuración se pasa en el objeto config al inicializar:

```typescript
// Config DRM al inicializar loadMSPlayer
{
  drm: {
    widevine?: {
      licenseUrl: string,
      headers?: Record<string, string>   // ej. Authorization token
    },
    playready?: {
      licenseUrl: string,
      headers?: Record<string, string>
    },
    fairplay?: {
      certificateUrl: string,            // obligatorio para FairPlay
      licenseUrl: string,
      headers?: Record<string, string>
    }
  }
}
```

Eventos observables relacionados con DRM:
```typescript
player.on('error', (err) => {
  // err.code puede indicar DRM failure:
  // - licencia denegada
  // - CDM no disponible
  // - certificado inválido (FairPlay)
})
```

---

## Señales de observabilidad (eventos, estados)

| Señal | Tipo | Descripción |
|---|---|---|
| `error` | evento | DRM failure: licencia denegada, CDM ausente, cert FairPlay inválido |
| `playing` | evento | DRM resuelto correctamente si llega aquí |
| `buffering` | evento | Puede ocurrir mientras se solicita licencia |

No hay evento dedicado `drmResolved` o `licenseAcquired` en la API pública. El proxy observable es que el player alcance `playing` sin `error` previo.

---

## Tipos de contenido soportados

| Esquema | Browser / Plataforma | Nivel | Notas |
|---|---|---|---|
| Widevine L1 | Chrome (con TEE hardware) | Hardware | Protección máxima, requiere hardware seguro |
| Widevine L3 | Chrome (sin TEE) | Software | Más común en desarrollo/testing |
| PlayReady | Edge, Windows browsers | Varía | Fallback en ecosistema Microsoft |
| FairPlay | Safari (macOS / iOS) | Hardware en iOS | Vía `webkitneedkey` event |

---

## Orden de resolución DRM

```
1. getDRMSupport.js consulta requestMediaKeySystemAccess para cada esquema
2. Widevine L1 (com.widevine.alpha, robustness: HW_SECURE_ALL)
3. Widevine L3 (com.widevine.alpha, robustness: SW_SECURE_CRYPTO)
4. PlayReady (com.microsoft.playready)
5. FairPlay (com.apple.fps.1_0)   ← solo Safari, vía webkitneedkey
6. Si ninguno disponible → error
```

### FairPlay vía webkitneedkey

Safari usa el evento propietario `webkitneedkey` en lugar del estándar W3C `encrypted`. El player tiene rama específica en `src/player/drm/` para manejar este caso:

```
video.addEventListener('webkitneedkey', handler)
  → fetch certificateUrl → WebKitMediaKeys
  → fetch licenseUrl con initData → setMediaKeys
```

**Implicación para tests:** FairPlay no es testeable con Playwright (Chromium/Firefox). Requiere Safari real o emulador iOS. Marcar tests FairPlay con `@skip-ci`.

---

## protectionData para DASH

Streams DASH con DRM requieren `protectionData` en la config. Shape esperado:

```typescript
{
  drm: {
    widevine: {
      licenseUrl: 'https://license.example.com/widevine',
      // protectionData se construye internamente por el handler DASH
    }
  }
}
```

El handler DASH usa EME nativo del browser. No hay intermediación de dash.js. El player construye el objeto `MediaKeySystemConfiguration` a partir de la config DRM y lo pasa a `requestMediaKeySystemAccess`.

---

## Widevine L1 vs L3

- **L1:** el CDM opera en hardware TEE. La clave nunca sale del enclave seguro. Solo disponible en dispositivos con hardware específico (Android, algunos Chromebooks).
- **L3:** el CDM opera en software (proceso del browser). Funcional para desarrollo y testing.
- El player no distingue L1/L3 en la config — el CDM resuelve automáticamente el nivel más alto disponible.
- En tests CI (headless Chromium), **siempre se obtiene L3** (sin TEE).

---

## Riesgos conocidos

- **Licencia expirada en fixtures:** streams de prueba con DRM pueden tener licencias de tiempo limitado. Un fixture que funcionaba puede fallar si la licencia expiró.
- **CDM no disponible en CI:** algunos entornos headless no tienen CDM Widevine instalado. Requiere `--enable-widevine` o fixtures sin DRM para tests de CI.
- **CORS en licenseUrl:** el servidor de licencias debe permitir el origen del test. Configurar headers CORS en el mock server.
- **FairPlay en Playwright:** imposible. No intentar.
- **PlayReady en Linux:** PlayReady no está disponible en browsers Linux. Tests PlayReady requieren Windows o Edge.

---

## Casos edge

- **Token de autorización expirado:** el player no reintenta la solicitud de licencia automáticamente. Emite `error` y se queda detenido.
- **Cambio de stream DRM → DRM:** si se cambia el src a otro stream protegido, el CDM puede necesitar ser reinicializado. El player maneja esto, pero hay un frame de `buffering` adicional.
- **Stream DRM + SGAI:** la licencia DRM y el ad break pueden competir por el estado del player. El ad no tiene DRM propio; el contenido principal sí. Transición contentPause/contentResume puede dejar el CDM en estado inconsistente si el stream está en L1.
- **Offline / download:** no soportado. No intentar tests de DRM offline.
