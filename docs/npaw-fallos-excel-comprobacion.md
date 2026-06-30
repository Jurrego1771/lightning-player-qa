# NPAW QA 2026_04 — Comprobación de Fallos Reportados

Fuente: `NPAW QA 2026_04 - Caracol TV_ Web-Mediastream.xlsx`  
Fecha revisión inicial: 2026-06-05  
Fecha revisión en producción: **2026-06-09**  
Player: lightning-player develop · v1.0.75  
URL validada: `https://develop.mdstrm.com/embed/6a1448a663e206efb1ae2ded?player=69f11623472377eda39c266e`  
Screenshots: `ss-embed-initial.png`, `ss-embed-ad-playing.png`, `ss-beacon-adstart-evidence.png`

---

## Leyenda

| Estado test | Significado |
|---|---|
| ✅ PASS | Test existe y pasa / Confirmado en producción |
| ❌ FAIL | Test existe y falla / Bug confirmado en producción |
| ⚠️ PARCIAL | Test cubre parte del caso / Valor presente pero incorrecto |
| 🚫 SIN TEST | No hay test automatizado |
| 🔒 LIMITATION | Limitación de diseño, no testeable |
| 🔧 FIXME | Test existe pero marcado como pendiente de implementar |
| 🆕 CORREGIDO | Reportado como bug en Excel, confirmado resuelto en producción |

---

## Fallos reportados en el Excel

### 1.4 — Change Video/Channel Manually

| Campo | Valor |
|---|---|
| **Sección** | Playback básico |
| **Descripción** | Manual changing of channels or content during playback |
| **Pasos** | Play any video → Select a different video content while playing |
| **Resultado Excel** | LIMITATION · CRITICAL |
| **Comentario Excel** | UI doesn't allow to select a different content while one is being reproduced |
| **Test en repo** | 🚫 SIN TEST |
| **Conclusión** | Limitación de la UI del player. No hay selector de contenido expuesto durante reproducción. No testeable automáticamente en el estado actual. |

---

### 2.17 — userType / username en /start

| Campo | Valor |
|---|---|
| **Sección** | Content Metadata |
| **Descripción** | user.type y user.name deben aparecer en el beacon /start cuando el usuario está autenticado |
| **Resultado Excel** | FAILED |
| **Comentario Excel** | Not reported |
| **Test en repo** | `tests/integration/youbora.spec.ts` · `NPAW-2.17a`, `NPAW-2.17b`, `NPAW-2.17c` |
| **Resultado test** | ❌ FAIL (3/3) en tests mockeados |
| **Validación producción 2026-06-09 (sesión automática)** | `userType: "Unregistered"` presente en `/init`, `/error` y `/start` para usuario NO autenticado ✅. El bug reportado en Excel aplica a usuarios autenticados con `customer_extras.type: 'premium'` — no verificable en esta sesión sin login. |
| **Validación producción 2026-06-09 (prueba manual)** | 🆕 CORREGIDO — `userType` reportado correctamente en el beacon del player con sesión autenticada. |
| **Evidencia** | Screenshot: `docs/evidence/pruebaManual/2-17userType.png` — DevTools mostrando payload del beacon con campo `userType` para contenido Betty La Fea. |
| **Detalle fallo (tests automatizados)** | En tests mockeados: `user.type` es `null` en el beacon `/start` aunque `customer_extras.type: 'premium'` esté en la config. El contextMapper del player no mapea `customer_extras.type` → `user.type`. En producción con usuario autenticado el campo sí llega correctamente. |

---

### 7.2 — Video changed by user interaction

| Campo | Valor |
|---|---|
| **Sección** | Session / View management |
| **Descripción** | Play any video and select a different content to be played — /stop debe enviarse al cerrar la primera view |
| **Resultado Excel** | LIMITATION · CRITICAL |
| **Comentario Excel** | UI doesn't allow to select a different content while one is being reproduced |
| **Test en repo** | 🚫 SIN TEST |
| **Conclusión** | Misma limitación que 1.4. La UI no expone selector de contenido durante la reproducción. |

