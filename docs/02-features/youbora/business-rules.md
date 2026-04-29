---
type: business-rules
feature: youbora
version: "1.0"
status: draft
last_verified: 2026-04-28
---

# Business Rules — Youbora (NPAW Analytics)

## Contexto: vistas que implementan la feature

Youbora tracking se activa a nivel de plugin, no de vista. El plugin es cargado condicionalmente por el sistema de plugins antes de que la vista se monte.

| Vista | Youbora activo | Notas |
|---|---|---|
| `video` | Si habilitado por config | Vista principal de VOD/Live/DVR |
| `none` | Si habilitado por config | Sin UI — tracking funciona igual |
| `reels` | Nunca | El plugin loader devuelve `{}` para reels |
| `compact` | Si habilitado por config | Misma lógica de plugin loader |
| `radio` / `radioSA` | Si habilitado por config | Content type se mapea a VOD salvo live/dvr |

[CODE: src/plugins/index.js:27-31]  
[CODE: src/plugins/index.js:41-62]

---

## SDK instalado

| Campo | Valor |
|---|---|
| Paquete | `npaw-plugin` |
| Versión | `^7.3.28` (dependencia directa en `dependencies`, no `devDependencies`) |
| Import en tracker | `import NpawPlugin from 'npaw-plugin'` |
| Nombre registrado del player | `'lightning-player'` (hardcodeado en `getPlayerName`) |
| Versión del player reportada | `process.env.VERSION` sin prefijo `v` |

[CODE: package.json:139]  
[CODE: src/analytics/youbora/tracker.js:1]  
[CODE: src/analytics/youbora/tracker.js:68-69]  
[CODE: src/analytics/youbora/tracker.js:6]

---

## API pública / config

No hay método público para acceder al estado de Youbora desde la API del player. El tracker vive completamente dentro del plugin React.

La activación depende de la respuesta del endpoint de configuración del player (player config — segundo request al init):

```json
{
  "metadata": {
    "player": {
      "tracking": {
        "youbora": {
          "enabled": true,
          "account_code": "ACCOUNT_CODE_STRING"
        }
      }
    }
  }
}
```

[CODE: src/plugins/index.js:34]  
[CODE: src/analytics/youbora/index.jsx:39]

---

## BR-01 — Youbora solo se activa si `enabled` es truthy Y existe `account_code`

El sistema de plugins verifica `options?.metadata?.player?.tracking?.youbora?.enabled`. Los valores truthy aceptados son: `1`, `'1'`, `true`, `'true'`. Si `enabled` no está presente o es falsy, el componente `YouboraTracker` nunca se monta.

Adicionalmente, aunque el componente se monte, el tracker no llama a `new NpawPlugin()` si `accountCode` es falsy. Init retorna sin efecto.

[CODE: src/plugins/index.js:34,41]  
[CODE: src/analytics/youbora/tracker.js:57-59]

---

## BR-02 — Youbora NO se activa en modo Reels

El plugin loader devuelve `{}` cuando detecta `view.type === 'reels'`, lo que impide que cualquier plugin (incluido YouboraTracker) se monte en el contenedor padre.

[CODE: src/plugins/index.js:28-31]

---

## BR-03 — Youbora NO se activa si hay un error fatal al inicializar el player

El plugin loader devuelve `{}` si `options.error` es truthy (error fatal en la carga de config). El tracking nunca se activa si el player no pudo cargar su configuración.

[CODE: src/plugins/index.js:22-25]

---

## BR-04 — El componente se reinicia cuando las props cambian (player.load())

`YouboraAnalytics` extiende `Base` (MediastreamBaseComponent). `Base.getDerivedStateFromProps` detecta cualquier cambio de prop y pone `_shouldRestart: true`. En `componentDidUpdate`, si `_shouldRestart` es true, llama a `restart(false)`, que llama a `tracker.restart(newOptions)`. Restart limpia todos los handlers y el plugin, luego llama a `init()` en el siguiente tick (setTimeout 0ms).

[CODE: src/plugins/baseComponent.js:29-57]  
[CODE: src/analytics/youbora/index.jsx:20-26]  
[CODE: src/analytics/youbora/tracker.js:243-249]

---

## BR-05 — Mapeo de tipos de contenido a Youbora

| Tipo player (`type`) | Valor `content.isLive` | Valor `content.type` (Youbora) |
|---|---|---|
| `live` | `true` | `'Live'` |
| `dvr` | `true` | `'DVR'` |
| `media` | `false` | `'VOD'` |
| `episode` | `false` | `'VOD'` |
| cualquier otro | `false` | `'VOD'` |

Para live y dvr, `content.duration` se fija en `0`.

[CODE: src/analytics/youbora/tracker.js:8-12]  
[CODE: src/analytics/youbora/tracker.js:23-26]

---

## BR-06 — Campos de metadata enviados a Youbora

