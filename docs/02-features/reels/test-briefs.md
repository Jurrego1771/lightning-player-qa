---
type: test-briefs
feature: reels
version: "1.0"
status: draft
last_verified: 2026-04-26
---

# Test Briefs — Reels

---

## TB-01 — Player padre emite `ready` al inicializar con view=reels

```yaml
layer: integration
fixture: isolatedPlayer
determinism: high

preconditions:
  - Platform mocks activos (isolatedPlayer)
  - Content config retorna view.type = 'reels'
  - Al menos un ítem de contenido disponible en el feed (mock del endpoint /api/media/{id}/related/reels)

steps:
  - Arrange: cargar player con { type: 'media', id: MockContentIds.reels, view: 'reels', autoplay: false }
  - Act: esperar que el primer player hijo inicialice su api (script tag dinámico + loadConfig)
  - Assert: player.on('ready') se emitió exactamente 1 vez

signals:
  primary: evento 'ready' del player padre via player.on('ready')
  secondary: player.metadata !== null (indica que el ítem activo tiene datos)
  avoid: player.status — puede estar en transición al momento de la aserción

false_positive_risks:
  - El evento 'ready' del player hijo puede llegar antes de que el padre esté listo para escucharlo; registrar el listener antes de cargar el player
```

---

## TB-02 — Autoplay del primer ítem cuando `autoplay: true`

```yaml
layer: integration
fixture: isolatedPlayer
determinism: medium

preconditions:
  - Platform mocks activos
  - Stream HLS local disponible en localhost:9001
  - Content config del ítem apunta a stream local

steps:
  - Arrange: cargar player con { type: 'media', id: MockContentIds.reels, view: 'reels', autoplay: true }
  - Act: esperar evento 'ready'
  - Assert:
      1. player.paused === false (ítem activo reproduciéndose)
      2. player.status === 'playing'

signals:
  primary: player.paused === false
  secondary: player.status === 'playing'
  avoid: eventos play/playing del player padre (no se reenvían al emitter externo)

false_positive_risks:
  - En contextos sin interacción previa el browser puede bloquear autoplay; el test debe ejecutarse en Chromium con flag --autoplay-policy=no-user-gesture-required
  - player.paused puede ser false brevemente durante buffering del preload
```

---

## TB-03 — Navegación goNext avanza al siguiente ítem y emite `metadatachanged`

```yaml
layer: integration
fixture: isolatedPlayer
determinism: medium

preconditions:
  - Platform mocks activos
  - Feed con al menos 2 ítems (mock del endpoint related/reels)
  - player.on('ready') ya ocurrió
  - Primer ítem tiene metadata con title diferente al segundo

steps:
  - Arrange: cargar player, esperar 'ready' y primer 'metadatachanged'
  - Act: llamar player.goNext()
  - Assert:
      1. 'metadatachanged' se emite con metadata del segundo ítem
      2. metadata.playerType === 'reels'
      3. player.paused === false (nuevo ítem reproduciéndose)
      4. player anterior: player.paused no aplica (ya no es currentItemApi)

signals:
  primary: evento 'metadatachanged' con nuevo title
  secondary: player.metadata.title === titleDelSegundoItem
  avoid: asumir que metadatachanged se emite inmediatamente — puede haber latencia de metadataloaded del player hijo

false_positive_risks:
  - Si los dos ítems tienen el mismo id|src key, metadatachanged no se emitirá (BR-18). Usar ítems con ids distintos en el mock.
  - goNext tiene 10ms delay interno (setTimeout); esperar el evento, no el retorno de goNext
```

---

## TB-04 — Navegación goPrevious retrocede al ítem anterior

```yaml
layer: integration
fixture: isolatedPlayer
determinism: medium

preconditions:
  - Feed con al menos 2 ítems
  - Player inicializado y en el segundo ítem (después de goNext)

steps:
  - Arrange: cargar player, navegar a ítem 2 via goNext, esperar 'metadatachanged'
  - Act: llamar player.goPrevious()
  - Assert:
      1. 'metadatachanged' se emite con metadata del primer ítem
      2. player.paused === false

signals:
  primary: evento 'metadatachanged' con title del primer ítem
  secondary: player.metadata.title === titleDelPrimerItem
  avoid: verificar currentIndex directamente (atom interno, no público)

false_positive_risks:
  - Mismo riesgo de deduplicación de metadatachanged que en TB-03
```