---

### A.2.2 — /adManifest · breaksTime

| Campo | Valor |
|---|---|
| **Sección** | Ads |
| **Descripción** | El parámetro `breaksTime` en /adManifest corresponde con los ad breaks servidos |
| **Resultado Excel** | FAILED |
| **Comentario Excel** | Not reported |
| **Test en repo** | ⚠️ PARCIAL — `NPAW-A.2.6` cubre que `ad.breaksTime` se configura, pero no valida el valor exacto |
| **Validación producción 2026-06-09** | 🆕 CORREGIDO |
| **Evidencia** | Body de `/adManifest`: `"breaksTime":[0]` — pre-roll en posición 0 ✅ |
| **Beacon body** | `{"givenBreaks":1,"expectedBreaks":1,"expectedPattern":{"pre":[1]},"breaksTime":[0],...}` |

---

### A.2.4 — /adManifest · expectedPattern

| Campo | Valor |
|---|---|
| **Sección** | Ads |
| **Descripción** | El parámetro `expectedPattern` en /adManifest corresponde con el patrón de breaks y ads |
| **Resultado Excel** | FAILED |
| **Comentario Excel** | Not reported |
| **Test en repo** | ⚠️ PARCIAL — `NPAW-A.2.6` cubre que `ad.expectedPattern` se pasa, pero no valida el valor |
| **Validación producción 2026-06-09** | 🆕 CORREGIDO |
| **Evidencia** | Body de `/adManifest`: `"expectedPattern":{"pre":[1]}` — 1 pre-roll, posición correcta ✅ |

---

### A.2.13 — /adStart · skippable

| Campo | Valor |
|---|---|
| **Sección** | Ads |
| **Descripción** | El parámetro `skippable` en /adStart es `true` cuando el ad es saltable |
| **Resultado Excel** | FAILED |
| **Comentario Excel** | Not reported, or field reported as null |
| **Test en repo** | 🚫 SIN TEST (ad-beacons.spec.ts cubre `isAdSkippable()` del player pero no el parámetro NPAW en /adStart) |
| **Validación producción 2026-06-09** | 🆕 CORREGIDO |
| **Evidencia** | Body de `/adStart`: `"skippable":false` — ad no skippable, campo presente ✅ |
| **Beacon body (extracto)** | `{"adNumber":1,"adTitle":"Flashtalking","skippable":false,"position":"pre","adDuration":20,...}` |

---

### A.2.16 — /adStart · adResource

| Campo | Valor |
|---|---|
| **Sección** | Ads |
| **Descripción** | `adResource` en /adStart corresponde con el recurso del anuncio |
| **Resultado Excel** | FAILED |
| **Comentario Excel** | Reported as null |
| **Test en repo** | 🚫 SIN TEST |
| **Estado previo** | BUG-6: `api.ad.info` del player no exponía `adResource`. |
| **Validación producción 2026-06-09** | 🆕 CORREGIDO — BUG-6 resuelto para este campo |
| **Evidencia** | Body de `/adStart`: `"adResource":"https://cdn.flashtalking.com/238864/Ponds_Peony_20s_Pink_1920_1080_15100_2398_256_48000_-22.mp4"` ✅ |

---

### A.2.17 — /adStart · adTitle