| Campo Youbora | Fuente en el player | Notas |
|---|---|---|
| `content.id` | `options.id` (id del contenido) | Siempre presente |
| `content.title` | `options.title` | Del config response de la plataforma |
| `content.isLive` | Derivado de `type` | Ver BR-05 |
| `content.type` | Derivado de `type` | `'Live'`, `'DVR'`, o `'VOD'` |
| `content.duration` | `api.duration` (o `0` para live/dvr) | Leído del player API en el momento de fireStart |
| `content.resource` | `api.src` | URL del stream activo — solo si `api.src` existe |
| `app.name` | `options.appName` o `'lightning-player'` | Fallback hardcodeado |
| `app.releaseVersion` | `process.env.VERSION` | Versión del player en build time |
| `user.name` | `options.customer` | Solo si `customer` es truthy |
| `content.program` | `metadata.show` | Solo si `type === 'episode'` y `metadata.show` existe |
| `content.season` | `String(metadata.season)` | Solo si `type === 'episode'` y season no es null/undefined |
| `content.episodeTitle` | `options.title` | Solo si `type === 'episode'` |

[CODE: src/analytics/youbora/tracker.js:14-40]

---

## BR-07 — La sesión Youbora se inicia exactamente una vez por init, en el primer contentFirstPlay

El handler `onFirstPlay` verifica el flag `this._started`. Si ya es `true`, retorna sin efecto. Una vez que dispara `fireStart()` y `fireJoin()`, el flag se pone `true` y no vuelve a dispararse hasta que el tracker sea destruido y reiniciado.

Esto significa que para un mismo init del player, `fireStart`/`fireJoin` solo ocurren una vez sin importar cuántas veces se reproduzca.

[CODE: src/analytics/youbora/tracker.js:84-91]

---

## BR-08 — Comportamiento durante un ad break (content pause/resume)

Cuando el player emite `adsContentPauseRequested`, el tracker:
1. Pone `_inAdBreak = true`
2. Llama `adapter.firePause()` en el content adapter

Cuando el player emite `adsContentResumeRequested`, el tracker:
1. Pone `_inAdBreak = false`
2. Llama `adapter.fireResume()` en el content adapter

Durante un ad break (`_inAdBreak === true`), los eventos de contenido `playing`, `pause`, `seeking`, `seeked`, `buffering`, y `canplay` son ignorados por el content adapter.

[CODE: src/analytics/youbora/tracker.js:133-143]  
[CODE: src/analytics/youbora/tracker.js:93-120]

---

## BR-09 — Ad tracking: break start/stop vs individual ad start/stop

El tracker mantiene el flag `_adBreakStarted` para evitar llamar `fireBreakStart` múltiples veces para el mismo break.

En `adsStarted`: si `_adBreakStarted` es false, llama primero a `adsAdapter.fireBreakStart()`, luego `fireStart()` y `fireJoin()` para el ad individual.

En `adsAllAdsCompleted`: llama `adsAdapter.fireBreakStop()` y resetea `_adBreakStarted = false`.

En `adsComplete`: llama `adsAdapter.fireStop()` solo para el ad individual.

[CODE: src/analytics/youbora/tracker.js:178-199]  
[CODE: src/analytics/youbora/tracker.js:200-202]

---

## BR-10 — Destroy limpia todos los handlers y para la sesión Youbora

`tracker.destroy()` y `tracker._cleanup()`:
1. Cancela cualquier `setTimeout` pendiente de reinit
2. Desvincula todos los event listeners del `internalEmitter`
3. Llama `adapter.fireStop()` para cerrar la sesión activa (si había una)
4. Llama `plugin.removeAdsAdapter()` y `plugin.removeAdapter()`
5. Resetea todos los flags internos a su estado inicial

El try/catch en `_cleanup` silencia errores si el plugin ya fue destruido.

[CODE: src/analytics/youbora/tracker.js:252-279]

---

## BR-11 — Error handling: fatal vs no-fatal

En el handler `onError`, si `data.fatal === true` se llama `adapter.fireFatalError(code, msg)`. Caso contrario se llama `adapter.fireError(code, msg)`.

El `code` se construye como `String(data?.code ?? data?.type ?? 'unknown')`. El `msg` viene de `data?.message || ''`.

[CODE: src/analytics/youbora/tracker.js:145-154]

---

## BR-12 — Ad metadata enviada a Youbora

| Campo Youbora | Fuente | Notas |
|---|---|---|
| `ad.title` | `adInfo.title` o `adInfo.adTitle` | Solo si alguno existe |
| `ad.resource` | `adInfo.mediaUrl` o `adInfo.resourceUrl` | Solo si alguno existe |

El click-through URL (`api.ad.info.clickThroughUrl`) se envía en `fireClick()` si está disponible.

[CODE: src/analytics/youbora/tracker.js:184-189]  
[CODE: src/analytics/youbora/tracker.js:209-212]

---

## BR-13 — El balancer de NPAW está deshabilitado

El plugin se instancia con `{ components: { balancer: false } }`. No se usa la funcionalidad de balanceo de carga de NPAW.

[CODE: src/analytics/youbora/tracker.js:62]

---

## BR-14 — `balancer: false` es la única opción pasada al constructor de NpawPlugin

No se pasan opciones de CDN, CDN parser, ni ninguna otra opción de NPAW al constructor. Cualquier configuración adicional de NPAW (host override, etc.) no está soportada por el código actual.

[CODE: src/analytics/youbora/tracker.js:62]
