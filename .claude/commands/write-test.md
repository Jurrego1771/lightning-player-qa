# /write-test — Guía para escribir tests en Lightning Player QA

Referencia rápida de convenciones, patrones y anti-patrones para escribir tests en este proyecto.

---

## Regla 0 — Antes de escribir cualquier test

1. Leer `context/features/{feature}.md`. Si no existe → crearlo primero.
2. Identificar la **señal confiable**: evento público > retorno de API > UI visible.
3. Decidir en qué suite va (ver tabla abajo).

No generar tests de una feature sin documentación. El test refleja el contrato del feature doc.

---

## Decisión de suite

| Quiero testear… | Suite | Fixture |
|---|---|---|
| Flujo completo de usuario, integración con CDN real | `tests/e2e/` | `player` + `ContentIds` |
| Comportamiento interno con streams controlados | `tests/integration/` | `isolatedPlayer` + `MockContentIds` |
| API pública / contrato de breaking changes | `tests/contract/` | `isolatedPlayer` |
| Regresión rápida post-deploy | `tests/smoke/` | `player` + `ContentIds` |
| WCAG 2.1 AA | `tests/a11y/` | `isolatedPlayer` |
| Screenshot vs baseline | `tests/visual/` | `isolatedPlayer` |
| Métricas QoE (bufferRatio, startupTime) | `tests/performance/` | `player` + `ContentIds` |

**Regla:** `isolatedPlayer` para todo lo que necesita control total. `player` real solo cuando se necesita CDN/plataforma real.

---

## Import — siempre desde fixtures/

```typescript
// ✅ correcto
import { test, expect, MockContentIds, ContentIds, mockContentConfigById } from '../../fixtures'

// ❌ nunca
import { test, expect } from '@playwright/test'
```

---

## Estructura mínima

```typescript
import { test, expect, MockContentIds } from '../../fixtures'

test.describe('Nombre del módulo — Qué se testa', { tag: ['@smoke'] }, () => {
  test('comportamiento concreto en presente', async ({ isolatedPlayer: player }) => {
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing', 20_000)
    await player.assertNoInitError()

    // aserción fuerte sobre señal confiable
    const duration = await player.getDuration()
    expect(duration).toBeGreaterThan(0)
  })
})
```

### Tags disponibles
`@smoke` · `@contract` · `@integration` · `@e2e` · `@a11y` · `@visual` · `@performance`

---

## Patrones obligatorios

### autoplay: true cuando necesites el handler HLS
El HLS handler es **lazy-load** y solo monta cuando la media empieza a cargar.
Con `autoplay: false`, `loadedmetadata` nunca dispara y `getHandler()` retorna null.

```typescript
// ✅ cuando necesitas loadedmetadata o getHandler()
await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
await player.waitForReady(20_000)
await player.waitForEvent('loadedmetadata', 15_000)

// ✅ autoplay: false solo si testeas el estado sin media cargada
await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })
await player.waitForReady(20_000)
await player.assertNoInitError()
// NO llames waitForEvent('loadedmetadata') aquí
```

### expect.poll() para estado asíncrono
Cualquier valor que se actualiza *después* de un evento requiere poll, no lectura directa.

```typescript
// ✅
await expect.poll(
  () => player.getMetadata().then(m => m.title),
  { timeout: 5_000 }
).toBe('Episode Beta')

// ❌ race condition — ready/playing no garantiza que metadata ya esté actualizado
const meta = await player.getMetadata()
expect(meta.title).toBe('Episode Beta')
```

Casos que **siempre** necesitan poll:
- `getMetadata()` después de `sourcechange` / `ready`
- `getDuration()` en live streams (Infinity se asigna async)
- `getCurrentTime()` después de `seek()`
- `getHandler()` si no esperaste `loadedmetadata`

### waitForEvent con timeout explícito
Siempre pasar timeout — el default de 60s es demasiado largo para detectar regresiones rápido.

```typescript
await player.waitForEvent('playing', 20_000)   // ✅
await player.waitForEvent('playing')            // ❌ timeout implícito
```

### mockContentConfigById para tests multi-contenido
Cuando un test necesita respuestas distintas por content ID (ej: next episode):

```typescript
await mockContentConfigById(page, {
  [MockContentIds.vod]: {
    title: 'Episode Alpha',
    next: MockContentIds.episode,
    nextEpisodeTime: 1,
  },
  [MockContentIds.episode]: {
    title: 'Episode Beta',
  },
})
// Llamar ANTES de player.goto() y DENTRO del test body (LIFO route registration)
```

### contentAccess para streams live/DVR reales
```typescript
test('live', async ({ player, contentAccess }) => {
  await player.goto({ type: 'live', id: ContentIds.live, ...contentAccess.live })
  await player.waitForEvent('playing', 30_000)
})
// Requiere PLATFORM_API_TOKEN en .env. El fixture skipea automáticamente si no está.
```

### Skip de browsers no confiables
```typescript
test('...', async ({ isolatedPlayer: player, browserName }) => {
  test.skip(browserName === 'webkit', 'HLS en headless WebKit no es confiable — usar Safari real')
  test.skip(browserName === 'firefox', 'HLS fixture server contention bajo carga paralela')
  ...
})
```

---

## Anti-patrones — nunca hacer esto

```typescript
// ❌ waitForTimeout — no determinista
await page.waitForTimeout(2000)

// ❌ selector interno del player
await page.click('.msp-control-bar__play-btn')

// ❌ aserción inmediata sobre valor eventual
const meta = await player.getMetadata()
expect(meta.title).toBe('algo')  // puede tener datos del contenido anterior

// ❌ importar de @playwright/test directamente
import { test } from '@playwright/test'

// ❌ test.only() commiteado
test.only('debug', ...)

// ❌ seek a posición fuera del buffer inicial en tests de smoke/integration
await player.seek(60)  // CDN lento en CI → flaky. Usar seek(5) para smoke.
```

---

## Seek confiable en CI

```typescript
// ✅ dentro del buffer inicial (~5s) — no requiere carga de nuevos segmentos CDN
await player.seek(5)
await expect.poll(() => player.getCurrentTime(), { timeout: 15_000, intervals: [300] })
  .toBeGreaterThan(3)

// ❌ fuera del buffer → espera carga de segmento CDN → flaky en CI
await player.seek(30)
await expect.poll(() => player.getCurrentTime(), { timeout: 25_000 }).toBeGreaterThan(28)
```

---

## Jerarquía de señales (de más a menos confiable)

1. Eventos públicos documentados (`playing`, `ready`, `sourcechange`, `nextEpisodeIncoming`…)
2. Retornos de API pública (`getDuration()`, `getMetadata()`, `isLive()`, `getHandler()`)
3. Estado UI accesible (`aria-label`, visibilidad de botones)
4. DOM interno o timing implícito ← **evitar**

---

## Checklist antes de commitear un test nuevo

- [ ] Importa desde `fixtures/`, no de `@playwright/test`
- [ ] Tiene `tag` con la suite correcta
- [ ] Usa `isolatedPlayer` si no necesita CDN real
- [ ] No tiene `waitForTimeout()`
- [ ] Los valores asíncronos usan `expect.poll()`
- [ ] Los `waitForEvent()` tienen timeout explícito
- [ ] Si usa `autoplay: false`, no llama `waitForEvent('loadedmetadata')`
- [ ] El seek apunta a una posición dentro del buffer inicial (si es smoke/integration)
- [ ] No hay `test.only()` sin comentario de propósito
- [ ] Existe `context/features/{feature}.md` para la feature testeada
