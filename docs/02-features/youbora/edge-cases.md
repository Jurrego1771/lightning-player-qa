---
type: edge-cases
feature: youbora
version: "1.0"
status: draft
last_verified: 2026-04-29
---

# Edge Cases — Youbora (NPAW Analytics)

## EC-01 — Youbora disabled: enabled = false en config del player

El plugin loader verifica `options?.metadata?.player?.tracking?.youbora?.enabled`. Si el valor no es truthy (`1`, `'1'`, `true`, `'true'`), el componente `YouboraTracker` nunca se monta. El tracker ni siquiera se instancia.

Esto incluye el caso en que el bloque `tracking.youbora` no existe en la respuesta del player config. El operador `?.` devuelve `undefined` que `indexOf` trata como falsy.

[CODE: src/plugins/index.js:34,41]  
Coverage: ❌ Sin test

---

## EC-02 — account_code presente en enabled pero valor null o vacío

`YouboraAnalytics` extrae `accountCode` con `context.options?.metadata?.player?.tracking?.youbora?.account_code`. Si el campo es `null`, `undefined`, o string vacío `''`, el componente se monta (porque `enabled` era truthy) pero `tracker.init()` retorna en la línea `if (!accountCode) return` sin llamar a `new NpawPlugin`.

El resultado observable: el componente React existe pero no hay plugin NPAW activo y no se emiten beacons.

[CODE: src/analytics/youbora/tracker.js:57-59]  
[CODE: src/analytics/youbora/index.jsx:39]  
Coverage: ❌ Sin test

---

## EC-03 — Ad break durante contenido (adsContentPauseRequested)

Cuando el player emite `adsContentPauseRequested`, el tracker pone `_inAdBreak = true`. Todos los eventos de contenido subsiguientes (`playing`, `pause`, `seeking`, `seeked`, `buffering`, `canplay`) son ignorados por el content adapter hasta que `adsContentResumeRequested` ponga `_inAdBreak = false`.

Caso específico a probar: si el usuario pausa el contenido DENTRO del ad break (lo que no debería ocurrir normalmente con IMA pero podría en errores de estado), el `onPause` handler retorna sin llamar `firePause` debido a la guarda `_inAdBreak`.

[CODE: src/analytics/youbora/tracker.js:101-105]  
[CODE: src/analytics/youbora/tracker.js:133-143]  
Coverage: ❌ Sin test

---

## EC-04 — Seek durante reproducción (seeking/seeked correctos)

El tracker diferencia entre seek-begin y seek-end. Si el player emite `seeking` pero nunca emite `seeked` (por ejemplo, si el stream se interrumpe durante el seek), el NPAW adapter queda en estado "seeking" indefinidamente hasta que se produzca otro `seeked` o el tracker sea destruido.

No hay timeout ni manejo especial de seek sin completar en el código del player.

[CODE: src/analytics/youbora/tracker.js:113-121]  
Coverage: ❌ Sin test

---

## EC-05 — Error durante reproducción: fatal vs no-fatal

El handler `onError` se ejecuta para cualquier error del player, independientemente de si la sesión está started o no (la guarda solo verifica `if (!this._adapter) return`). Si ocurre un error antes de `contentFirstPlay` (por ejemplo, error de carga de fuente), el error se reportará a NPAW aunque `_started` sea false.

La distinción fatal/no-fatal depende del campo `data.fatal` del error. Si el error no tiene ese campo, el código usa `fireFatalError` o `fireError` según si el campo es truthy.

[CODE: src/analytics/youbora/tracker.js:145-154]  
Coverage: ❌ Sin test

---

## EC-06 — Player destruido mid-session (destroy antes de ended)

Cuando el player se destruye (React unmount), `componentWillUnmount` llama a `super.componentWillUnmount()` que llama a `restart(true)`. En `YouboraAnalytics.restart(shouldDestroy=true)`, se llama `tracker.destroy()`. En `tracker.destroy()`, se llama `_cleanup()` que llama `adapter.fireStop()` para cerrar la sesión en NPAW antes de destruir el plugin.

Si el adapter no existe (porque el plugin nunca se inicializó), `_cleanup` maneja esto con el try/catch.

[CODE: src/analytics/youbora/index.jsx:14-17]  
[CODE: src/plugins/baseComponent.js:59-62]  
[CODE: src/analytics/youbora/tracker.js:252-279]  
Coverage: ❌ Sin test

---

## EC-07 — Instancia de NpawPlugin antes de cualquier beacon: ¿init-request? — RESUELTO

**Confirmado empíricamente (2026-04-29):** `npaw-plugin@7.3.28` SÍ realiza requests HTTP al instanciarse con `new NpawPlugin(accountCode, options)`, antes de cualquier `fireXxx`. Específicamente emite dos requests LMA:

