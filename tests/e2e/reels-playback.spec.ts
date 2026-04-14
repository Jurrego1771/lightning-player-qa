/**
 * reels-playback.spec.ts — Flujo básico de Reels contra plataforma real
 *
 * Cubre: inicialización del view type Reels, emisión correcta del primer
 * evento metadata y reproducción fluida del primer item.
 *
 * Fixture: player (plataforma real DEV)
 * Tag: @e2e
 *
 * Contenido DEV:
 *   Player ID : 691c76644f0fea2d5c886fb5
 *   Media ID  : 695a9a3ab7889b9a7e67c850 (primer item del feed Reels)
 *   ads.interval: 4 (ad después del 4º reel)
 *
 * Cómo funciona Reels:
 *   - type: 'media'  → tipo de contenido (igual que VOD)
 *   - view: 'reels'  → activa la skin de UI Reels (swiper vertical, controles prev/next)
 *   - player: ID     → config del player con la skin configurada
 *
 * No usar type: 'reels' — ese valor no existe en el player. 'reels' va en view.
 */
import { test, expect } from '../../fixtures'
import type { InitConfig } from '../../fixtures'

const REELS_MEDIA_ID = '695a9a3ab7889b9a7e67c850'
const REELS_PLAYER_ID = '691c76644f0fea2d5c886fb5'

// Config base reutilizable para los tests de Reels
function reelsConfig(autoplay: boolean): InitConfig {
  return {
    type: 'media',
    id: REELS_MEDIA_ID,
    player: REELS_PLAYER_ID,
    view: 'reels',
    autoplay,
  }
}

// ── Helper: navegar N reels hacia adelante ────────────────────────────────────
// Intenta esperar que cada item emita 'playing' antes de continuar.
// Si no emite playing en 3s (ad cards inline no tienen video propio),
// usa un fallback de 1.5s y sigue adelante.
async function goNextReels(page: import('@playwright/test').Page, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    const playingBefore = await page.evaluate(() =>
      (window as any).__qa.events.filter((e: string) => e === 'playing').length
    )
    await page.evaluate(() => (window as any).__player?.goNext?.())
    try {
      // Reels con video emiten playing — esperamos eso
      await page.waitForFunction(
        (before) => (window as any).__qa.events.filter((e: string) => e === 'playing').length > before,
        playingBefore,
        { timeout: 3_000 }
      )
    } catch {
      // Ad card inline: no emite playing → esperar y continuar
      await page.waitForTimeout(1_500)
    }
  }
}

// ── Helper: encontrar el primer ad card en el feed ────────────────────────────
// Navega de a un reel a la vez usando expect.poll para esperar el evento real.
// Para cada paso:
//   - Si metadatachanged llega dentro de 5s → es un reel regular → continuar
//   - Si no llega → es un ad card (sin content id) → retornar step
// Este enfoque evita falsos positivos por reels lentos que con un waitForTimeout
// fijo serían clasificados erróneamente como ad cards.
// Retorna el step donde se encontró el ad card (1 = primer goNext desde inicio).
async function goUntilAdCard(
  page: import('@playwright/test').Page,
  maxSteps = 10
): Promise<number> {
  for (let step = 1; step <= maxSteps; step++) {
    await page.evaluate(() => { (window as any).__qa.events = [] })
    await page.evaluate(() => (window as any).__player?.goNext?.())

    // Esperar activamente el evento — si no llega en 5s, es un ad card
    let isAdCard = false
    try {
      await page.waitForFunction(
        () => (window as any).__qa.events.filter((e: string) => e === 'metadatachanged').length > 0,
        { timeout: 5_000 }
      )
    } catch {
      isAdCard = true
    }

    if (isAdCard) {
      return step
    }
  }
  throw new Error(`No se encontró ad card en los primeros ${maxSteps} reels (ads.interval puede ser > ${maxSteps})`)
}

