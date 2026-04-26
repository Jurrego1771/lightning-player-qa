---
type: test-briefs
feature: next-episode
version: "2.0"
status: draft
last_verified: 2026-04-26
---

# Test Briefs — Next Episode

---

## TB-01 — Contract: métodos API existen y retornan tipos correctos

```yaml
layer: contract
fixture: isolatedPlayer
determinism: high

preconditions:
  - player inicializado con MockContentIds.vod

steps:
  - Arrange: player listo (waitForEvent 'ready')
  - Act: llamar updateNextEpisode({}), keepWatching(), playNext()
  - Assert:
    - typeof updateNextEpisode({}) === 'undefined'
    - keepWatching() retorna objeto con key 'success' boolean
    - playNext() retorna objeto con key 'success' boolean

signals:
  primary: retorno de los 3 métodos
  avoid: no verificar efectos secundarios en este test

false_positive_risks:
  - Asumir que updateNextEpisode retorna {success} — retorna undefined
```

---

## TB-02 — Contract: 5 eventos nextEpisode* existen en catálogo

```yaml
layer: contract
fixture: isolatedPlayer
determinism: high

preconditions:
  - player inicializado

steps:
  - Arrange: player listo
  - Act: verificar que player.on() acepta los 5 eventos sin error
  - Assert: no excepción al registrar listeners para los 5 eventos

signals:
  primary: ausencia de error en player.on()

notes:
  - eventos a verificar: nextEpisodeIncoming, nextEpisodeConfirmed,
    nextEpisodePlayNext, nextEpisodeKeepWatching, nextEpisodeLoadRequested
```

---

## TB-03 — Happy path none view: incoming → autoload → transición real

```yaml
layer: integration
fixture: isolatedPlayer
determinism: high

preconditions:
  - player inicializado en type='media', view='none'
  - mock de content config con metadata.next = 'mock-episode-2'
  - nextEpisodeTime corto (5s) para acortar el test
  - stream local con duración conocida y corta

steps:
  - Arrange: goto con autoplay:true, nextEpisodeTime:5
  - Act: esperar que el tiempo restante alcance el umbral
  - Assert (en orden):
    1. nextEpisodeIncoming emitido
    2. ended emitido (o esperar fin del stream)
    3. nextEpisodeLoadRequested emitido
    4. sourcechange emitido
    5. metadataloaded emitido

signals:
  primary: [nextEpisodeIncoming, nextEpisodeLoadRequested, sourcechange, metadataloaded]
  secondary: [ready]
  avoid: player.metadata antes de metadataloaded

false_positive_risks:
  - nextEpisodeIncoming sin sourcechange no es transición completada
  - player.metadata puede tener datos del ep anterior
```

---

## TB-04 — keepWatching cancela autoload al terminar

```yaml
layer: integration
fixture: isolatedPlayer
determinism: high

preconditions:
  - player en none view con next episode disponible
  - nextEpisodeTime corto

steps:
  - Arrange: player ready con next disponible
  - Act 1: llamar keepWatching() antes de que ended dispare
  - Act 2: esperar ended
  - Assert:
    - keepWatching() retorna {success: true}
    - nextEpisodeKeepWatching emitido
    - ended emitido
    - sourcechange NO ocurre en los 3s posteriores a ended

signals:
  primary: ended sin sourcechange posterior
  secondary: nextEpisodeKeepWatching

false_positive_risks:
  - No esperar suficiente después de ended — el sourcechange puede llegar tarde
  - Llamar keepWatching() después de que la carga ya inició
```

---

## TB-05 — playNext carga inmediatamente sin esperar ended

```yaml
layer: integration
fixture: isolatedPlayer
determinism: high

preconditions:
  - player en none view con next episode disponible
  - nextEpisodeTime largo (30s), stream largo — para que ended no dispare solo

steps:
  - Arrange: player ready, playing, lejos del fin
  - Act: llamar playNext()
  - Assert (en orden):
    1. playNext() retorna {success: true}
    2. nextEpisodePlayNext emitido
    3. nextEpisodeLoadRequested emitido
    4. sourcechange emitido
    5. metadataloaded emitido

signals:
  primary: [nextEpisodePlayNext, nextEpisodeLoadRequested, sourcechange, metadataloaded]

false_positive_risks:
  - nextEpisodePlayNext sin sourcechange = dispatch sin carga efectiva
```

---

## TB-06 — updateNextEpisode confirma ep y datos llegan en load

```yaml
layer: integration
fixture: isolatedPlayer
determinism: high

preconditions:
  - player en none view con next episode disponible
  - nextEpisodeTime corto

steps:
  - Arrange: player ready
  - Act 1: llamar updateNextEpisode({ id: 'custom-ep', type: 'media', title: 'Custom' })
  - Assert 1: nextEpisodeConfirmed emitido con payload { id: 'custom-ep', ... }
  - Act 2: esperar carga automática (ended → autoload)
  - Assert 2: sourcechange ocurre (el ep confirmado fue el que cargó)

signals:
  primary: nextEpisodeConfirmed con payload correcto, luego sourcechange
  secondary: metadataloaded

false_positive_risks:
  - updateNextEpisode retorna undefined — no usarlo como señal de éxito
```

---

## TB-07 — nextEpisodeOverride bloquea autoload hasta confirmación

