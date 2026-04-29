---
type: test-briefs
feature: youbora
version: "1.0"
status: draft
last_verified: 2026-04-28
---

# Test Briefs — Youbora (NPAW Analytics)

Archivo sugerido: `tests/integration/youbora.spec.ts`

Estrategia general: interceptar requests de red hacia dominios NPAW con `page.route()`. El player se carga con `isolatedPlayer` (plataforma mockeada + stream local). La config de la plataforma se enriquece con el bloque `tracking.youbora` para activar el plugin.

No testear: procesamiento backend de NPAW, datos del dashboard Youbora, facturación, retención de sesión en el servidor NPAW.

---

## TB-01 — Youbora no se activa si `enabled` es falso en la config del player

```yaml
layer: integration
fixture: isolatedPlayer
determinism: high

preconditions:
  - Player config (player mock) NO tiene el bloque tracking.youbora o tiene enabled: false
  - Stream local disponible en localhost:9001

steps:
  - Arrange: |
      Interceptar toda request a dominios *.npaw.com y *.youbora.com con page.route()
      Montar isolatedPlayer con player config que NO incluye youbora.enabled=true
  - Act: |
      Iniciar reproducción (autoplay o player.play())
      Esperar evento contentFirstPlay
      Esperar 2 segundos adicionales
  - Assert: |
      Verificar que ninguna request fue interceptada hacia dominios NPAW

signals:
  primary: ausencia de requests a *.npaw.com / *.youbora.com
  secondary: evento contentFirstPlay recibido (confirma que el player sí reprodujo)
  avoid: player.on('youbora*') — no existe

false_positive_risks:
  - Si el stream no carga, contentFirstPlay nunca dispara y el test pasa vacío
  - Solución: assert explícito de que contentFirstPlay fue recibido antes de verificar ausencia de beacons
```

---

## TB-02 — Youbora no se activa si `account_code` está ausente aunque `enabled` sea true

```yaml
layer: integration
fixture: isolatedPlayer
determinism: high

preconditions:
  - Player config incluye tracking.youbora.enabled = true pero SIN account_code
  - Stream local disponible

steps:
  - Arrange: |
      Interceptar requests a *.npaw.com y *.youbora.com
      Montar isolatedPlayer con config: { tracking: { youbora: { enabled: true } } }
      (sin account_code)
  - Act: |
      Iniciar reproducción
      Esperar contentFirstPlay
      Esperar 2 segundos
  - Assert: |
      Ninguna request interceptada hacia NPAW
      contentFirstPlay fue recibido

signals:
  primary: ausencia de requests NPAW
  secondary: contentFirstPlay recibido

false_positive_risks:
  - Igual que TB-01: confirmar que contentFirstPlay disparó antes de verificar ausencia
```

---

## TB-03 — Youbora emite beacon de inicio cuando se produce contentFirstPlay

```yaml
layer: integration
fixture: isolatedPlayer
determinism: high

preconditions:
  - Player config incluye tracking.youbora.enabled = true y account_code = 'TEST_ACCOUNT'
  - Stream local HLS disponible en localhost:9001
  - page.route() configurado para interceptar y capturar requests a *.npaw.com/**

steps:
  - Arrange: |
      Registrar array beacons = []
      page.route('**/*.npaw.com/**', route => { beacons.push(route.request().url()); route.fulfill({status:200}) })
      Montar isolatedPlayer con youbora habilitado y account_code = 'TEST_ACCOUNT'
  - Act: |
      player.play() o autoplay: true
      Esperar evento contentFirstPlay (timeout 15s)
  - Assert: |
      Al menos 1 request capturada en beacons[]
      La URL de al menos 1 beacon contiene indicadores de inicio de sesión
      (el path exacto es interno al SDK — verificar solo que existe algún beacon)

signals:
  primary: request capturada a *.npaw.com después de contentFirstPlay
  secondary: contentFirstPlay recibido en el player
  avoid: verificar campos internos del payload — el SDK puede cambiarlos entre versiones

false_positive_risks:
  - El SDK puede hacer requests de ping antes de contentFirstPlay (requests de init del plugin)
  - Registrar el timestamp de contentFirstPlay y solo contar beacons post-ese-timestamp
```

---

## TB-04 — Youbora emite beacon de pausa cuando el usuario pausa