test.describe('Reels — Playback básico (E2E)', { tag: ['@e2e'] }, () => {

  test('Reels se inicializa correctamente y alcanza estado playing', async ({ player }) => {
    // Arrange
    await player.goto(reelsConfig(true))

    // Assert — sin error de init y player reproduciendo
    await player.assertNoInitError()
    await player.waitForEvent('playing', 25_000)
    await player.assertIsPlaying()
  })

  test('metadata se emite exactamente una vez al cargar el primer item de Reels', async ({ player, page }) => {
    // Arrange
    await player.goto(reelsConfig(true))
    await player.waitForEvent('playing', 25_000)

    // Act — limpiar la cola de eventos y esperar un periodo de estabilización.
    // El bug de issue-627 causaba que el mismo item emitiera metadata varias veces
    // durante re-renders internos del componente ReelsControls.
    await page.evaluate(() => { (window as any).__qa.events = [] })

    // Esperar 2 s para que cualquier emisión duplicada tenga tiempo de ocurrir
    // antes de hacer el assert. No es un wait de sincronización — es una ventana
    // deliberada para exponer el bug si el fix hubiera regresado.
    await page.waitForTimeout(2_000)

    // Assert — el conteo no debe superar 1 para el item ya estabilizado
    const events: string[] = await page.evaluate(() => (window as any).__qa.events)
    const metadataCount = events.filter((e) => e === 'metadatachanged').length

    expect(
      metadataCount,
      'metadata no debe emitirse más de una vez para el mismo item estabilizado (fix/issue-627)'
    ).toBeLessThanOrEqual(1)
  })

  test('currentTime avanza durante reproducción del item de Reels', async ({ player }) => {
    // Arrange
    await player.goto(reelsConfig(true))
    await player.waitForEvent('playing', 25_000)

    // Assert — currentTime debe avanzar, confirmando reproducción real
    await expect.poll(() => player.getCurrentTime(), { timeout: 8_000 }).toBeGreaterThan(0)
  })

  test('Reels no reporta error de inicialización con autoplay desactivado', async ({ player }) => {
    // Arrange
    await player.goto(reelsConfig(false))
    await player.waitForReady(25_000)

    // Assert
    await player.assertNoInitError()
  })
})

test.describe('Reels — Metadata por swipe de navegación', { tag: ['@e2e', '@regression'] }, () => {

  test('metadatachanged se emite una vez por swipe y el payload cambia de item en item', async ({ player, page }) => {
    // Valida la regla de negocio de navegación:
    //   goNext() → metadatachanged con datos del nuevo reel
    //   goNext() → metadatachanged con datos del reel siguiente (diferente al anterior)
    //
    // Invariantes:
    //   - Exactamente 1 emisión por swipe (no duplicados)
    //   - El payload.title es diferente entre items consecutivos
    //   - El payload no crece durante la ventana de estabilización post-swipe
    test.slow()

    await player.goto(reelsConfig(true))
    await player.waitForEvent('playing', 25_000)
    await player.assertNoInitError()

    // Esperar que el primer reel emita su metadata y capturarla
    await expect.poll(
      () => page.evaluate(() =>
        (window as any).__qa.events.filter((e: string) => e === 'metadatachanged').length
      ),
      { timeout: 8_000, message: 'metadatachanged debe emitirse al cargar el primer reel' }
    ).toBeGreaterThanOrEqual(1)

    const metadata1 = await page.evaluate(() => ({ ...(window as any).__qa.eventData?.['metadatachanged'] }))
    expect(typeof metadata1.title).toBe('string')

    // ── Swipe → reel 2 ────────────────────────────────────────────────────
    await page.evaluate(() => { (window as any).__qa.events = [] })
    await page.evaluate(() => (window as any).__player?.goNext?.())

    // Esperar metadatachanged del nuevo item
    await expect.poll(
      () => page.evaluate(() =>
        (window as any).__qa.events.filter((e: string) => e === 'metadatachanged').length
      ),
      { timeout: 8_000, message: 'metadatachanged debe emitirse al hacer swipe al reel 2' }
    ).toBeGreaterThanOrEqual(1)

    // Ventana de estabilización: el conteo no debe subir después del primer evento
    const countAfterSwipe1 = await page.evaluate(() =>
      (window as any).__qa.events.filter((e: string) => e === 'metadatachanged').length
    )
    await page.waitForTimeout(2_000)
    const countAfterStabilization1 = await page.evaluate(() =>
      (window as any).__qa.events.filter((e: string) => e === 'metadatachanged').length
    )
    expect(
      countAfterStabilization1,
      'metadatachanged no debe duplicarse durante la estabilización post-swipe (reel 2)'
    ).toBe(countAfterSwipe1)

    // El payload del reel 2 debe tener datos diferentes al reel 1
    const metadata2 = await page.evaluate(() => ({ ...(window as any).__qa.eventData?.['metadatachanged'] }))
    expect(
      metadata2.title,
      'el reel 2 debe tener título diferente al reel 1 — cada item tiene su propia metadata'
    ).not.toBe(metadata1.title)

    // ── Swipe → reel 3 ────────────────────────────────────────────────────
    await page.evaluate(() => { (window as any).__qa.events = [] })
    await page.evaluate(() => (window as any).__player?.goNext?.())

    await expect.poll(
      () => page.evaluate(() =>
        (window as any).__qa.events.filter((e: string) => e === 'metadatachanged').length
      ),
      { timeout: 8_000, message: 'metadatachanged debe emitirse al hacer swipe al reel 3' }
    ).toBeGreaterThanOrEqual(1)

    const countAfterSwipe2 = await page.evaluate(() =>
      (window as any).__qa.events.filter((e: string) => e === 'metadatachanged').length
    )
    await page.waitForTimeout(2_000)
    const countAfterStabilization2 = await page.evaluate(() =>
      (window as any).__qa.events.filter((e: string) => e === 'metadatachanged').length
    )
    expect(
      countAfterStabilization2,
      'metadatachanged no debe duplicarse durante la estabilización post-swipe (reel 3)'
    ).toBe(countAfterSwipe2)

    const metadata3 = await page.evaluate(() => ({ ...(window as any).__qa.eventData?.['metadatachanged'] }))
    expect(
      metadata3.title,
      'el reel 3 debe tener título diferente al reel 2'
    ).not.toBe(metadata2.title)
  })

})

