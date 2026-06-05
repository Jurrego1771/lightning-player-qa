# NPAW / Youbora — Validación E2E en vivo · 2026-05-29

## Contexto

| Campo | Valor |
|---|---|
| Página | https://dev-next-manager.mdstrm.com/watch/live/6985017e78adcbed3b8b4f17 |
| Contenido | "Animated Movie." — live con ventana DVR |
| content.id | `6985017e78adcbed3b8b4f17` |
| Player | lightning-player **v1.0.74** (develop) |
| Plugin | npaw `7.3.28-js-sdk` · adapter `7.3.28-**generic**-js` |
| Cuenta | `caracoltvdev` |
| Host NQS | `infinity-c34/c41.youboranqs01.com` |
| Método | Browser real + interceptor de red (fetch/XHR/sendBeacon) + captura CDP de Playwright |

Doc de referencia: `NPAW QA 2026_04 - Caracol TV` + `Untitled spreadsheet` (30 casos).

---

## Protocolo de beacons observado (SDK 7.3.28 infinity)

```
LMA handshake:   GET lma.npaw.com/configuration → GET lma.npaw.com/data  (fastdata, host NQS)
Sesión:          /infinity/session/start · /init · /start · /joinTime · /infinity/session/beat (30s)
Playback:        /ping (POST cada 5s, body con métricas) · /pause · /resume · /seek
Ads:             /adBreakStart · /adInit · /adManifest · /adStart · /adJoin · /adQuartile ×3 · /adStop · /adBreakStop
Error:           /error (body con errorCode, msg, rendition, metadata completa)
```

Metadata de contenido viaja en el **body POST** de `/init` y `/error` (NO en el query string de `/start`).

---

## Resultados por caso del Excel

| Caso | Descripción | Resultado | Evidencia |
|---|---|---|---|
| **2.21** | content id | ✅ PASS | `contentId: "6985017e78adcbed3b8b4f17"` = ID de la URL |
| **2.22** | content type | ✅ PASS | `contentType: "DVR"`, `playbackType: "Live"` |
| **2.6** | mediaDuration | ✅ PASS | `mediaDuration: -1` (correcto para live/DVR) |
| **2.13** | rendition | ✅ PASS* | `rendition: "854x480@409kbps"` en `/error` — computeRendition funciona |
| **2.17** | userType / username | ⊘ N/A | Sin sesión autenticada — `customer_extras.*` ausente, campo no enviado (correcto por guard) |
| **6.3** | pingTime / diffTime | ✅ PASS | `/ping` cada 5s, `pingTime:"5"`, `diffTime:~5000ms` |
| **6.8** | playrate | ✅ PASS | pausa→`playrate:0`; `playbackRate=2`→`playrate:2` (playhead avanza 2×) |
| **6.5** | automatic rendition | ⚠️ PARCIAL | rendition string OK, pero `bitrate:-1` en todos los `/ping` |
| **6.6** | manual rendition | ⊘ NO PROBADO | UI de calidad no accesible vía DOM (hls encapsulado) |
| **6.9** | dynamic metadata | ⊘ NO PROBADO | requiere cambio de metadata en vivo |
| **A.2.1–6** | ad manifest / breaks | ✅ PASS | ciclo completo: adBreakStart→adManifest→adInit→adStart→adJoin→quartiles→adStop→adBreakStop |
| **A.2.11–21** | ad playback detail | ✅ PASS | adQuartile ×3, adStart/adJoin/adStop presentes (excepto adResource/adTitle/adProvider = null, ver BUG-6) |
| **A.2.23** | adSkipped | ✅ PASS | al skipear el ad skippable se emite `/adBreakStop` — ciclo de ads cerrado correctamente (sesión `1dzscjqsdemfnmuj`) |
| **A.3.1** | background | — FUERA DE ALCANCE | excluido de esta validación por decisión |
| **4.1** | buffering | ✅ PASS | con throttling real (red lenta) emite `/bufferUnderrun` (×5), `playhead=54.4` (NO 0 — bug original corregido), `bufferDuration=202`. (El FAIL inicial fue falso positivo: abortar segmentos causa error fatal, no underrun) |
| — | pause / resume | ✅ PASS | `/pause` + `/resume` confirmados |
| — | seek (DVR) | ✅ PASS | `/seek` confirmado (retroceso 30s en ventana DVR) |
| — | error reporting | ✅ PASS | error inducido (bloqueo de segmentos) → `/error` con `msg:"levelLoadTimeOut"` + rendition + metadata |
| — | pre-roll content view | ✅ PASS | `/start`+`/joinTime` ANTES de `/adBreakStart` (cambio del PR issue-706) |

---

## Bugs / Hallazgos

### 🔴 BUG-1 · `/error` espontáneo "internalException" en cada arranque
En **cada** init de sesión, ~400ms tras `/init`, el plugin emite `/error` con `msg:"internalException"`, `rendition:null` (antes de empezar playback). Ocurre sin inducción, en cada carga. Infla la métrica de Start-up Error de NPAW.
Evidencia: req 402 `msg:"internalException"` timemark +400ms del init.

### ✅ BUG-2 · DESCARTADO (falso positivo)
El `/bufferUnderrun` SÍ se emite. El FAIL inicial fue por método de inducción incorrecto: **abortar** los segmentos causa error fatal de hls.js (`levelLoadTimeOut`→`/error`), no un buffer underrun. Con **throttling real** (retraso de segmentos, red lenta) el player entra en buffering y emite `/bufferUnderrun` con `playhead=54.4` y `bufferDuration=202`. Confirmado por el usuario (sesión 9tz335c09sbbwv1j) y reproducido (sesión bq8lr9e8by9w1r2t).

**Lección:** para inducir buffer underrun usar throttling (delay), nunca abortar requests. Nota: cada `/bufferUnderrun` viene acompañado de un `/error msg:"bufferStalledError"`.

### 🟡 BUG-3 · `bitrate:-1` y `throughput:-1` en todos los `/ping`
Aunque `computeRendition` produce `"854x480@409kbps"` en `/error`, los `/ping` reportan `bitrate:-1` y `throughput:-1`. La métrica Quality→Bitrate de NPAW queda en -1. Adapter genérico no alimenta bitrate a los pings.

### 🟡 BUG-4 · Sesión efímera duplicada al inicio
Al cargar se observa una sesión que hace `start→event→event→stop` en ~1s, seguida de la sesión real. Posible doble init / restart espurio (relacionado con el restart inteligente de `index.jsx` en issue-706).

### 🟡 BUG-5 · `adsExpected` inconsistente
`/init` envía `adsExpected:false`, pero tras detectar el pre-roll `/error` posterior envía `adsExpected:[[1]]`. El init subreporta los ads esperados (timing de inicialización).

---

## Resumen ejecutivo

- **Núcleo funcional (sesión, playback, ads, eventos, error): VALIDADO.** El feature reporta correctamente start/join/ping/pause/resume/seek y el ciclo completo de ads pre-roll a NPAW con `caracoltvdev`.
- **Metadata de contenido: VALIDADA** (content.id, type, duration, title, rendition).
- **3 bugs a corregir antes de release**: internalException al init (BUG-1), buffering sin beacon (BUG-2), bitrate -1 en pings (BUG-3).
- **No validable en este entorno**: userType (sin login), rendition manual (UI), adSkipped (sin ad skippable), background.

Adapter en uso: **generic-js**, no HTML5 nativo — origen probable de BUG-2 y BUG-3 (el adapter genérico no lee métricas de bitrate/buffer del elemento de video).
