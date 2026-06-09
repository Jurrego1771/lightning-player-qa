# NPAW QA Report — Youbora Integration
**Fecha recepción**: 2026-06-06  
**Estado**: En investigación  
**Scope**: Lightning Player + NPAW SDK 7.3.28

---

## Reporte recibido

| Test ID | Comentario NPAW QA | Estado |
|---------|-------------------|--------|
| 1.4 | UI doesn't allow to select a different content while one is being reproduced. | ⬜ Pendiente |
| 2.17 | Not reported. | ⬜ Pendiente |
| 7.2 | UI doesn't allow to select a different content while one is being reproduced. | ⬜ Pendiente |
| A.2.2 | Not reported. | ✅ Resuelto — No bug (test timing, campo sí se reporta con VMAP) |
| A.2.4 | Not reported. | ✅ Resuelto — No bug (mismo que A.2.2) |
| A.2.13 | Not reported, or field reported as null. | ✅ Resuelto — No bug (campo sí se reporta, NPAW probó con VAST no-skippable) |
| A.2.16 | Reported as null. | 🐛 Bug — tracker.js no extrae ad.getMediaUrl() del IMA ad object |
| A.2.17 | Reported as null. | 🐛 Bug — tracker.js no extrae ad.getTitle() del IMA ad object |
| A.2.19 | Reported as null. | 🐛 Bug — tracker.js no extrae ad.getAdSystem() del IMA ad object |
| A.2.23 | Not reported. | 🐛 Bug — tracker.js onAdsSkipped no llama adsAdapter.fireSkip() |
| A.3.1 | Scenario 1 keeps happening when ad is being reproduced. View doesn't remain open if we move the content's tab to put it in PIP. Expected? | ❓ Consultar NPAW — comportamiento de Page Visibility API |
| A.3.3 | /bufferUnderrun event created. Not /adBufferUnderrun event appearing. | 🐛 Bug — tracker.js sin handler adsAdBuffering → fireBufferBegin() |
| A.4.1 | /bufferUnderrun event created. Not /adBufferUnderrun event appearing. | 🐛 Bug — depende de A.3.3 (mismo root cause) |
| A.5.1 | /error event sent and specified in view details in Tracking. No /adError appearing. | ✅ Resuelto — test pasa en develop, ya corregido |
| A.5.2 | /error event sent and specified in view details in Tracking. No /adError appearing. | ✅ Resuelto — test pasa en develop, ya corregido |
| A.5.3 | /error event sent and specified in view details in Tracking. No /adError appearing. | ✅ Resuelto — test pasa en develop, ya corregido |
| A.5.4 | /error event sent and specified in view details in Tracking. No /adError appearing. | ✅ Resuelto — test pasa en develop, ya corregido |

---

## Investigación por ítem

### 1.4 — UI doesn't allow to select a different content while one is being reproduced

**Descripción NPAW**: El caso de prueba requiere cambiar de contenido manualmente mientras se reproduce un video.  
**Observación**: La UI del player no expone un selector de contenido durante la reproducción.

- **¿Bug del player?** No
- **¿Bug de la UI del cliente?** No aplica
- **¿Comportamiento esperado?** ✅ Confirmado correcto
- **Evidencia**: El Lightning Player es un componente embebido — no tiene selector de contenido propio. El cambio de contenido es responsabilidad de la UI del cliente (playlist, carrusel, etc.) via `player.load()`. El tracker responde correctamente: emite `/stop` para la vista anterior y `/start` para la nueva. Verificado en test automatizado `NPAW-1.4/7.2` (tests/integration/youbora.spec.ts).
- **Conclusión**: ✅ No es bug. El tester de NPAW no pudo disparar el escenario porque no había UI cliente en su entorno de prueba. El mecanismo del tracker funciona correctamente. Responder a NPAW: *"El player es un componente embebido sin selector de contenido propio. El cambio se realiza via `player.load()`. El tracker emite /stop + /start correctamente en ese evento, verificado con tests automatizados."*

---

### 2.17 — Not reported (user.type)

**Descripción NPAW**: El parámetro `user.type` no aparece en los beacons de Youbora.  
**Param esperado**: `userType` en POST body del beacon `/start`.  
**Fuente del valor**: `customer_extras.type` — campo opcional que el cliente inyecta al inicializar el player.