```yaml
layer: integration
fixture: isolatedPlayer
determinism: high

preconditions:
  - Youbora habilitado con account_code válido
  - Sesión ya iniciada (contentFirstPlay recibido)

steps:
  - Arrange: |
      Configurar intercepción de requests NPAW
      Montar player y esperar contentFirstPlay
      Registrar cantidad de beacons al momento de contentFirstPlay (N)
  - Act: |
      player.pause()
      Esperar evento pause
      Esperar 500ms para que el SDK procese
  - Assert: |
      Cantidad de beacons > N (al menos 1 beacon adicional tras la pausa)

signals:
  primary: request adicional a *.npaw.com después de player.pause()
  secondary: evento pause recibido en el player
  avoid: verificar el path exacto del beacon — es interno al SDK

false_positive_risks:
  - Heartbeats periódicos del SDK pueden generar beacons independientes de la pausa
  - Verificar que hay al menos 1 beacon en los 2s posteriores a la pausa
```

---

## TB-05 — Youbora ignora eventos de contenido durante un ad break

```yaml
layer: integration
fixture: isolatedPlayer
determinism: medium

preconditions:
  - Youbora habilitado
  - Mock VAST server disponible con un pre-roll
  - Sesión de contenido iniciada (contentFirstPlay recibido)

steps:
  - Arrange: |
      Interceptar requests NPAW
      Montar player con ad config apuntando a mock VAST pre-roll
      Esperar adsContentPauseRequested (inicio del ad break)
  - Act: |
      Esperar adsContentResumeRequested (fin del ad break)
  - Assert: |
      Durante el intervalo [adsContentPauseRequested, adsContentResumeRequested]:
        - No se emitieron beacons de contenido (pause/resume de contenido deben estar
          enmascarados por _inAdBreak = true)
      Después de adsContentResumeRequested:
        - Se emite al menos 1 beacon de contenido (fireResume)

signals:
  primary: ausencia de beacons de contenido durante _inAdBreak
  secondary: beacon de contenido tras adsContentResumeRequested
  avoid: verificar que los beacons de ads son los correctos — eso es responsabilidad del TB-06

false_positive_risks:
  - Determinism medium porque el timing de eventos de ads con IMA puede variar
  - Usar timeouts generosos (30s) para esperar adsContentResumeRequested
```

---

## TB-06 — Youbora emite beacons de ads durante el ciclo de vida de un ad

```yaml
layer: integration
fixture: isolatedPlayer
determinism: medium

preconditions:
  - Youbora habilitado
  - Mock VAST server disponible con un pre-roll completo (tiene quartile events)

steps:
  - Arrange: |
      Interceptar y registrar todas las requests NPAW
      Montar player con pre-roll VAST
  - Act: |
      Esperar adsAllAdsCompleted
  - Assert: |
      Se registraron al menos 4 beacons hacia NPAW durante el lifecycle del ad
      (correspondientes a: breakStart, adStart, al menos 1 quartile, adStop)
      Nota: los paths/params exactos son internos al SDK

signals:
  primary: 4+ requests a *.npaw.com entre adsStarted y adsAllAdsCompleted
  secondary: eventos adsStarted, adsComplete, adsAllAdsCompleted recibidos en el player
  avoid: verificar contenido exacto del payload de beacons

false_positive_risks:
  - Determinism medium: el mock VAST debe estar sirviendo correctamente
  - Si IMA no carga, adsStarted nunca dispara y el test cuelga
  - Usar timeout de 30s en la espera de adsAllAdsCompleted
```

---

## TB-07 — Youbora se reinicia correctamente tras player.load() con nuevo contenido

```yaml
layer: integration
fixture: isolatedPlayer
determinism: high

preconditions:
  - Youbora habilitado
  - Dos content configs disponibles (MockContentIds.vod y un segundo id mock)

steps:
  - Arrange: |
      Registrar todas las requests NPAW con timestamps
      Montar player con contenido 1
      Esperar contentFirstPlay del contenido 1
      Registrar N1 = cantidad de beacons hasta este momento
  - Act: |
      player.load({ type: 'media', id: MockContentIds.vod2 })
      Esperar contentFirstPlay del contenido 2 (timeout 15s)
  - Assert: |
      Beacons emitidos después del load() incluyen un nuevo beacon de inicio de sesión
      Total de beacons > N1
      El contenido de los beacons del segundo contenido NO incluye el id del primer contenido
      (verificar con el account_code, ya que el id de contenido va en el payload)

signals:
  primary: nuevo beacon de inicio (fireStart) emitido después del segundo contentFirstPlay
  secondary: contenido 2 reproduce (playing event recibido)
  avoid: verificar el id exacto del contenido en el payload del beacon — es interno al SDK

false_positive_risks:
  - El segundo load() puede tardar en completarse — usar timeout 20s
  - La limpieza del plugin (fireStop) ocurre antes del segundo fireStart;
    si el test mide solo "beacons > N1", puede pasar aunque el second init falle si hay heartbeats
  - Verificar explícitamente que el segundo contentFirstPlay fue recibido
```