---

## TB-05 — Botón goNext deshabilitado en el último ítem

```yaml
layer: integration
fixture: isolatedPlayer
determinism: high

preconditions:
  - Feed con exactamente 2 ítems (mocks controlados)
  - Player en el último ítem (índice 1)

steps:
  - Arrange: cargar player con 2 ítems, navegar al segundo via goNext
  - Act: verificar estado del botón de navegación "siguiente"
  - Assert: el botón con aria o selector de la flecha siguiente está disabled

signals:
  primary: button[disabled] en el control de navegación "siguiente"
  secondary: player.goNext() no produce 'metadatachanged' (no hay ítem siguiente)
  avoid: asumir que goNext lanza error — swiper?.slideNext() simplemente no avanza

false_positive_risks:
  - El mock del feed debe controlar exactamente la cantidad de ítems para que isLast sea determinista
```

---

## TB-06 — Volumen persiste entre ítems de contenido

```yaml
layer: integration
fixture: isolatedPlayer
determinism: high

preconditions:
  - Feed con al menos 2 ítems
  - player.on('ready') ocurrió

steps:
  - Arrange: cargar player, esperar 'ready'
  - Act:
      1. Setear player.volume = 0.5
      2. Llamar player.goNext()
      3. Esperar 'metadatachanged'
  - Assert: player.volume === 0.5 (volumen preservado en el nuevo ítem)

signals:
  primary: player.volume === 0.5 después de la navegación
  secondary: ninguna
  avoid: verificar volume del player hijo directamente (no accesible desde afuera)

false_positive_risks:
  - El volumen puede tomar un ciclo de render para propagarse al nuevo ítem; usar expect.poll()
```

---

## TB-07 — La metadata del ítem activo incluye `playerType: 'reels'`

```yaml
layer: contract
fixture: isolatedPlayer
determinism: high

preconditions:
  - player.on('metadatachanged') registrado antes de inicializar
  - Feed con al menos 1 ítem con title y description

steps:
  - Arrange: registrar listener 'metadatachanged', cargar player
  - Act: esperar evento 'metadatachanged'
  - Assert:
      1. metadata.playerType === 'reels'
      2. metadata.title es string no-vacío (si el contenido tiene título)
      3. metadata.description es string o null

signals:
  primary: payload del evento 'metadatachanged'
  secondary: player.metadata.playerType === 'reels'
  avoid: verificar player.metadata antes de 'metadatachanged' — puede ser null

false_positive_risks:
  - Si el ítem no tiene título ni descripción, el componente Metadata no renderiza pero el evento sí se emite
```

---

## TB-08 — `metadatachanged` del ad NO se propaga al player padre

```yaml
layer: integration
fixture: isolatedPlayer
determinism: medium

preconditions:
  - Feed configurado con ads habilitados (adsVast URL en contexto mock)
  - Interval de ads = 1 (primer ad aparece en índice 1)
  - Mock VAST server disponible

steps:
  - Arrange: cargar player con VAST URL, capturar todos los eventos 'metadatachanged'
  - Act: navegar a la primera posición de ad (índice 1)
  - Assert: ningún evento 'metadatachanged' se emite al padre durante el slide del ad

signals:
  primary: count de eventos 'metadatachanged' capturados durante el slide de ad === 0
  secondary: ninguna
  avoid: usar timers arbitrarios para "esperar" el evento — usar expect.poll con timeout definido

false_positive_risks:
  - Si el VAST falla con error, el ad slot se elimina (BR-25) y el siguiente ítem de contenido puede emitir metadatachanged en su lugar
```

---

## TB-09 — El endpoint `/api/media/{id}/related/reels` se consulta cuando se acerca al final del feed

