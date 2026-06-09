# DRM — Overview

## Qué hace

El módulo DRM gestiona la reproducción de contenido protegido en Lightning Player. Detecta qué sistema de cifrado soporta el browser actual (EME), selecciona el URL de stream adecuado entre los candidatos disponibles (HLS para FairPlay / MPD para Widevine/PlayReady), construye los datos de protección para dash.js (`setProtectionData`), y delega el intercambio de licencias al CDM del browser.

Desde la perspectiva del usuario: el contenido protegido reproduce igual que contenido sin DRM — el módulo es transparente si la configuración es correcta y el license server está disponible.

## Archivos clave

| Archivo | Rol |
|---------|-----|
| `src/player/drm/plugin.jsx` | React component `DRMPlugin` + `DRMPluginRunner` — detecta el key system, selecciona `_candidateUrls`, coordina con DAI y MediaTailor |
| `src/player/drm/getDashProtectionData.js` | Construye el objeto `protData` para `player.setProtectionData()` de dash.js — mapea `widevine`/`playready` a sus key system IDs estándar |
| `src/helper/getDRMSupport.js` | Detecta el key system soportado por el browser via EME (`requestMediaKeySystemAccess`), fallback a `WebKitMediaKeys` (Safari legacy) y `MSMediaKeys` (IE11). Retorna la primera string `keySystemId` soportada |
| `src/platform/loadConfig.js` | Construye `_candidateUrls` (HLS + MPD) cuando `takeDrmPath` es true; inyecta `drm._candidateUrls` en el contexto |
| `constants.cjs` | Define `Events._error` y `ErrorType._initPlayer` usados por errores DRM |

## Flujo de datos

```
loadConfig()
  ├── GET embed.mdstrm.com/{type}/{id}.json
  ├── Si responseDrm.enabled || hasDrmConfig → takeDrmPath = true
  └── Construye candidateUrls { hls: "...", mpd: "..." }
        ↓ (inyectado en contexto como drm._candidateUrls)
DRMPlugin (React)
  ├── Espera mediaTailorSessionId (timeout 5s) si adInsertion.enabled
  ├── Espera mediaTailorManifestUrl si skipMtCdn (timeout 5s)
  └── Renderiza DRMPluginRunner cuando candidateUrls están disponibles
        ↓
DRMPluginRunner
  ├── getDRMSupport() → Promise<keySystemId>
  │     ├── Widevine: 'com.widevine.alpha'  (Chromium)
  │     ├── PlayReady: 'com.microsoft.playready'  (Edge legacy)
  │     └── FairPlay: 'com.apple.fps.1_0'  (Safari)
  ├── Selecciona src:
  │     ├── FairPlay → candidateUrls.hls
  │     └── Widevine/PlayReady → candidateUrls.mpd || candidateUrls.hls
  ├── Si mediaTailorManifestUrl → usa esa URL directamente (skipCdn + DRM)
  ├── Agrega adInsertionSessionId al querystring si hay sesión MediaTailor
  ├── Si deferSrcForGoogleDAI → pone src en _daiDeferredManifestUrl (no en src directo)
  └── setData({ src, drm: { ...drm, vkeySystem }, selectedSrcType })
        ↓
getDashProtectionData(drm)   [para DASH]
  ├── Itera drm.widevine / drm.playready
  ├── serverURL → protData[keySystemId].serverURL
  ├── httpRequestHeaders → protData[keySystemId].httpRequestHeaders (directo)
  └── token / drmToken → protData[keySystemId].httpRequestHeaders['X-AxDRM-Message']
        ↓
dash.js setProtectionData(protData) → EME license request
```

## API pública

El módulo DRM no expone métodos directamente en la API pública del player. Se configura via el objeto `drm` en `loadConfig` (o en el JSON de respuesta de la plataforma):

```js
// Config de DRM en la respuesta de la plataforma (o inyectada vía override)
{
  drm: {
    enabled: true,
    widevine: {
      serverURL: "https://license.example.com/widevine",
      token: "optional-axdrm-token",          // se convierte en X-AxDRM-Message header
      httpRequestHeaders: {                     // o headers directos (tiene precedencia)
        "Authorization": "Bearer token"
      }
    },
    playready: {
      serverURL: "https://license.example.com/playready"
    },
    fairplay: {
      serverURL: "https://license.example.com/fairplay",
      certificateUrl: "https://license.example.com/cert"
    }
  }
}
```

**vkeySystem** (interno, no configurable): String con el key system ID detectado (`'com.widevine.alpha'`, `'com.microsoft.playready'`, `'com.apple.fps.1_0'`). Visible en el contexto del player post-detección.

**getDRMSupport()** (helper interno):
```ts
getDRMSupport(): Promise<string>  // resuelve con el keySystemId soportado; rechaza si ninguno
```

**Eventos emitidos**:
- `error` (`Events._error`) con `{ fatal: true, data: 'DRM_NOT_SUPPORTED' }` — cuando getDRMSupport no encuentra ningún key system
- `error` (`Events._error`) con `{ fatal: true, data: 'DRM_LICENSE_ERROR' }` — cuando el license server rechaza la solicitud

## Interacciones con otros sistemas

| Sistema | Tipo de interacción | Impacto en QA |
|---------|--------------------|-|
| `playback-core` | DRMPlugin.setData() actualiza src y drm en el contexto; el handler de playback recibe la config | La selección incorrecta de candidato afecta qué handler se usa (HLS vs DASH) |
| `hls` (hls.js) | Para FairPlay via emeEnabled: hls.js recibe drmSystems con la URL de licencia | FairPlay solo funciona en Safari; en Chromium hls.js no tiene CDM FairPlay |
| `dash` (nativo browser) | Para Widevine/PlayReady: getDashProtectionData construye protData para dash.js | En headless Chromium solo hay CDM Widevine L3 (software) |
| `ads-dai` (Google DAI) | DRMPlugin espera _daiDeferredManifestUrl antes de resolver src cuando deferSrcForGoogleDAI=true | Coordinación necesaria para DAI+DRM; timeout 5s si no llega el manifest |
| `ads-mediataylor` (MediaTailor) | DRMPlugin espera mediaTailorManifestUrl cuando skipMtCdn=true; detecta key system early para que MediaTailor sepa qué formato (HLS vs DASH) pedir | Riesgo de timeout si el manifest no llega en 5s |
| `platform-config` | loadConfig.js construye _candidateUrls y el objeto drm | Si el backend no retorna `drm.enabled` o `serverURL`, takeDrmPath=false y no se activa el módulo |