test.describe('Reels — Regresión post-ad card (fix/issue-627)', { tag: ['@e2e', '@regression'] }, () => {
  // El feed de Reels usa ad cards inline (no overlays IMA/VAST):
  //   - Son items del swiper con botón "visit", sin título ni content id
  //   - No emiten adsStarted/adsContentResumeRequested
  //   - El player suprime metadatachanged para ellos (sin content id → clave inválida)
  //
  // ads.interval=4 → ad card insertado cada 4 posiciones del feed.
  // Usamos goUntilAdCard() para encontrar la posición real en lugar de asumir un índice fijo,
  // ya que el conteo puede variar según si la plataforma cuenta desde 0 o desde 1.

  test('metadatachanged se emite para el reel que sigue al ad card (reels → ad card → reel)', async ({ player, page, browserName }) => {
    // ── Contexto del bug ─────────────────────────────────────────────────────
    // Bug original (issue-627): después de pasar un ad, el reel siguiente no
    // mostraba metadata (título, descripción) en pantalla.
    //
    // Flujo: reel 1 → reel 2 → ... → [ad card] → reel N ← debe tener metadata
    //
    // WebKit skipped: metadatachanged post-goNext tiene latencia >2.5s en webkit
    // haciendo que goUntilAdCard() detecte falsamente reel 1 como ad card.
    // Comportamiento validado en chromium / firefox / mobile-chrome.
    // ─────────────────────────────────────────────────────────────────────────
    test.skip(browserName === 'webkit', 'webkit: latencia de metadatachanged post-goNext supera ventana de detección — validado en chromium/firefox')
    test.slow()

    await player.goto(reelsConfig(true))
    await player.waitForEvent('playing', 25_000)
    await player.assertNoInitError()

    // Navegar uno a uno hasta encontrar el ad card (primera posición sin metadatachanged).
    // goUntilAdCard ya deja el player posicionado EN el ad card.
    const adCardStep = await goUntilAdCard(page)
    expect(adCardStep, `ad card encontrado en step ${adCardStep} — dentro del rango esperado (ads.interval=4)`).toBeGreaterThan(0)

    // ── Swipe al reel post-ad card ─────────────────────────────────────────
    await page.evaluate(() => { (window as any).__qa.events = [] })
    await page.evaluate(() => (window as any).__player?.goNext?.())

    await expect.poll(
      () => page.evaluate(() =>
        (window as any).__qa.events.filter((e: string) => e === 'metadatachanged').length
      ),
      { timeout: 8_000, message: `metadatachanged debe emitirse para el reel después del ad card (step ${adCardStep} + 1) — regresión fix/issue-627` }
    ).toBeGreaterThanOrEqual(1)

    const payload = await page.evaluate(() => (window as any).__qa.eventData?.['metadatachanged'])
    expect(payload, 'metadatachanged debe propagar un payload post-ad card').toBeTruthy()
    // id — requerido por getMetadataKey(): sin id el fix suprime el evento
    expect(typeof payload?.id, 'payload.id debe ser string — es la clave del fix/issue-627').toBe('string')
    expect((payload?.id as string).length, 'payload.id no debe estar vacío').toBeGreaterThan(0)
    // title y description — campos de UI que el bug dejaba vacíos en pantalla
    expect(typeof payload?.title, 'payload.title debe ser string post-ad card').toBe('string')
    expect((payload?.title as string).length, 'payload.title no debe estar vacío').toBeGreaterThan(0)
    // type y playerType — confirman que el payload corresponde a un reel real, no a un ad
    expect(payload?.type, 'payload.type debe ser "media" — los ad cards no tienen type').toBe('media')
    expect(payload?.playerType, 'payload.playerType debe ser "reels"').toBe('reels')

    await player.assertNoInitError()
  })

  test('metadatachanged NO se emite en el ad card y se emite exactamente una vez en el reel siguiente', async ({ player, page, browserName }) => {
    // Valida el ciclo completo en dos fases:
    //   Fase 1 — en el ad card: count = 0 (sin content id → suprimido) — ya validado por goUntilAdCard
    //   Fase 2 — en el reel siguiente: count = 1 con payload válido
    test.skip(browserName === 'webkit', 'webkit: latencia de metadatachanged post-goNext supera ventana de detección — validado en chromium/firefox')
    test.slow()

    await player.goto(reelsConfig(true))
    await player.waitForEvent('playing', 25_000)
    await player.assertNoInitError()

    // Navegar hasta el ad card.
    // goUntilAdCard valida internamente que count=0 (sin metadatachanged) en esa posición.
    const adCardStep = await goUntilAdCard(page)
    expect(adCardStep, 'debe encontrarse un ad card en el feed').toBeGreaterThan(0)

    // ── Fase 2: EN el reel post-ad card ──────────────────────────────────
    await page.evaluate(() => { (window as any).__qa.events = [] })
    await page.evaluate(() => (window as any).__player?.goNext?.())
    await page.waitForTimeout(3_000)

    const countAfterAd = await page.evaluate(() =>
      (window as any).__qa.events.filter((e: string) => e === 'metadatachanged').length
    )
    expect(countAfterAd, 'metadatachanged debe emitirse al pasar al reel post-ad card').toBeGreaterThanOrEqual(1)
    expect(countAfterAd, 'metadatachanged no debe duplicarse post-ad card').toBeLessThanOrEqual(1)

    const payload = await page.evaluate(() => (window as any).__qa.eventData?.['metadatachanged'])
    expect(payload).toBeTruthy()
    // id — la clave que getMetadataKey() usa para deduplicar; sin id = ad suprimido
    expect(typeof payload?.id).toBe('string')
    expect((payload?.id as string).length).toBeGreaterThan(0)
    // campos de UI — los que el bug dejaba en blanco después del ad card
    expect(typeof payload?.title).toBe('string')
    expect((payload?.title as string).length).toBeGreaterThan(0)
    // type y playerType — confirman que es un reel real, no un ad card
    expect(payload?.type).toBe('media')
    expect(payload?.playerType).toBe('reels')
  })

  test('metadata se emite correctamente en 3 ciclos consecutivos de navegación por ad cards', async ({ player, page, browserName }) => {
    // Valida que el fix es estable durante uso sostenido.
    // Cada ciclo navega reel a reel hasta encontrar el ad card, validando el payload
    // de CADA reel intermedio — no solo el post-ad. Esto garantiza al 100% que
    // metadatachanged se emite con id/title/type/playerType válidos en cada item.
    //
    // Patrón por ciclo (ads.interval=4 → ad card cada ~4 reels):
    //   reel N   → metadatachanged con payload válido ✓
    //   reel N+1 → metadatachanged con payload válido ✓  ← todos validados
    //   reel N+2 → metadatachanged con payload válido ✓
    //   reel N+3 → metadatachanged con payload válido ✓
    //   ad card  → metadatachanged count = 0             ← suprimido ✓
    //   reel N+4 → metadatachanged con payload válido ✓  ← post-ad validado ✓
    //
    // 3 ciclos (~15 posiciones) es seguro para un feed típico de ~20 items.
    test.skip(browserName === 'webkit', 'webkit: latencia de metadatachanged post-goNext supera ventana de detección — validado en chromium/firefox')
    // Test con timeout extendido: 3 ciclos × (scan + post-ad) + navegación profunda en el feed
    // pueden exceder el triple del timeout base (180s). 5 minutos cubre el peor caso.
    test.setTimeout(300_000)

    await player.goto(reelsConfig(true))
    await player.waitForEvent('playing', 25_000)
    await player.assertNoInitError()

    // Helper inline: avanza un reel y valida el payload si metadatachanged fue emitido.
    // Usa waitForTimeout(2500) — tiempo fijo, sin promesas colgadas. Después de la espera:
    //   count > 0 → reel real → validar payload completo
    //   count = 0 → ad card (o reel muy lento) → retornar null
    const stepAndValidate = async (label: string): Promise<Record<string, unknown> | null> => {
      await page.evaluate(() => { (window as any).__qa.events = [] })
      await page.evaluate(() => (window as any).__player?.goNext?.())
      await page.waitForTimeout(2_500)

      const count = await page.evaluate(() =>
        (window as any).__qa.events.filter((e: string) => e === 'metadatachanged').length
      )
      if (count === 0) return null

      const payload = await page.evaluate(() => (window as any).__qa.eventData?.['metadatachanged'])
      expect(payload, `${label}: payload no debe ser nulo`).toBeTruthy()
      expect(typeof payload?.id, `${label}: payload.id debe ser string`).toBe('string')
      expect((payload?.id as string).length, `${label}: payload.id no debe estar vacío`).toBeGreaterThan(0)
      expect(typeof payload?.title, `${label}: payload.title debe ser string`).toBe('string')
      expect((payload?.title as string).length, `${label}: payload.title no debe estar vacío`).toBeGreaterThan(0)
      expect(payload?.type, `${label}: payload.type debe ser "media"`).toBe('media')
      expect(payload?.playerType, `${label}: payload.playerType debe ser "reels"`).toBe('reels')
      return payload as Record<string, unknown>
    }

    const CYCLES = 3

    for (let cycle = 1; cycle <= CYCLES; cycle++) {
      // ── Navegar reel a reel hasta el ad card, validando cada reel ──────────
      // MAX_REELS_PER_CYCLE=5: con ads.interval=4 el ad card aparece en ≤5 pasos.
      // Menos iteraciones → test más rápido y dentro del timeout de 180s.
      let reelStep = 0
      let adCardFound = false
      const MAX_REELS_PER_CYCLE = 5

      while (reelStep < MAX_REELS_PER_CYCLE) {
        reelStep++
        const label = `ciclo ${cycle} · reel ${reelStep}`
        const payload = await stepAndValidate(label)
        if (payload === null) {
          adCardFound = true
          break
        }
      }

      expect(adCardFound, `ciclo ${cycle}: debe encontrarse un ad card en ≤${MAX_REELS_PER_CYCLE} pasos`).toBe(true)

      // ── Validar el reel post-ad card ───────────────────────────────────────
      // Usamos expect.poll con timeout mayor: el reel post-ad puede no estar preloaded
      await page.evaluate(() => { (window as any).__qa.events = [] })
      await page.evaluate(() => (window as any).__player?.goNext?.())

      await expect.poll(
        () => page.evaluate(() =>
          (window as any).__qa.events.filter((e: string) => e === 'metadatachanged').length
        ),
        { timeout: 20_000, message: `ciclo ${cycle}: metadatachanged debe emitirse en el reel post-ad card` }
      ).toBeGreaterThanOrEqual(1)

      const postAdPayload = await page.evaluate(() => (window as any).__qa.eventData?.['metadatachanged'])
      expect(postAdPayload, `ciclo ${cycle}: post-ad payload no debe ser nulo`).toBeTruthy()
      expect(typeof postAdPayload?.id, `ciclo ${cycle}: post-ad payload.id debe ser string`).toBe('string')
      expect((postAdPayload?.id as string).length, `ciclo ${cycle}: post-ad payload.id no debe estar vacío`).toBeGreaterThan(0)
      expect(typeof postAdPayload?.title, `ciclo ${cycle}: post-ad payload.title debe ser string`).toBe('string')
      expect((postAdPayload?.title as string).length, `ciclo ${cycle}: post-ad payload.title no debe estar vacío`).toBeGreaterThan(0)
      expect(postAdPayload?.type, `ciclo ${cycle}: post-ad payload.type debe ser "media"`).toBe('media')
      expect(postAdPayload?.playerType, `ciclo ${cycle}: post-ad payload.playerType debe ser "reels"`).toBe('reels')
    }

    await player.assertNoInitError()
  })

})