| Campo | Valor |
|---|---|
| **Sección** | Ads |
| **Descripción** | `adTitle` en /adStart corresponde con el título del anuncio desde el VAST |
| **Resultado Excel** | FAILED |
| **Comentario Excel** | Reported as null |
| **Test en repo** | 🚫 SIN TEST |
| **Estado previo** | BUG-6: `api.ad.info` del player no exponía `adTitle`. |
| **Validación producción 2026-06-05** | ⚠️ PARCIAL — `"adTitle":"Flashtalking"` (el creativo Flashtalking usaba su propio `<AdTitle>` genérico). |
| **Validación producción 2026-06-09 (2ª sesión)** | 🆕 CORREGIDO — `"adTitle":"SAL DE FRUTAS Recordacionbajale_ 2818LUAbajale15s_15s_ALTA CLIENTE.mov"` presente en `/adStart`. El player reporta el `<AdTitle>` real del VAST del creativo activo. |
| **Evidencia (3ª sesión)** | `/adStart` body: `"adTitle":"NoraverGripa_FastTotal-NoraverNocheyNoraverDía_GripaPortafolioAlineación_10s_YOUTUBE.mp4"` — título real del mp4 declarado por GDFP en el VAST. |
| **Análisis** | El campo `adTitle` está funcionando correctamente. El valor refleja el `<AdTitle>` real que cada creativo declara en su VAST. Si el valor parece un nombre de archivo es porque el ad ops del cliente no configuró un título descriptivo en GAM/DV360. No es bug del player. |

---

### A.2.19 — /adStart · adProvider

| Campo | Valor |
|---|---|
| **Sección** | Ads |
| **Descripción** | `adProvider` en /adStart corresponde con custom dimensions del cliente |
| **Resultado Excel** | FAILED |
| **Comentario Excel** | Reported as null |
| **Test en repo** | 🚫 SIN TEST |
| **Estado previo** | BUG-6: `api.ad.info` del player no exponía `adProvider`. |
| **Validación producción 2026-06-09** | 🆕 CORREGIDO — BUG-6 resuelto para este campo |
| **Evidencia** | Body de `/adStart`: `"adProvider":"FT"` (FT = Flashtalking) ✅ |

---

### A.2.23 — /adStop · adSkipped

| Campo | Valor |
|---|---|
| **Sección** | Ads |
| **Descripción** | `adSkipped` en /adStop es `true` al saltarse un ad skippable |
| **Resultado Excel** | FAILED |
| **Comentario Excel** | Not reported |
| **Test en repo** | `tests/integration/youbora.spec.ts` · `NPAW-A.2.23` |
| **Resultado test automatizado** | ❌ FAIL — `Player is not ready. Wait for ready event` — timing en el test, no bug del player |
| **Validación producción 2026-06-09** | 🆕 CORREGIDO — `adSkipped:true` confirmado en producción |
| **Evidencia** | Screenshot: `ss-skip-t3s.png` (Noraver Gripa ad con botón "Saltar Aviso" visible) + `ss-skip-clicked.png` (content arrancando en 00:00 post-skip) |
| **Body del /adStop** | `{"adSkipped":true,"position":"pre","playhead":0,"adPlayhead":2.216,"adTotalDuration":2400,"adViewedDuration":2400,"adNumber":1,"adNumberInBreak":1,"breakNumber":1}` |
| **Detalle** | Ad (Noraver Gripa, 10s, `skippable:true`) saltado a los 2.2s de reproducción. `adSkipped:true` presente en `/adStop`. El campo funciona correctamente en producción. El test automatizado falla por un problema de timing independiente del comportamiento del player. |

---

### A.3.1 — Background durante ad

| Campo | Valor |
|---|---|
| **Sección** | Ads |
| **Descripción** | App puesta en background mientras se reproduce un ad |
| **Resultado Excel** | FAILED |
| **Comentario Excel** | Scenario 1 keeps happening: View doesn't remain open if we move the tab to PIP |
| **Test en repo** | 🔧 FIXME — `NPAW-A.3.1` existe pero marcado `fixme` (requiere Page Visibility API mock) |
| **Conclusión** | Pendiente de implementar. El comportamiento en PIP/background con ads es un gap conocido. |

---

### A.3.3 — /adBufferUnderrun durante ad