```yaml
layer: integration
fixture: isolatedPlayer
determinism: high

preconditions:
  - player en none view
  - loadConfig recibe nextEpisodeId (setea nextEpisodeOverride=true)
  - nextEpisodeTime corto

steps:
  - Arrange: player inicializado con nextEpisodeId en config
  - Act 1: esperar timeRemaining <= nextEpisodeTime + 5
  - Assert 1: nextEpisodeIncoming NO emitido (override sin confirmación)
  - Act 2: llamar updateNextEpisode({ id: '...', type: 'media' })
  - Assert 2: nextEpisodeConfirmed emitido
  - Assert 3: nextEpisodeIncoming emitido (ahora sí)
  - Act 3: esperar ended
  - Assert 4: sourcechange emitido (carga ocurrió)

signals:
  primary: ausencia de nextEpisodeIncoming hasta confirmación, luego presencia

false_positive_risks:
  - Timing: el umbral puede haberse pasado antes del updateNextEpisode
    → usar nextEpisodeTime suficientemente corto para controlar timing
```

---

## TB-08 — Tipos excluidos no disparan feature

```yaml
layer: integration
fixture: isolatedPlayer
determinism: high

preconditions:
  - player con next episode disponible en metadata

steps:
  - Arrange: inicializar player con type='live'
  - Act: reproducir hasta cerca del "final" (no aplica en live — solo verificar ausencia)
  - Assert: nextEpisodeIncoming NO emitido durante toda la sesión

  # Repetir para type='audio'

signals:
  primary: ausencia de nextEpisodeIncoming

notes:
  - En live no hay "fin" — verificar durante 30s de reproducción
```

---

## TB-09 — Reset en sourcechange: flags limpios para segundo contenido

```yaml
layer: integration
fixture: isolatedPlayer
determinism: high

preconditions:
  - player en none view
  - primer contenido con next disponible

steps:
  - Arrange: player ready, primer contenido
  - Act 1: llamar keepWatching() (setea flag)
  - Act 2: llamar player.load() con segundo contenido
  - Assert 1: sourcechange emitido (cambio de contenido)
  - Assert 2: nextEpisodeKeepWatching NO impide autoload del segundo contenido
    (el flag fue reseteado en sourcechange)
  - Act 3: esperar ended del segundo contenido
  - Assert 3: nextEpisodeLoadRequested emitido (autoload ocurrió)

signals:
  primary: sourcechange (reset) luego nextEpisodeLoadRequested en segundo ended

false_positive_risks:
  - Si el segundo contenido no tiene next en metadata, el test pasará por razón incorrecta
  - Asegurarse que el mock del segundo contenido también incluye metadata.next
```

---

## TB-10 — Video view: overlay visible en umbral correcto

```yaml
layer: e2e
fixture: player (real CDN)
determinism: medium

preconditions:
  - contenido VOD con next episode disponible en plataforma real
  - nextEpisodeTime conocido (leer de la respuesta de config)

steps:
  - Arrange: player en video view, cerca del fin del contenido
  - Act: esperar que timeRemaining alcance nextEpisodeTime
  - Assert:
    1. nextEpisodeIncoming emitido
    2. Overlay DOM visible (selector del componente)
    3. Botón "Next" presente y enabled
    4. Botón "Watch Credits" presente

signals:
  primary: overlay DOM visible + nextEpisodeIncoming
  avoid: asumir que nextEpisodeIncoming = overlay visible (umbrales distintos)
```

---

## TB-11 — Video view: controles bloqueados mientras overlay visible

```yaml
layer: e2e
fixture: player (real CDN)
determinism: medium

preconditions:
  - overlay visible (TB-10 como precondición)

steps:
  - Arrange: overlay visible
  - Act: llamar player.play(), player.pause(), player.currentTime = X
  - Assert:
    - player.play() retorna false
    - player.pause() retorna false
    - player.currentTime = X no cambia currentTime

signals:
  primary: retorno false de los métodos
```

---

## TB-12 — Video view: click en Créditos oculta overlay y no carga

```yaml
layer: e2e
fixture: player (real CDN)
determinism: medium

preconditions:
  - overlay visible

steps:
  - Arrange: overlay visible con botones
  - Act: click en botón "Watch Credits"
  - Assert:
    1. Overlay oculto (DOM no visible)
    2. sourcechange NO ocurre en los 10s posteriores
    3. Contenido continúa reproduciendo (player.status === 'playing')

signals:
  primary: overlay oculto + ausencia de sourcechange
```

---

## Anti-patrones a evitar

```typescript
// ❌ player.metadata como señal de carga completada
const meta = await player.getMetadata()
expect(meta.id).toBe('next-episode-id')  // puede ser el episodio anterior

// ✅ sourcechange + metadataloaded en orden
await player.waitForEvent('sourcechange')
await player.waitForEvent('metadataloaded')

// ❌ playNext() retorno como señal de carga completada
const result = await player.playNext()
// result.success === true solo confirma dispatch, NO que cargó

// ✅ nextEpisodeLoadRequested confirma intención; sourcechange confirma ejecución
player.playNext()
await player.waitForEvent('nextEpisodeLoadRequested')
await player.waitForEvent('sourcechange')

// ❌ updateNextEpisode() esperando {success}
const r = await player.updateNextEpisode({})
expect(r.success).toBe(true)  // retorna undefined — test siempre falla

// ❌ waitForTimeout para el timer de 5s
await page.waitForTimeout(6000)

// ✅ waitForEvent con timeout generoso
await player.waitForEvent('nextEpisodeLoadRequested', { timeout: 10_000 })

// ❌ selector CSS interno del overlay
page.locator('.msp-next-episode--hidden')

// ✅ visibilidad del contenedor o aria-label
page.locator('[aria-label="Next episode"]')

// ❌ asumir nextEpisodeIncoming = overlay visible (umbrales distintos)
// incoming dispara en timeRemaining <= nextEpisodeTime + 5
// overlay aparece en timeRemaining <= nextEpisodeTime
// Son dos condiciones distintas — no usar uno como proxy del otro
```