```yaml
layer: integration
fixture: isolatedPlayer
determinism: high

preconditions:
  - Feed inicial de 3 ítems (1 ítem semilla + 2 del primer fetch, videosPreload=2)
  - Mock del endpoint related/reels interceptado con page.route()

steps:
  - Arrange: cargar player, interceptar requests a /api/media/*/related/reels
  - Act: navegar hasta que currentIndex + itemsToPreload > itemsLength - 1
  - Assert:
      1. El endpoint fue llamado con el id del último ítem no-ad
      2. Query param display === itemsToPreload (default 2)

signals:
  primary: request interceptado a /api/media/{lastItemId}/related/reels
  secondary: feed crece después del fetch (más slides disponibles)
  avoid: verificar el cache interno — no accesible desde afuera

false_positive_risks:
  - El fetch se dispara en el momento exacto del threshold; usar page.waitForRequest() con timeout generoso
```

---

## TB-10 — La plataforma NO es consultada cuando view=reels (BR-02)

```yaml
layer: contract
fixture: isolatedPlayer
determinism: high

preconditions:
  - Platform mocks activos via isolatedPlayer
  - Interceptor adicional en develop.mdstrm.com/media/{id}.json para registrar llamadas

steps:
  - Arrange: registrar interceptor para la URL de content config de la plataforma
  - Act: cargar player con view='reels'
  - Assert: el interceptor NO fue llamado para el player padre (solo los players hijos pueden llamar a la plataforma con data-player='dynamic')

signals:
  primary: ausencia de request a develop.mdstrm.com/{type}/{id}.json desde el contexto del player padre
  secondary: player 'ready' ocurre igualmente
  avoid: confundir requests de los players hijos con el padre

false_positive_risks:
  - Los players hijos SÍ hacen requests (con player='dynamic'). El interceptor debe distinguir por el player query param o por el orden de requests.
```

---

## Anti-patrones a evitar

```typescript
// ❌ Escuchar eventos de reproducción del player padre en reels
// Los eventos play/pause/playing NO se reenvían al emitter externo
player.on('playing', handler)  // nunca dispara en view=reels

// ✅ Verificar reproducción via API pública
const isPlaying = !player.paused
// o
const isPlaying = player.status === 'playing'
```

```typescript
// ❌ Asumir que metadatachanged se emite al navegar a cualquier ítem
await player.goNext()
// NO garantiza que metadatachanged ocurra si el ítem tiene la misma id|src key

// ✅ Esperar el evento con timeout y verificar el title
const metaPromise = new Promise(resolve => player.once('metadatachanged', resolve))
await player.goNext()
const meta = await Promise.race([metaPromise, timeout(3000).then(() => null)])
if (meta) expect(meta.title).not.toBe(previousTitle)
```

```typescript
// ❌ Verificar la cantidad de ítems en el feed via internals
// itemsInnerAtom no es accesible desde fuera del player

// ✅ Verificar si goNext tiene efecto observando metadatachanged o el estado del botón
await expect.poll(() => page.locator('[aria-label="Next"]').isDisabled()).toBeFalsy()
```

```typescript
// ❌ Setear volume en el player hijo directamente
// El player hijo no es accesible desde el player padre

// ✅ Setear volume via API del player padre
player.volume = 0.5
await expect.poll(() => player.volume).toBe(0.5)
```

```typescript
// ❌ Usar waitForTimeout para esperar que goNext complete
await player.goNext()
await page.waitForTimeout(500)  // frágil

// ✅ Esperar la señal correcta
const metaChanged = new Promise(res => player.once('metadatachanged', res))
await player.goNext()
await metaChanged
```

```typescript
// ❌ Esperar que el player padre consulte la plataforma al inicializar
// En view=reels, la config de la plataforma NO se consulta (BR-02)
await page.waitForRequest('**/media/**/*.json')  // nunca ocurre para el padre

// ✅ Esperar el evento 'ready' que confirma que el primer ítem hijo está listo
await player.waitForEvent('ready')
```