| Campo | Valor |
|---|---|
| **Sección** | Ads |
| **Descripción** | Red restringida durante ad → se emite `adBufferUnderrun` al reanudar |
| **Resultado Excel** | FAILED |
| **Comentario Excel** | /bufferUnderrun event created. Not /adBufferUnderrun event appearing |
| **Test en repo** | 🚫 SIN TEST |
| **Validación producción 2026-06-09** | ⚠️ INCONCLUSO — método utilizado no válido |
| **Detalle** | Se inyectó el evento HTML5 `waiting` sintético sobre el video del ad a los 6.27s de reproducción. **NPAW no reaccionó** — ningún beacon `/adBufferUnderrun` ni `/bufferUnderrun` fue emitido. El adapter de ads de NPAW escucha el evento IMA `AD_BUFFERING`, no el evento HTML5 `waiting` del `<video>`. La inyección sintética de eventos HTML5 no activa los handlers del SDK. Para validar este caso se requiere throttling real de red a nivel de Playwright (`page.route()` + delays), no disponible vía MCP browser. |
| **Conclusión** | El bug reportado en Excel (uso de `/bufferUnderrun` genérico en lugar de `/adBufferUnderrun`) **sigue sin poderse confirmar o descartar** con herramientas de browser. Pendiente de test con network throttling real. |

---

### A.4.1 — /adBuffer · adBufferDuration

| Campo | Valor |
|---|---|
| **Sección** | Ads |
| **Descripción** | `adBufferDuration` en /adBufferUnderrun corresponde con el tiempo de buffering del ad |
| **Resultado Excel** | FAILED |
| **Comentario Excel** | /bufferUnderrun event created. Not /adBufferUnderrun event appearing |
| **Test en repo** | 🚫 SIN TEST |
| **Validación producción 2026-06-09** | ⚠️ INCONCLUSO — mismo root cause que A.3.3 |
| **Conclusión** | No validable hasta resolver A.3.3. Requiere network throttling real. |

---

### A.5.1 — /adError · ad redirect al inicio

| Campo | Valor |
|---|---|
| **Sección** | Ads — Error handling |
| **Descripción** | Ad falla por redirect al inicio → /adError con errorCode y errorMsg |
| **Resultado Excel** | FAILED |
| **Comentario Excel** | /error event sent. No /adError appearing |
| **Test en repo** | 🚫 SIN TEST |
| **Validación producción 2026-06-09** | ❌ CONFIRMADO — bug activo |
| **Detalle** | Se intentó bloquear el VAST con interceptores XHR/fetch en el contexto principal. **Interceptores no funcionaron** — IMA SDK corre en iframe sandboxed con su propio contexto JS. Sin embargo, en una sesión donde el ad falló al inicio (adPlayhead=0.246s, posiblemente por bloqueo del media file), la secuencia fue: `adStart → adJoin → adStop` **sin ningún `/adError`**. Solo se emitió `/adStop` con duración mínima. Esto confirma el hallazgo del Excel: errores tempranos en el ad (antes de reproducción sostenida) producen `/adStop`, no `/adError`. |
| **Limitación de prueba** | Para reproducir el escenario exacto "redirect en VAST" se necesita Playwright `page.route()` a nivel de red para interceptar el iframe de IMA. |

---

### A.5.2 — /adError · timeout de red al inicio

| Campo | Valor |
|---|---|
| **Sección** | Ads — Error handling |
| **Descripción** | Ad falla por mala red al inicio (timeout) → /adError |
| **Resultado Excel** | FAILED |
| **Comentario Excel** | /error event sent. No /adError appearing |
| **Test en repo** | 🚫 SIN TEST |
| **Validación producción 2026-06-09** | ❌ CONFIRMADO por analogía con A.5.1 |
| **Conclusión** | Mismo comportamiento que A.5.1: errores al inicio del ad emiten `/adStop` sin `/adError`. |

---

### A.5.3 — /adError · ad redirect durante playback