- **¿Bug del player?** No
- **¿Config no establecida en producción?** ✅ Confirmado — no es campo de plataforma
- **Evidencia**: El response de la plataforma (`/video/{id}.json`) no incluye `customer_extras` en ningún nivel. Es un campo que el cliente (sitio web embebedor) debe pasar explícitamente al inicializar el player: `player.init({ 'customer_extras.type': 'premium' })`. El tracker lee ese valor y lo mapea a `userType` en el beacon `/start`. Verificado: el mecanismo funciona correctamente cuando el campo está presente (test NPAW-2.17a pasa). NPAW testeó sin configurarlo → correcto que no aparezca.
- **Conclusión**: ✅ No es bug. Configuración opcional del cliente. Responder a NPAW: *"`user.type` se reporta cuando el cliente pasa `customer_extras.type` al inicializar el player. No es un campo de la plataforma — es responsabilidad de la implementación del cliente según su sistema de autenticación de usuarios."*

---

### 7.2 — UI doesn't allow to select a different content while one is being reproduced

**Descripción NPAW**: Cambio de contenido por interacción de usuario. El tracker debe emitir `/stop` para la vista actual y `/start` con metadata actualizada (nuevo `content.id`, `title`, `resource`) para el nuevo contenido.

- **¿Bug del player?** No
- **Evidencia**: Mismo diagnóstico que 1.4. El player es componente embebido — no tiene selector de contenido propio. El tracker responde correctamente a `player.load()`: emite `/stop` + nuevo `/start` con metadata actualizada. Cubierto por tests `NPAW-1.4/7.2` (verificación de beacons /stop + /start) y `NPAW-2.15` (verificación de title y resource actualizados en el segundo /start).
- **Conclusión**: ✅ No es bug. Mismo cierre que 1.4. Responder a NPAW: *"El cambio de contenido se realiza via `player.load()`. El tracker emite /stop + /start con metadata del nuevo contenido correctamente. No hay selector de contenido en la UI del player — es responsabilidad del cliente."*

---

### A.2.2 — Not reported (breaksTime)

**Descripción NPAW**: El parámetro `breaksTime` (horarios de los breaks en el VMAP) no aparece en los beacons.  
**Param esperado**: `ad.breaksTime` en beacon del break start, derivado del VMAP.

- **¿Bug del player?** No
- **Root cause real**: El test original capturaba `beacons.slice()` inmediatamente después de `adsContentPauseRequested`, antes de que NPAW enviara el `/adBreakStart` (los beacons NPAW son HTTP requests asíncronas — llegan ~100-500ms después del evento del player).
- **Evidencia**: Después de agregar `expect.poll(() => beacons.some(b => b.includes('adBreakStart') || b.includes('adStart')), { timeout: 15_000 })` antes de capturar, el test **pasó** — `breaksTime` está presente en los beacons.
- **Por qué NPAW lo reportó como "Not reported"**: Probable causa — su entorno de prueba usó un VAST único (no VMAP), por lo que no había schedule de breaks para reportar. `breaksTime` solo aparece cuando hay VMAP con múltiples breaks.
- **Conclusión**: ✅ No es bug del player. El campo se reporta correctamente con VMAP. Test corregido (timing fix). Responder a NPAW: *"`ad.breaksTime` se reporta correctamente cuando se usa un VMAP con múltiples breaks. Si en su ambiente de prueba usaron un VAST individual (sin VMAP), el campo no aparece porque no hay schedule de breaks. Verificado con test automatizado usando VMAP de 3 breaks."*

---

### A.2.4 — Not reported (expectedPattern)

**Descripción NPAW**: El parámetro `expectedPattern` (patrón de breaks del VMAP) no aparece en los beacons.  
**Param esperado**: `ad.expectedPattern` en beacon del break start.

- **¿Bug del player?** No
- **Root cause real**: Mismo que A.2.2 — timing del test. El campo sí se reporta con VMAP.
- **Evidencia**: El mismo test A.2.1/A.2.2/A.2.3/A.2.4 con el timing fix pasó, incluyendo la aserción `expectedPattern.not.toBeNull()`.
- **Conclusión**: ✅ No es bug del player. Mismo cierre que A.2.2. Mismo mensaje a NPAW.

---

### A.2.13 — Not reported / null (skippable flag)

**Descripción NPAW**: El flag `skippable` (si el ad es saltable) no se reporta o llega como null.  
**Param esperado**: `skippable: true` en POST body de `/adStart` cuando el VAST tiene `skipoffset`.