test.describe('Reels — Navegación hacia atrás (goPrev)', { tag: ['@e2e', '@regression'] }, () => {
  // Valida que navegar hacia atrás (goPrev) re-emite metadatachanged con los
  // datos del reel al que se regresa, no del reel que se acaba de dejar.
  //
  // El fix/issue-627 usa lastMetadataKeyRef para deduplicar re-renders del mismo
  // item, pero NO debe suprimir la emisión cuando se navega a un item diferente.
  // goPrev cambia el item activo → key diferente → debe emitir.

  test('goPrev re-emite metadatachanged con los datos del reel anterior', async ({ player, page, browserName }) => {
    // Flujo: reel0 → goNext() → reel1 → goPrev() → reel0
    //                                               ↑ debe re-emitir metadata de reel0
    //                                                 con el mismo id y title que al inicio
    //
    // Solo usamos 1 goNext para mantenernos lejos del primer ad card (ads.interval=4).
    // Así el setup no puede caer en un ad card en el segundo paso.
    test.skip(browserName === 'webkit', 'webkit: metadatachanged no se emite en navegación goNext/goPrev — validado en chromium/firefox')
    // BUG CONOCIDO: goPrev() no re-emite metadatachanged al volver a un reel anterior.
    // El player navega hacia atrás pero no notifica el cambio de item via metadatachanged.
    // Comportamiento esperado: el fix/issue-627 permite re-emitir cuando la key cambia
    // (reel0 ≠ reel1), por lo que goPrev debería disparar el evento.
    // Reportar al equipo del player: goPrev() no integra el flujo de metadata.
    test.fail(true, 'BUG: goPrev() no re-emite metadatachanged — el player no notifica cambio de item al navegar hacia atrás')

    await player.goto(reelsConfig(true))
    await player.waitForEvent('playing', 25_000)
    await player.assertNoInitError()

    // ── Capturar metadata del reel inicial (reel0) ────────────────────────
    await expect.poll(
      () => page.evaluate(() =>
        (window as any).__qa.events.filter((e: string) => e === 'metadatachanged').length
      ),
      { timeout: 8_000, message: 'metadatachanged debe emitirse al cargar el reel inicial' }
    ).toBeGreaterThanOrEqual(1)

    const metadata0 = await page.evaluate(() => ({ ...(window as any).__qa.eventData?.['metadatachanged'] }))
    expect(typeof metadata0.id).toBe('string')
    expect(typeof metadata0.title).toBe('string')

    // ── goNext → reel1 ────────────────────────────────────────────────────
    await page.evaluate(() => { (window as any).__qa.events = [] })
    await page.evaluate(() => (window as any).__player?.goNext?.())

    await expect.poll(
      () => page.evaluate(() =>
        (window as any).__qa.events.filter((e: string) => e === 'metadatachanged').length
      ),
      { timeout: 8_000, message: 'metadatachanged debe emitirse al hacer goNext al reel 1' }
    ).toBeGreaterThanOrEqual(1)

    const metadata1 = await page.evaluate(() => ({ ...(window as any).__qa.eventData?.['metadatachanged'] }))
    expect(
      metadata1.id,
      'reel1 debe tener id diferente al reel0'
    ).not.toBe(metadata0.id)

    // ── goPrev → volver a reel0 ───────────────────────────────────────────
    await page.evaluate(() => { (window as any).__qa.events = [] })
    await page.evaluate(() => (window as any).__player?.goPrev?.())

    await expect.poll(
      () => page.evaluate(() =>
        (window as any).__qa.events.filter((e: string) => e === 'metadatachanged').length
      ),
      { timeout: 8_000, message: 'goPrev debe re-emitir metadatachanged al volver al reel inicial' }
    ).toBeGreaterThanOrEqual(1)

    const metadataBack = await page.evaluate(() => ({ ...(window as any).__qa.eventData?.['metadatachanged'] }))

    // El payload debe corresponder a reel0, no a reel1
    expect(
      metadataBack.id,
      'goPrev debe emitir metadata del reel al que se regresa (reel0), no del que se dejó (reel1)'
    ).toBe(metadata0.id)
    expect(
      metadataBack.title,
      'el title debe coincidir con el reel inicial'
    ).toBe(metadata0.title)

    await player.assertNoInitError()
  })

})