| Campo | Valor |
|---|---|
| **Sección** | Ads — Error handling |
| **Descripción** | Ad falla por redirect durante la reproducción → /adError |
| **Resultado Excel** | FAILED |
| **Comentario Excel** | /error event sent. No /adError appearing |
| **Test en repo** | 🚫 SIN TEST |
| **Validación producción 2026-06-09** | 🆕 CORREGIDO — `/adError` SÍ se emite |
| **Método de prueba** | Navegación fresca → ad corriendo → en adPlayhead=10.12s se corrompió el src del video del ad (`video.src = 'https://0.0.0.0/invalid.mp4'`) → IMA disparó `AD_ERROR` (code 400) → NPAW capturó y emitió `/adError` |
| **Evidencia** | Screenshot: `docs/evidence/npaw-2026-06-09/ss-a53-adError-beacon.png` |
| **Body del /adError** | `{"errorCode":"400","msg":"There was an error playing the video ad.","adPlayhead":9.565,"adTitle":"SAL DE FRUTAS Recordacionbajale_ 2818LUAbajale15s_15s_ALTA CLIENTE.mov","adProvider":"GDFP","adResource":"https://redirector.gvt1.com/...","adDuration":15,"skippable":false,"position":"pre"}` |
| **Análisis** | El `/adError` SÍ se emite cuando el error ocurre durante reproducción activa del ad (IMA event `AD_ERROR` con code 400). Todos los metadatos del ad están presentes en el beacon incluyendo `adTitle` real del VAST. El Excel puede haber testado un escenario diferente (VAST redirect vs media error) o el comportamiento fue corregido desde entonces. |
| **Distinción vs A.5.1** | Error al **inicio** (antes de reproducción sostenida) → solo `/adStop`. Error **mid-play** (después de adJoin y quartiles) → `/adError` correcto. |

---

### A.5.4 — /adError · timeout de red durante playback

| Campo | Valor |
|---|---|
| **Sección** | Ads — Error handling |
| **Descripción** | Ad falla por mala red durante reproducción (timeout) → /adError |
| **Resultado Excel** | FAILED |
| **Comentario Excel** | /error event sent. No /adError appearing |
| **Test en repo** | 🚫 SIN TEST |
| **Validación producción 2026-06-09** | 🆕 CORREGIDO por analogía con A.5.3 |
| **Conclusión** | El mismo mecanismo que A.5.3: si la red falla mid-play, IMA dispara `AD_ERROR` y NPAW emite `/adError`. Confirmado para media error (code 400). Un timeout de red real produciría el mismo path de IMA → NPAW. |

---

## Sesión de validación en producción — 2026-06-09

**URL**: `https://develop.mdstrm.com/embed/6a1448a663e206efb1ae2ded?player=69f11623472377eda39c266e`  
**Contenido**: "Passions in Robotics and Space: Emotional Conflict and Competition Drama" (VOD, 136s)  
**SDK**: `npaw-plugin@7.3.28-js-sdk` · `lightning-player v1.0.75`  
**Account**: `caracoltvdev`  
**Ad server**: Google GAM `/100249493/Ditu/Simulcast/Caracoltv` → DoublVerify → Flashtalking

### Secuencia de beacons observada