- **¿Bug del player?** No
- **Evidencia**: Test `NPAW-A.2.13` pasa con VAST skippable (`/vast/preroll-skippable`). `parseBeaconParam(adStartUrl, 'ad.isSkippable') = 'true'`. Cross-check `player.isAdSkippable()` también retorna `true`. El campo se reporta correctamente en el POST body del `/adStart`.
- **Por qué NPAW lo reportó**: Probable causa — NPAW testeó con un VAST sin `skipoffset`, en cuyo caso el campo es `false` o ausente (comportamiento correcto). O su viewer de beacons no muestra campos del POST body, solo URL params.
- **Conclusión**: ✅ No es bug. Responder a NPAW: *"`ad.isSkippable` se reporta como `true` en el POST body del `/adStart` beacon cuando el VAST contiene atributo `skipoffset`. Verificado con test automatizado. Si el VAST no tiene `skipoffset`, el campo es `false`/ausente — comportamiento correcto."*

---

### A.2.16 — Reported as null (adResource)

**Descripción NPAW**: El campo `adResource` (URL del MediaFile del ad) llega como null.  
**Param esperado**: `adResource` = URL del MP4/HLS del ad en beacon `/adStart`.

- **¿Bug del player?** Sí
- **Root cause**: `tracker.js buildAdOptions()` no llama `ad.getMediaUrl()` del IMA ad object. El VAST tiene `<MediaFile>` con URL `http://localhost:9001/ads/preroll.mp4` pero `adResource` = null en el POST body del `/adStart`.
- **Mismo root cause que**: A.2.17 y A.2.19 — `buildAdOptions()` no extrae ninguno de estos campos del IMA ad object.
- **Evidencia**: Test `NPAW-A.2.16/A.2.17/A.2.18` falla en la aserción `ad.title.not.toBeNull()` (primer campo verificado). `adStartUrl` del beacon solo tiene params de sesión — el POST body no tiene `adTitle`, `adResource`, `adProvider`.
- **Conclusión**: 🐛 Bug. tracker.js debe llamar `ad.getTitle()`, `ad.getMediaUrl()`, y `ad.getAdSystem()` al construir el objeto de opciones para `fireAdStart()`.

---

### A.2.17 — Reported as null (adTitle)

**Descripción NPAW**: El campo `adTitle` (título del ad del VAST `<AdTitle>`) llega como null.  
**Param esperado**: `adTitle` = valor del `<AdTitle>` en beacon `/adStart`.

- **¿Bug del player?** Sí
- **Root cause**: Mismo que A.2.16. El VAST tiene `<AdTitle>QA NPAW Test Ad - Title Visible</AdTitle>` pero `adTitle` = null en el beacon.
- **Evidencia**: Test falla con `A.2.17: ad.title must be present — Received: null`. Confirmado en dos runs (con retry).
- **Conclusión**: 🐛 Bug. Mismo fix que A.2.16.

---

### A.2.19 — Reported as null (adProvider / VAST AdSystem)

**Descripción NPAW**: El campo `adProvider` (sistema de ads, `<AdSystem>` del VAST) llega como null.  
**Param esperado**: `adProvider` = valor del `<AdSystem>` (ej. "MediastreamQA") en beacon `/adStart`.

- **¿Bug del player?** Sí
- **Root cause**: `tracker.js buildAdOptions()` no llama `ad.getAdSystem()`. El VAST tiene `<AdSystem>MediastreamQA</AdSystem>` pero `body['adProvider']` = null.
- **Aclaración importante**: `adInsertionType = "client"` (CSAI) SÍ se reporta correctamente — es un campo separado (A.2.20). La confusión en el test original fue hacer fallback a `ad.insertionType` → "client" y compararlo con "MediastreamQA". El test fue corregido para verificar solo `ad.provider` → `adProvider`.
- **Evidencia**: Test `NPAW-A.2.19` corregido falla: `adProvider = null`.
- **Conclusión**: 🐛 Bug. tracker.js debe extraer `ad.getAdSystem()` y mapearlo a `adProvider` en `buildAdOptions()`.

---

### A.2.23 — Not reported (adSkipped)

**Descripción NPAW**: El evento de skip del ad no se reporta en NPAW.  
**Param esperado**: Beacon `/adSkip` cuando el usuario salta un ad skippable.

- **¿Bug del player?** Sí
- **Root cause**: `tracker.js onAdsSkipped` NO llama `adsAdapter.fireSkip()`. El player SÍ emite el evento `adsSkipped` correctamente (player API funciona). El problema está en el handler del tracker: probablemente solo llama `fireStop()` sin llamar `fireSkip()`.
- **Evidencia**: Test `NPAW-A.2.23` falla. Secuencia confirmada: `isAdSkippable()=true` → `player.skipAd()` → evento `adsSkipped` recibido → pero poll de 10s para `/adSkip` o `/skip` retorna false (cero beacons con esa substring).
- **Fix requerido**: En `tracker.js`, el handler de `adsSkipped` debe llamar `this._adsAdapter?.fireSkip()` ANTES de cualquier `fireStop()`.
- **Conclusión**: 🐛 Bug. tracker.js no reporta skip a NPAW.

