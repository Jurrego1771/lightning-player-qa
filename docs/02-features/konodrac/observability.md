---
type: observability
feature: konodrac
version: "1.0"
status: draft
last_verified: 2026-05-05
---

# Observability — Konodrac Mark Collector API

## Cómo funciona el pixel tracking

El tracker usa `getImage()` (`src/helper/getImage.js`) — crea un `<img>` en el DOM con `src = URL_con_params`. El browser hace un GET automático al src. El servidor responde con cualquier imagen (o 200 vacío). No hay XHR, no hay `fetch`.

```js
// Internamente en el tracker:
getImage('https://marker.konograma.com/track', {
  dataset: 'CARTV_OTT_TEST',
  event:   'firstplay',
  cid:     'content-id',
  channel: 'CARTV',
  pageType: 'VOD',
  sysEnv:  'web',
  secsPlayed: 0,
  playerStatus: 'PLAYING',
  currentPosition: 0,
  gdpr: 1,
  gdpr_consent: 'TCString',
  cb: Date.now()
})
```

URL resultante:
```
GET https://marker.konograma.com/track?dataset=CARTV_OTT_TEST&event=firstplay&cid=...&channel=CARTV&pageType=VOD&sysEnv=web&secsPlayed=0&playerStatus=PLAYING&currentPosition=0&gdpr=1&gdpr_consent=TCString&cb=1746...
```

---

## Señales observables

### Red (principal)

Interceptar con `page.route()` hacia `marker.konograma.com`. Todos los parámetros están en la query string — directamente legibles en la URL interceptada.

```typescript
await page.route(/marker\.konograma\.com/, async (route) => {
  const url = new URL(route.request().url())
  const event = url.searchParams.get('event')  // 'mloaded', 'firstplay', 'play', ...
  // ...capturar params
  await route.fulfill({ status: 200, body: '' })
})
```

**IMPORTANTE**: interceptar ANTES de `player.goto()` — `mloaded` puede disparar antes del evento `ready`.

---

## Patrón recomendado de interceptación

```typescript
async function setupKonodracInterceptor(page: Page): Promise<KonodracBeacon[]> {
  const beacons: KonodracBeacon[] = []

  await page.route(/marker\.konograma\.com/, async (route) => {
    const url = new URL(route.request().url())
    beacons.push({
      event:           url.searchParams.get('event')          ?? '',
      dataset:         url.searchParams.get('dataset')        ?? '',
      cid:             url.searchParams.get('cid')            ?? '',
      channel:         url.searchParams.get('channel')        ?? '',
      pageType:        url.searchParams.get('pageType')       ?? '',
      sysEnv:          url.searchParams.get('sysEnv')         ?? '',
      secsPlayed:      Number(url.searchParams.get('secsPlayed')      ?? -1),
      playerStatus:    url.searchParams.get('playerStatus')   ?? '',
      currentPosition: Number(url.searchParams.get('currentPosition') ?? -1),
      uid:             url.searchParams.get('uid'),
      gdpr:            url.searchParams.get('gdpr')           ?? '',
      gdpr_consent:    url.searchParams.get('gdpr_consent')   ?? '',
      cb:              url.searchParams.get('cb')             ?? '',
      raw:             route.request().url(),
    })
    await route.fulfill({ status: 200, body: '' })
  })

  return beacons  // array mutable — se actualiza en tiempo real
}
```

---

## API pública del player — sin exposición de estado Konodrac

```js
player.konodrac    // undefined — no existe
player.analytics   // undefined — no existe
```

La única forma de observar Konodrac es interceptando las requests de red.

---

## Secuencia de beacons esperada — sesión VOD normal

```
page.goto(player)
  → [platform mocks: player config + content config]

player init:
  → mloaded: secsPlayed=0, playerStatus=PAUSED, currentPosition=0

player.play() / autoplay:
  → firstplay: secsPlayed=0, playerStatus=PLAYING, currentPosition=0

(reproducción activa — cada 50s):
  → mhb: secsPlayed≈50, playerStatus=PLAYING, currentPosition≈50
  → mhb: secsPlayed≈100, playerStatus=PLAYING, currentPosition≈100

player.pause():
  → pause: secsPlayed=N, playerStatus=PAUSED, currentPosition=N

player.play() (reanudación):
  → play: secsPlayed=N, playerStatus=PLAYING, currentPosition=N

player.seek(30):
  → seek: secsPlayed=N, playerStatus=PLAYING|PAUSED, currentPosition=30

(fin de contenido):
  → endplay: secsPlayed=total, playerStatus=PAUSED, currentPosition=duration

player.destroy():
  → dispose: secsPlayed=total, playerStatus=PAUSED|PLAYING
```

---

## Secuencia esperada — sesión LIVE con seek

```
goto(type: 'live')
  → mloaded: pageType=LIVE, secsPlayed=0

play:
  → firstplay: pageType=LIVE, secsPlayed=0

(reproducción activa 30s):
  → [sin mhb todavía — falta 20s]

seek a posición pasada:
  → seek: pageType=CATCHUP, secsPlayed=0  [pageType ya cambió en el beacon]

(reproducción desde CATCHUP 50s):
  → mhb: pageType=CATCHUP, secsPlayed≈50

seek al live edge:
  → seek: pageType=LIVE, secsPlayed=0  [volvió al live edge — reset]
```

---

## Fake clock para tests de mhb

`mhb` usa `setInterval(fn, 50_000)`. Para testear sin esperar 50s reales, usar Playwright clock API:

```typescript
test('mhb fires at 50s', async ({ page, isolatedPlayer }) => {
  await page.clock.install()  // instalar ANTES de page.goto
  const beacons = await setupKonodracInterceptor(page)
  await mockPlayerConfig(page, KONODRAC_CONFIG)
  
  await isolatedPlayer.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
  await isolatedPlayer.waitForEvent('contentFirstPlay')
  
  // Avanzar el reloj 50s — dispara el setInterval del mhb
  await page.clock.runFor(50_000)
  
  await expect.poll(() => beacons.filter(b => b.event === 'mhb')).toHaveLength(1)
})
```

**Requiere Playwright ≥ 1.45**. Este repo usa 1.59 — compatible.

**`runFor` vs `fastForward`**: usar `runFor` — ejecuta los timers que disparan en el intervalo. `fastForward` solo avanza el tiempo sin ejecutar callbacks.

---

## Mock TCF/GDPR para tests

```typescript
await page.addInitScript(() => {
  (window as any).__tcfapi = (cmd: string, _ver: number, cb: Function) => {
    if (cmd === 'getTCData') {
      cb({ tcString: 'MOCK_TC_STRING', gdprApplies: true }, true)
    }
  }
})
```

Llamar ANTES de `player.goto()`. El tracker leerá `__tcfapi` al inicializarse.

---

## Señales NO confiables

| Señal | Por qué no usarla |
|---|---|
| `player.on('playing')` para verificar que Konodrac disparó | `playing` es independiente del estado del tracker |
| `player.on('contentFirstPlay')` como proxy de `firstplay beacon` | El beacon puede fallar silenciosamente; el evento del player dispara igual |
| Conteo exacto de beacons totales | `mhb` agrega beacons según el tiempo transcurrido — usar filtro por `event` |
