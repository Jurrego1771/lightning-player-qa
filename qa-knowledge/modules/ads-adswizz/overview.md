# ads-adswizz — Overview

## Qué hace

AdsWizz es una plataforma de monetización de **audio digital** (radio en vivo, simulcast AM/FM, podcast, audio on-demand). En el Lightning Player la integración cumple **dos funciones complementarias**, ambas pensadas para streams de **audio**, no de video:

1. **Server-Side Ad Insertion (SSAI) por decoración de URL.** Antes de reproducir el stream, el player crea una sesión AdsWizz y reescribe los parámetros de query de la URL del stream (`mp3`/`hls`/`mpd`) apuntando al *edge server* de AdsWizz. El stream que recibe el oyente ya viene con los avisos de audio insertados server-side (DAAST / VAST 4.1 `adType=audio`). El player **no** programa, cuenta ni dispara los avisos de audio; eso ocurre en el servidor.
2. **Companion Banner (CSAI ligero).** Un componente React (`@/ads/adswizz`) carga el SDK JS de AdsWizz y muestra un banner companion (300x250 por defecto) sincronizado con el aviso de audio que está sonando. El SDK escucha el stream vía *Second Metadata Connection* (TIMED_POLLING) para saber cuándo mostrar/ocultar el banner.

A diferencia de Google IMA (video, CSAI, eventos ricos `adsStarted`/`adsComplete`) y de Google DAI/SGAI (video SSAI), AdsWizz aquí es **solo audio** y **no expone eventos de ciclo de vida de aviso** a la API pública del player. La señal de "hay un aviso sonando" se manifiesta únicamente como la aparición/ocultamiento del banner companion (`showingBanner`).

## Archivos clave

| Archivo | Rol |
|---------|-----|
| `src/ads/adswizz/getAdswizzSDK.js` | Carga perezosa y singleton del SDK externo; envuelve `window.adswizzSDK` en un `Proxy`; expone `decorateURL(originalUrl, edgeServer)` que llama a `decorateURLAndCreateSession` y reescribe el query de la URL. Atrapa cualquier error y devuelve `null` (degradación silenciosa). |
| `src/ads/adswizz/index.jsx` | Componente `Adswizz` (companion banner). Inicializa el SDK (`init`), configura el banner (`setCompanionBannerConfig`), gestiona montaje/desmontaje del contenedor (`resetSession`), configura `MetadataConnection.TIMED_POLLING` y `setUseSetTimeoutForSynchronization(true)`. Lazy-loaded vía `React.lazy`. |
| `src/view/common/components/adswizz.jsx` | Gate de renderizado: solo monta el handler si `metadata.hasAW === true` **y** existe `adswizz_companion.afrUrl`. Pasa `type='audio'`, `afrURL`, `companionZoneId`, `fallbackZoneId`, `width=300`, `height=250`. |
| `src/platform/loadConfig.js` | Flujo SSAI: lee `response.adswizz_companion` (`afrUrl`, `edge_data.server`, `edge_data.zone`). Si hay `edge_data.server` + `afrUrl`, carga el SDK y decora las URLs de stream (`mp3`/`hls`/`mpd`). Añade query params `es` (edge server), `pz` (zone), `listenerid`. |
| `src/view/radioSA/components/layout/index.js`, `src/view/radio/components/index.jsx` | Vistas de radio que montan `<Adswizz />`. |
| `constants.cjs` → `files.ads.adswizz` | URL del SDK externo por entorno (devel / staging / prod en `*.s-mdstrm.com`). |

## Flujo de datos

```
 CONFIG (platform API: response.adswizz_companion)
   ├─ afrUrl, companionZoneId, fallbackCompanionZoneId
   └─ edge_data { server, zone }
            │
   ┌────────┴───────────────────────────────────────────────┐
   │ SSAI (loadConfig.js)            │ COMPANION (adswizz.jsx)│
   │                                 │                        │
   │ if edge_data.server && afrUrl:  │ if hasAW && afrUrl:    │
   │   getAdswizzSDK()               │   <Adswizz type=audio> │
   │   decorateURLAndCreateSession   │     getAdswizzSDK()     │
   │   → reescribe query del stream  │     init({consent,      │
   │   → +es +pz +listenerid         │           contentPlayer,│
   │            │                    │           playerId})    │
   │            ▼                    │     setCompanionBanner  │
   │   stream con avisos SSAI        │     TIMED_POLLING        │
   │   reproducido por <audio>       │            │             │
   └─────────────────────────────────┘            ▼             │
                                       SMC detecta aviso de audio│
                                       → willDisplay → showBanner│
                                       → outOfContext → hideBanner
```

El `contentPlayer` (elemento `<audio>`) se obtiene de `context.element` y se pasa al SDK para sincronizar el banner con el audio que reproduce.

## API pública

**No hay API pública JS específica de AdsWizz expuesta por el player.** La feature se activa por configuración de plataforma (`hasAW`, `adswizz_companion`), no por métodos del player. Las superficies relevantes para QA:

- **Activación:** `metadata.hasAW === true` + `adswizz_companion.afrUrl` presente.
- **SSAI:** se aplica solo si `adswizz_companion.edge_data.server` está presente además de `afrUrl`.
- **Efecto observable:** aparición/ocultamiento del banner companion (`300x250` por defecto) sincronizado con el aviso de audio; query params `es`/`pz`/`listenerid` añadidos al stream.
- **Eventos del player:** ninguno propio. Los eventos `adsStarted`/`adsComplete`/`adsError` que aparecían en el `behavior.json` legacy **no son emitidos por este módulo** (eran supuestos de plantilla). El ad system genérico (`ads-manager` / IMA) es quien posee esos eventos.
- **Debug:** con `player.setOption('debug', true)` el componente loguea la versión del SDK (`getVersion()`).

## Interacciones con otros sistemas

- **platform-config (`loadConfig.js`):** fuente de toda la configuración AdsWizz y punto donde se decora la URL del stream. Una falla aquí afecta directamente la reproducción del audio (la URL decorada es la que se reproduce).
- **playback-core (audio):** el `<audio>` (`context.element`) es el `contentPlayer` del SDK. AdsWizz **no** pausa/reanuda el contenido como IMA; el aviso ya viene en el stream SSAI.
- **events:** AdsWizz no participa del `internalEmitter` para ciclo de vida de avisos. Solo el flag `debug` de `internalEmitter` controla el logging.
- **ads-manager / IMA / GPT:** conviven en la misma vista de radio (`<ImaAds/>`, `<GptAds/>`, `<Adswizz/>` se montan juntos). AdsWizz audio SSAI y IMA video CSAI no deben ejecutarse sobre el mismo medio simultáneamente: AdsWizz es para `type='audio'`.
- **SDK externo (CDN `*.s-mdstrm.com`):** dependencia de red bloqueante para el companion; si no carga, `getAdswizzSDK` devuelve `null` y el banner no se monta (el audio sigue).
