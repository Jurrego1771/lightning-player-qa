---
type: feature-spec
feature: konodrac
version: "1.0"
status: draft
last_verified: 2026-05-05
---

# Feature Spec — Konodrac Mark Collector API

## Qué es Konodrac / Mark Collector

Konodrac es una plataforma de analítica de consumo de contenido. El **Mark Collector API** recibe eventos de reproducción enviados como pixel GET (img-tag) a un endpoint de su infraestructura. Los datos se exponen en el dashboard de Konodrac para que operadores de contenido (CARTV) monitoreen el consumo de su catálogo.

La integración es directa: sin SDK de tercero. El tracker del player construye URLs de pixel con los parámetros requeridos y los dispara usando `getImage()` (helper existente en el player que crea un `<img>` en el DOM).

---

## Endpoints de tracking

| Endpoint | Uso | Patrón de interceptación |
|---|---|---|
| `https://marker.konograma.com/track` | GET pixel con cookies (web) | `/marker\.konograma\.com\/` |
| `https://marker.konograma.com/rdtrack` | Redirect tracking (mismo destino) | `/marker\.konograma\.com\/` |

La URL base exacta (subdominio/path) será provista por Konodrac por cuenta. Para tests se intercepta el dominio completo `marker.konograma.com`.

---

## Eventos a implementar

| Evento Konodrac | Trigger en el player | Evento interno |
|---|---|---|
| `mloaded` | Cuando el contenido carga en el player | `Events._metadataloaded` o `Events._loaded` |
| `firstplay` | Primera reproducción del contenido | `Events._contentFirstPlay` |
| `play` | Reanudar reproducción (no la primera vez) | `Events._play` (sin `_started`) |
| `pause` | Pausar | `Events._pause` |
| `mhb` | Media Heartbeat — cada 50s durante reproducción | `setInterval(50_000)` — solo activo con `isPlaying=true` |
| `seek` | Saltar posición | `Events._seeked` |
| `endplay` | Fin del contenido | `Events._ended` |
| `dispose` | Destrucción del player | `componentWillUnmount` / `destroy()` |
| `fullscreen` | Activar pantalla completa | `Events._fullscreenchange` |
| `mute` | Silenciar | `Events._volumechange` cuando `volume === 0` |
| `error` | Error de reproducción | `Events._error` |

---

## Parámetros por beacon

| Parámetro | Tipo | Descripción | Requerido |
|---|---|---|---|
| `dataset` | string | ID del dataset Konodrac (ej: `CARTV_OTT_TEST`) | Sí |
| `event` | string | Nombre del evento (ver tabla arriba) | Sí |
| `uid` | string | ID del usuario autenticado | No (omitir si anónimo) |
| `cid` | string | ID del contenido (debe coincidir con catálogo Konodrac) | Sí |
| `channel` | string | Nombre del canal o app (ej: `CARTV`) | Sí |
| `pageType` | string | `VOD`, `LIVE`, `CATCHUP`, o `PODCAST` | Sí |
| `sysEnv` | string | Siempre `web` | Sí |
| `secsPlayed` | integer | Segundos reproducidos del contenido actual (ver business-rules.md BR-06) | Sí |
| `playerStatus` | string | `PLAYING` o `PAUSED` | Sí |
| `currentPosition` | number | Posición actual en segundos | Sí |
| `gdpr` | string | Siempre `1` cuando GDPR aplica | Sí |
| `gdpr_consent` | string | TC String del consentimiento TCF 2.0 | Sí |
| `cb` | string | Cache buster — `Date.now()` en cada llamada | Sí |

---

## Activación via config del player

El tracker se activa a través de la respuesta del player config (segundo request al init del player), bajo `metadata.player.tracking.konodrac`:

```json
{
  "metadata": {
    "player": {
      "tracking": {
        "konodrac": {
          "enabled": true,
          "dataset": "CARTV_OTT_TEST",
          "channel": "CARTV"
        }
      }
    }
  }
}
```

Campos requeridos: `enabled` (truthy) + `dataset` (string no vacío) + `channel` (string no vacío). Si cualquiera falta o es falsy, el tracker no se inicializa.

---

## Mapeo de tipos de contenido a pageType

| Tipo player (`type`) | `pageType` Konodrac | Notas |
|---|---|---|
| `media` | `VOD` | |
| `episode` | `VOD` | |
| `live` | `LIVE` | Puede cambiar a `CATCHUP` en seek — ver BR-07 |
| `dvr` | `LIVE` | Puede cambiar a `CATCHUP` en seek — ver BR-07 |
| `podcast` | `PODCAST` | |
| `audio` / `radio` | `VOD` | |

---

## Implementación esperada en el player

Archivo nuevo a crear: `src/analytics/konodrac/tracker.js` + `src/analytics/konodrac/index.jsx`

Sigue el mismo patrón de `src/analytics/youbora/`:
- `KonodracTracker` class pura (sin React)
- `KonodracAnalytics` extiende `Base` (MediastreamBaseComponent)
- `Base.wrap(contextMapper, KonodracAnalytics)` para inyectar props desde context

Usa `getImage()` de `src/helper/getImage.js` para disparar cada beacon.

Para TCF/GDPR: leer `window.__tcfapi('getTCData', 2, callback)` al init, cachear TC string.

Para `secsPlayed`: acumulador interno. Ver business-rules.md BR-06.

Para `mhb`: `setInterval(fn, 50_000)` — solo activo cuando `isPlaying === true`.

---

## Entorno de validación

- Dataset de test: `CARTV_OTT_TEST`
- Validación real: Konodrac confirma recepción en su dashboard de validación
- Tests en este repo: interceptan pixel con `page.route()` — no dependen del servidor Konodrac