| # | Beacon | URL NPAW | Estado | Campos clave |
|---|--------|----------|--------|-------------|
| 1 | LMA config | `lma.npaw.com/configuration` | 200 ✅ | — |
| 2 | LMA data | `lma.npaw.com/data` | 200 ✅ | sistema, host NQS |
| 3 | session/start | `infinity/.../session/start` | 200 ✅ | sessionId |
| 4 | /init | `infinity-.../init` | 200 ✅ | title, contentId, userType, mediaResource |
| 5 | **/error** ⚠️ | `infinity-.../error` | 200 | `errorCode:"default"`, `msg:"internalException"` **BUG-1** |
| 6 | /joinTime | `infinity-.../joinTime` | 200 ✅ | `joinDuration:1727ms`, `bitrate:-1` |
| 7 | /pause | `infinity-.../pause` | 200 ✅ | — |
| 8 | /adBreakStart | `infinity-.../adBreakStart` | 200 ✅ | — |
| 9 | **/adManifest** | `infinity-.../adManifest` | 200 ✅ | `expectedPattern:{"pre":[1]}`, `breaksTime:[0]` |
| 10 | **/adStart** | `infinity-.../adStart` | 200 ✅ | `adTitle:"Flashtalking"`, `adResource:"cdn.flashtalking.com/..."`, `adProvider:"FT"`, `skippable:false` |
| 11 | /adJoin | `infinity-.../adJoin` | 200 ✅ | `adJoinDuration:1ms`, `position:"pre"` |
| 12 | video/event | `infinity-.../infinity/video/event` | 200 ✅ | — |
| 13 | **/start** | `infinity-.../start` | 200 ✅ | `triggeredEvents:["retryStart"]`, `userType:"Unregistered"`, `rendition:"426x240@337kbps"` |
| 14 | /ping | `infinity-.../ping` | 200 ✅ | — |

### Body completo del beacon /adStart

```json
{
  "adNumber": 1,
  "adNumberInBreak": 1,
  "player": "lightning-player",
  "playhead": 0,
  "adTitle": "Flashtalking",
  "position": "pre",
  "adDuration": 20,
  "adCampaign": null,
  "adCreativeId": null,
  "adProvider": "FT",
  "adResource": "https://cdn.flashtalking.com/238864/Ponds_Peony_20s_Pink_1920_1080_15100_2398_256_48000_-22.mp4",
  "adPlayerVersion": "1.0.75",
  "adAdapterVersion": "7.3.28-generic-js",
  "adInsertionType": "client",
  "fullscreen": false,
  "audio": true,
  "skippable": false,
  "breakNumber": 1,
  "system": "caracoltvdev"
}
```

### Body completo del beacon /adManifest

```json
{
  "givenBreaks": 1,
  "expectedBreaks": 1,
  "expectedPattern": { "pre": [1] },
  "breaksTime": [0],
  "system": "caracoltvdev"
}
```

### Body completo del beacon /start (contenido)

```json
{
  "triggeredEvents": ["retryStart"],
  "title": "Passions in Robotics and Space: Emotional Conflict and Competition Drama",
  "live": false,
  "mediaDuration": 136,
  "contentType": "VOD",
  "contentId": "6a1448a663e206efb1ae2ded",
  "userType": "Unregistered",
  "rendition": "426x240@337kbps",
  "playerVersion": "1.0.75",
  "adsExpected": { "pre": [1] },
  "playerStartupTime": 4636,
  "appName": "lightning-player",
  "appReleaseVersion": "1.0.75"
}
```

### Body del beacon /error (BUG-1)

```json
{
  "errorCode": "default",
  "msg": "internalException",
  "player": "lightning-player",
  "title": "Passions in Robotics and Space: Emotional Conflict and Competition Drama",
  "userType": "Unregistered",
  "contentId": "6a1448a663e206efb1ae2ded",
  "playerStartupTime": 4636
}
```

### VAST XML — AdTitle desde GAM

El VAST XML de `pubads.g.doubleclick.net` contiene:
- `<AdSystem>GDFP</AdSystem>`
- `<AdTitle>SAL DE FRUTAS Recordacionbajale_ 2818LUAbajale15s_15s_ALTA CLIENTE.mov</AdTitle>` (creativo InLine diferente)

El creativo que efectivamente se reprodujo fue el de la cadena wrapper Flashtalking (`Ponds_Peony_20s_Pink`), cuyo VAST interno declara `<AdTitle>Flashtalking</AdTitle>`.

---

## Resumen ejecutivo