```
GET lma.npaw.com/configuration?system=...&pluginVersion=7.3.28-js-sdk&...
GET lma.npaw.com/data?system=...&pluginVersion=7.3.28-js-sdk&...
```

Estos requests se emiten en el momento de montar `YouboraTracker` (al resolver `loadMSPlayer`), **antes de `contentFirstPlay`** y antes de cualquier `fireStart/fireJoin`.

**Impacto en TB-08** (destroy antes de contentFirstPlay): el test que verifica "0 beacons tras destroy() sin play" puede capturar 2 beacons LMA aunque el plugin nunca llegue a `fireStart`. El test debe decidir qué verificar:
- Opción A: verificar 0 beacons de NQS (`youboranqs01.com`) — estos sí son 0 si no hay play
- Opción B: aceptar que `beacons.length` puede ser 2 (LMA init) y solo verificar ausencia de `/start`/`/joinTime`

Los tests en `youbora.spec.ts` TB-08 usan interceptores separados para LMA y NQS, por lo que si se filtra por NQS (`youboranqs01.com`) la aserción de 0 beacons sigue siendo válida.

[CODE: src/analytics/youbora/tracker.js:62]  
Coverage: ❌ Sin test — comportamiento SDK ahora documentado

---

## EC-08 — Multi-instancia: dos players en la misma página

El sistema de plugins carga una instancia de `YouboraAnalytics` por player instance. Cada instancia del tracker crea su propio `new NpawPlugin(accountCode)`. El paquete NPAW puede tener estado global o puede manejar múltiples instancias independientemente — esto es comportamiento del SDK, no del código del player.

El código del player no tiene ningún mecanismo de coordinación entre múltiples instancias de Youbora en la misma página.

[CODE: src/analytics/youbora/tracker.js:62]  
Coverage: ❌ Sin test

---

## EC-09 — Interrupción de red durante sesión activa

Si la red se interrumpe durante la reproducción, el player emitirá `buffering` y eventualmente `error`. El tracker enviará `fireBufferBegin` ante `buffering`. Si el error es fatal, se enviará `fireFatalError`. Los beacons NPAW fallarán si la red está caída, pero eso es comportamiento del SDK (reintentos, etc.) — no del código del player.

El tracker no tiene ningún mecanismo de retry propio para beacons fallidos.

[CODE: src/analytics/youbora/tracker.js:122-130]  
Coverage: ❌ Sin test

---

## EC-10 — player.load() llamado antes de que contentFirstPlay haya disparado

Si `player.load()` se llama antes de que el contenido original haya disparado `contentFirstPlay`, el tracker habrá iniciado (`_started = false`) pero los handlers ya están vinculados. En `restart(newOptions)`, `_cleanup()` llama a `adapter.fireStop()` aunque `_started` sea false. Esto puede enviar un beacon de stop para una sesión que nunca comenzó.

El try/catch en `_cleanup` no previene el `adapter.fireStop()` en este caso — solo protege contra errores en `removeAdsAdapter`/`removeAdapter`.

[CODE: src/analytics/youbora/tracker.js:265-272]  
[CODE: src/analytics/youbora/tracker.js:84-86]  
Coverage: ❌ Sin test

---

## EC-11 — `type = 'episode'` activa campos de metadata específicos

Cuando `type === 'episode'`, el tracker envía campos adicionales a NPAW: `content.program` (de `metadata.show`), `content.season` (de `metadata.season`), y `content.episodeTitle` (del título). Si `metadata.show` o `metadata.season` no existen en la respuesta de la plataforma, esos campos no se envían (hay guardas explícitas).

El tipo `episode` se mapea a `'VOD'` en Youbora (no existe un tipo "episode" en NPAW).

[CODE: src/analytics/youbora/tracker.js:32-38]  
[CODE: src/analytics/youbora/tracker.js:9-12]  
Coverage: ❌ Sin test

---

## EC-12 — DNT (Do Not Track) no afecta directamente a Youbora

El plugin loader verifica el flag `dnt` del player config para decidir si montar `StreamMetrics` y `GoogleTracker`. Sin embargo, para `YouboraTracker`, el flag `dnt` NO se verifica. Si `youbora.enabled = true` y `account_code` está presente, Youbora se activa incluso si `dnt = true`.

Esto es una diferencia de comportamiento respecto a otros trackers (StreamMetrics y GoogleTracker respetan `dnt`).

[CODE: src/plugins/index.js:35,54-56,62-65]: StreamMetrics y Google respetan dnt  
[CODE: src/plugins/index.js:41-62]: Youbora no tiene condición dnt  
Coverage: ❌ Sin test