---

## TB-08 — Youbora no emite beacons cuando el player se destruye antes de contentFirstPlay

```yaml
layer: integration
fixture: isolatedPlayer
determinism: high

preconditions:
  - Youbora habilitado
  - autoplay: false (para controlar el timing)

steps:
  - Arrange: |
      Registrar requests NPAW
      Montar player con autoplay: false
      Esperar evento ready
  - Act: |
      player.destroy() inmediatamente (sin llamar player.play())
  - Assert: |
      Ninguna request a NPAW fue capturada
      (tracker.destroy() fue llamado antes de que _started se pusiera true)

signals:
  primary: ausencia de requests NPAW
  secondary: evento ready recibido (confirma que el player se montó correctamente)
  avoid: ready no garantiza que YouboraTracker se montó — pero si no hay beacons, el test es válido

false_positive_risks:
  - El SDK NPAW puede hacer un request de "init" al instanciarse, antes de fireStart
  - Si el SDK hace un request de init, este test detectará ese beacon y podría fallar
  - Investigar empíricamente si npaw-plugin@7.3.28 hace algún request al instanciarse
    (este es un gap de conocimiento — ver edge-cases.md EC-07)
```

---

## TB-09 — Youbora reporta error fatal correctamente

```yaml
layer: integration
fixture: isolatedPlayer
determinism: high

preconditions:
  - Youbora habilitado
  - Sesión iniciada (contentFirstPlay recibido)
  - Posibilidad de forzar un error fatal (por ejemplo, cortar el stream mid-playback)

steps:
  - Arrange: |
      Interceptar requests NPAW
      Montar player y esperar contentFirstPlay
      Registrar N1 = cantidad de beacons
  - Act: |
      Forzar un error fatal (mockear error response en la plataforma, o abortar el stream)
      Esperar evento error del player (timeout 15s)
  - Assert: |
      Al menos 1 beacon adicional tras el error (correspondiente a fireFatalError o fireError)

signals:
  primary: request adicional a NPAW después del evento error
  secondary: evento error recibido en el player
  avoid: verificar si fue fireFatalError vs fireError — eso depende del flag data.fatal
    que no es siempre controlable en tests

false_positive_risks:
  - Forzar un error fatal confiablemente requiere control del stream
  - Usar el mock de error de plataforma (mockContentError) puede no disparar un error
    en el video element — verificar qué tipo de error dispara el player con ese mock
```

---

## Anti-patrones a evitar

```typescript
// Mal: verificar youbora por eventos del player que no son señal de youbora
// 'playing' dispara independientemente de si youbora está activo
player.on('playing', () => {
  expect(youboraIsActive).toBe(true)  // no hay forma de saber esto desde la API publica
})

// Bien: interceptar requests de red
const beacons: string[] = []
await page.route('**/*.npaw.com/**', route => {
  beacons.push(route.request().url())
  route.fulfill({ status: 200 })
})
await player.waitForEvent('contentFirstPlay')
expect(beacons.length).toBeGreaterThan(0)
```

```typescript
// Mal: asumir el dominio exacto de los beacons NPAW
await page.route('https://a-specific-account.npaw.com/specific-path', ...)
// El dominio puede variar por cuenta y versión de SDK

// Bien: usar wildcard amplio
await page.route('**/*.npaw.com/**', ...)
// o también cubrir el dominio youbora.com por si el SDK usa ambos
await page.route('**/*.youbora.com/**', ...)
```

```typescript
// Mal: esperar un numero exacto de beacons
expect(beacons.length).toBe(3)
// El SDK puede emitir heartbeats adicionales según el timing

// Bien: verificar al menos N beacons o verificar por tipo de evento
expect(beacons.length).toBeGreaterThan(0)
// O esperar a que se emitan en un tiempo acotado tras el evento del player
```

```typescript
// Mal: usar page.waitForTimeout() para "dar tiempo" a que el SDK envíe beacons
await page.waitForTimeout(5000)
// Frágil y lento

// Bien: usar expect.poll() para esperar condición con timeout
await expect.poll(() => beacons.length, { timeout: 5000 }).toBeGreaterThan(0)
```