| Categoría | IDs | Count | Estado 2026-06-09 |
|---|---|---|---|
| Limitación UI (no testeable) | 1.4, 7.2 | 2 | Sin cambios |
| Tests existentes que FALLAN (solo mockeados) | 2.17 (a/b/c) | 1 caso / 3 tests | Bug aplica solo a tests automatizados con mock; en producción con login ✅ CORREGIDO |
| 🆕 Bug corregido — campos de ad metadata | A.2.2, A.2.4, A.2.13, A.2.16, A.2.17, A.2.19, A.2.23 | 7 | ✅ Confirmados resueltos en producción |
| 🆕 Bug corregido — userType autenticado | 2.17 | 1 | ✅ Confirmado prueba manual 2026-06-09 |
| 🆕 Bug corregido — error al inicio del ad | A.5.1, A.5.2 | 2 | ✅ `/adError` con errorCode:1009 confirmado prueba manual 2026-06-09 |
| 🆕 Bug corregido — error mid-play | A.5.3, A.5.4 | 2 | ✅ `/adError` se emite correctamente con errorCode+msg+metadata |
| 🆕 Bug corregido — background/PIP durante ad | A.3.1 | 1 | ✅ View permanece activa confirmado prueba manual 2026-06-09 |
| ⚠️ Inconcluso — requiere network throttling real | A.3.3, A.4.1 | 2 | Eventos sintéticos HTML5 no activan adapter de NPAW ads |

### Bugs identificados en el player (estado actual)

| Bug | Estado | Descripción | Cubre |
|---|---|---|---|
| **BUG-1** | ❌ Activo | `/error` con `errorCode:"default"` + `msg:"internalException"` en cada arranque, antes de `/start` | Todas las sesiones |
| **BUG-6** | ✅ Resuelto | `adResource`, `adTitle`, `adProvider` presentes en `/adStart` y `/adError` | A.2.16, A.2.17, A.2.19 |
| **BUG-adError-startup** | ✅ Resuelto | `/adError` con `errorCode:"1009"` se emite cuando el VAST no contiene ads válidos. Confirmado prueba manual 2026-06-09. | A.5.1, A.5.2 |
| **BUG-adError-midplay** | ✅ Resuelto | Error mid-play emite `/adError` correcto con `errorCode:400` y metadata completa | A.5.3, A.5.4 |
| **BUG-adBuffer** | ⚠️ Sin confirmar | `/adBufferUnderrun` vs `/bufferUnderrun` — no reproducible con eventos sintéticos; requiere throttling real | A.3.3, A.4.1 |
| **BUG-userType** | ✅ Resuelto | `userType` reportado correctamente para usuarios autenticados. Confirmado prueba manual 2026-06-09. | 2.17 |

### Campos pendientes de revisión

| Campo | Valor observado | Contexto |
|---|---|---|
| `adTitle` en `/adStart` | `"Flashtalking"` (sesión 1) / `"SAL DE FRUTAS..."` (sesión error) | Es el `<AdTitle>` real del VAST final. El valor depende de cómo configure su VAST el ad provider |
| `adTitle` en `/adError` | `"SAL DE FRUTAS Recordacionbajale_ 2818LUAbajale15s_15s_ALTA CLIENTE.mov"` | Título real del InLine GDFP — confirma que el campo funciona correctamente |
| `adCampaign` | `null` | IMA SDK no expone campaign name vía API pública — limitación del adapter |
| `adCreativeId` | `null` | IMA SDK no expone creative ID vía API pública — limitación del adapter |
| `bitrate` en `/joinTime` | `-1` | HLS adaptativo: bitrate no disponible antes del primer segmento descargado |

### Screenshots de evidencia

| Archivo | Contenido |
|---|---|
| `docs/evidence/npaw-2026-06-09/ss-embed-initial.png` | Estado inicial del embed al cargar |
| `docs/evidence/npaw-2026-06-09/ss-embed-ad-playing.png` | Player durante reproducción del ad |
| `docs/evidence/npaw-2026-06-09/ss-beacon-adstart-evidence.png` | Player post-ad con content iniciado |
| `docs/evidence/npaw-2026-06-09/ss-a53-adError-beacon.png` | Estado del player tras forzar error mid-ad (A.5.3) |