---

### A.3.1 — View closes when tab moved to PIP during ad

**Descripción NPAW**: Cuando la pestaña se mueve a PIP (Picture-in-Picture) mientras se reproduce un ad, la view de NPAW se cierra.

- **¿Bug del player?** Por determinar
- **Análisis**: El NPAW SDK puede enviar `/stop` cuando `document.visibilityState` cambia a `hidden` (comportamiento controlado por `background.settings`). Durante PIP en algunos browsers, la pestaña puede ponerse en estado hidden. Esto es configurable en el NPAW SDK.
- **Conclusión**: ❓ Consultar con NPAW. Preguntar: ¿cuál es el comportamiento esperado del SDK para `background.settings` durante PIP? ¿Debe configurarse `pause: false` para mantener la view abierta? No automatizable con Playwright (no hay API de PIP headless).

---

### A.3.3 — /bufferUnderrun en vez de /adBufferUnderrun

**Descripción NPAW**: Stall durante ad → `/bufferUnderrun` (content adapter) en lugar de `/adBufferUnderrun` (ad adapter).

- **¿Bug del player?** Sí
- **Root cause**: `tracker.js` no tiene handler para el evento de buffering durante ads → no llama `adsAdapter.fireBufferBegin()`.
- **Evidencia**: Test `NPAW-A.3.3` falla — poll de 15s para `/adBufferUnderrun` o `/adBuffer` retorna false. El stall de 4s se introduce vía `page.route()` en el MP4 del ad, ad comienza (`waitForAdStart` pasa) pero beacon de ad buffer nunca llega.
- **Fix requerido**: En `tracker.js`, agregar handler para el evento de buffering del ad (`adsAdBuffering` o equivalente IMA) que llame `this._adsAdapter?.fireBufferBegin()`. Análogamente, `fireBufferEnd()` cuando el buffering termine.
- **Conclusión**: 🐛 Bug.

---

### A.4.1 — adBufferDuration ausente (depende de A.3.3)

**Descripción NPAW**: Mismo síntoma que A.3.3 — `adBufferDuration` nunca llega porque el beacon de `/adBufferUnderrun` nunca se envía.

- **Root cause**: Mismo que A.3.3.
- **Conclusión**: 🐛 Bug. Bloqueado por A.3.3 — se resuelve con el mismo fix.

---

### A.5.1 — /adError cuando MediaFile bloqueado antes de play

**Descripción NPAW**: Cuando el MediaFile del ad está bloqueado antes de reproducirse, se reporta `/error` en lugar de `/adError`.

- **¿Bug del player?** No (resuelto en develop)
- **Evidencia**: Test `NPAW-A.5.1` pasa en la versión actual (`develop`). El beacon `/adError` se envía correctamente con `errorCode` cuando el MediaFile URL devuelve 404.
- **Conclusión**: ✅ Ya corregido. La versión que NPAW evaluó puede haber sido anterior al fix. Responder a NPAW: *"Verificado y corregido en versión actual. `/adError` se reporta correctamente."*

---

### A.5.2 — /adError cuando VAST falla al cargar

- **¿Bug del player?** No (resuelto en develop)
- **Evidencia**: Test `NPAW-A.5.2` pasa. `/adError` con errorCode llega cuando VAST URL devuelve error de red.
- **Conclusión**: ✅ Ya corregido. Mismo mensaje a NPAW que A.5.1.

---

### A.5.3 — /adError cuando MediaFile falla durante playback

- **¿Bug del player?** No (resuelto en develop)
- **Evidencia**: Test `NPAW-A.5.3` pasa. `/adError` con errorCode llega cuando el video element recibe error durante reproducción.
- **Conclusión**: ✅ Ya corregido.

---

### A.5.4 — /adError cuando falla la red durante playback del ad

- **¿Bug del player?** No (resuelto en develop)
- **Evidencia**: Test `NPAW-A.5.4` pasa. `/adError` con errorCode llega tras abort de conexión.
- **Conclusión**: ✅ Ya corregido.

---

## Leyenda

| Símbolo | Significado |
|---------|-------------|
| ⬜ Pendiente | Sin investigar |
| 🐛 Bug player | Confirmado bug en tracker.js o IMA adapter |
| ⚙️ Config | No es bug — falta configuración del cliente |
| 🎨 UI | Limitación o decisión de diseño de la UI |
| ❓ Consultar NPAW | Requiere aclaración con el equipo NPAW |
| ✅ Resuelto | Investigado y cerrado |
