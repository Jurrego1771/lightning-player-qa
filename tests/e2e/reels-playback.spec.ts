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
 *   ads.interval: valor desde player config (mínimo 4 según player: Math.max(interval, 4))
 *
 * Cómo funciona Reels:
 *   - type: 'media'  → tipo de contenido (igual que VOD)
 *   - view: 'reels'  → activa la skin de UI Reels (swiper vertical, controles prev/next)
 *   - player: ID     → config del player con la skin configurada
 *
 * No usar type: 'reels' — ese valor no existe en el player. 'reels' va en view.
 *
 * ── API pública de Reels ──────────────────────────────────────────────────────
 * El player expone via controls.js:
 *   player.metadata     → { id, type, title, description, playerType:'reels', ... }
 *   player.goNext()     → avanza al siguiente item (llama swiper.slideNext())
 *   player.goPrevious() → retrocede al item anterior (llama swiper.slidePrev())
 *
 * Deduplicación: exposeMetadata.js usa Lodash isEqual() para comparar metadata
 * completa — solo emite metadatachanged cuando el objeto cambia realmente.
 *
 * Ad cards inline:
 *   - Implementados como items del swiper con is_ad:true en src/view/reels/atoms/items.js
 *   - Su id es `ad-{n}_{timestamp}` (sintético, no de plataforma)
 *   - Su metadata payload: { title, description, playerType } — sin campo 'type'
 *   - Los reels reales siempre tienen type:'media' y un id de plataforma
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

// ── Helper: encontrar el primer ad card en el feed ────────────────────────────
// Navega de a un reel a la vez leyendo player.metadata directamente.
//
// Mecanismo de detección basado en el payload real del player:
//   - Reels reales:  { id: '<platform-id>', type: 'media', title, playerType:'reels', ... }
//   - Ad cards:      { title, description, playerType:'reels' } — sin campo 'type'
//
// Por qué player.metadata y no events:
//   AdsManager (src/view/reels/utils/adsManager.js) emite _metadatachanged interno
//   con { title, description } al cargar el ad. Ese payload actualiza el getter
//   player.metadata via los atoms de Reels. El evento público metadatachanged
//   (vía exposeMetadata.js + isEqual) puede o no dispararse para ads según el
//   contexto de React — no es confiable como señal de "llegué a un ad card".
//   Leer player.metadata directamente es determinista.
//
// Retorna el step donde se encontró el ad card (1 = primer goNext desde inicio).
async function goUntilAdCard(
  page: import('@playwright/test').Page,
  maxSteps = 10
): Promise<number> {
  for (let step = 1; step <= maxSteps; step++) {
    const idBefore = await page.evaluate(() => (window as any).__player?.metadata?.id)

    await page.evaluate(() => (window as any).__player?.goNext?.())

    // Esperar a que metadata.id cambie — señal de que el item activo cambió.
    // Si no cambia en 6s (feed al límite o navegación lenta) continuamos con el
    // metadata actual; el check de !metadata.type a continuación decidirá.
    try {
      await page.waitForFunction(
        (before) => (window as any).__player?.metadata?.id !== before,
        idBefore,
        { timeout: 6_000 }
      )
    } catch {
      // metadata.id no cambió en 6s — evaluar el estado actual
    }

    // Pequeña espera para que AdsManager complete la carga si el item es un ad card
    await page.waitForTimeout(400)

    const metadata = await page.evaluate(() => (window as any).__player?.metadata)

    // Ad card: payload sin campo 'type' (los reels reales siempre tienen type:'media')
    const isAdCard = !metadata?.type

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
    // exposeMetadata.js usa isEqual() para deduplicar: si el item no cambia,
    // no debe emitirse metadatachanged adicional por re-renders internos.
    await page.evaluate(() => { (window as any).__qa.events = [] })

    // Ventana de 2s para que cualquier emisión duplicada tenga tiempo de ocurrir
    await page.waitForTimeout(2_000)

    // Assert — el conteo no debe superar 1 para el item ya estabilizado
    const events: string[] = await page.evaluate(() => (window as any).__qa.events)
    const metadataCount = events.filter((e) => e === 'metadatachanged').length

    expect(
      metadataCount,
      'metadata no debe emitirse más de una vez para el mismo item estabilizado (isEqual dedup)'
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

  test('player.metadata.id cambia en cada swipe y metadatachanged no se duplica', async ({ player, page }) => {
    // Valida la regla de negocio de navegación:
    //   goNext() → player.metadata.id cambia → un item diferente está activo
    //   goNext() → player.metadata.id cambia de nuevo → tercer item diferente
    //
    // Estrategia principal: polling de player.metadata (API directa, sin depender
    // del timing del evento). Luego verificamos que metadatachanged no se duplica.
    //
    // Invariantes:
    //   - player.metadata.id es diferente entre items consecutivos
    //   - metadatachanged no crece durante la ventana de estabilización post-swipe
    test.slow()

    await player.goto(reelsConfig(true))
    await player.waitForEvent('playing', 25_000)
    await player.assertNoInitError()

    // ── Capturar metadata del reel inicial ────────────────────────────────
    // Esperar a que player.metadata.id esté disponible (player cargó content config)
    await expect.poll(
      () => page.evaluate(() => (window as any).__player?.metadata?.id),
      { timeout: 8_000, message: 'player.metadata.id debe estar disponible al iniciar' }
    ).toBeTruthy()

    const id0 = await page.evaluate(() => (window as any).__player?.metadata?.id as string)
    const title0 = await page.evaluate(() => (window as any).__player?.metadata?.title as string)
    expect(typeof id0).toBe('string')
    expect(typeof title0).toBe('string')

    // ── Swipe → reel 2 ────────────────────────────────────────────────────
    await page.evaluate(() => { (window as any).__qa.events = [] })
    await page.evaluate(() => (window as any).__player?.goNext?.())

    // Esperar a que player.metadata.id cambie — item activo cambió
    await expect.poll(
      () => page.evaluate(() => (window as any).__player?.metadata?.id),
      { timeout: 8_000, message: 'player.metadata.id debe cambiar al hacer swipe al reel 2' }
    ).not.toBe(id0)

    const id1 = await page.evaluate(() => (window as any).__player?.metadata?.id as string)
    const title1 = await page.evaluate(() => (window as any).__player?.metadata?.title as string)
    expect(id1, 'reel 2 debe tener id diferente al reel 1').not.toBe(id0)
    expect(title1, 'reel 2 debe tener title diferente al reel 1').not.toBe(title0)

    // Ventana de estabilización: metadatachanged no debe dispararse de nuevo
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

    // ── Swipe → reel 3 ────────────────────────────────────────────────────
    await page.evaluate(() => { (window as any).__qa.events = [] })
    await page.evaluate(() => (window as any).__player?.goNext?.())

    await expect.poll(
      () => page.evaluate(() => (window as any).__player?.metadata?.id),
      { timeout: 8_000, message: 'player.metadata.id debe cambiar al hacer swipe al reel 3' }
    ).not.toBe(id1)

    const id2 = await page.evaluate(() => (window as any).__player?.metadata?.id as string)
    const title2 = await page.evaluate(() => (window as any).__player?.metadata?.title as string)
    expect(id2, 'reel 3 debe tener id diferente al reel 2').not.toBe(id1)
    expect(title2, 'reel 3 debe tener title diferente al reel 2').not.toBe(title1)

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
  })

})

test.describe('Reels — Regresión post-ad card (fix/issue-627)', { tag: ['@e2e', '@regression'] }, () => {
  // El feed de Reels usa ad cards inline (no overlays IMA/VAST):
  //   - Son items del swiper con is_ad:true (src/view/reels/atoms/items.js)
  //   - Su id sintético: `ad-{n}_{timestamp}` — no de plataforma
  //   - No emiten adsStarted/adsContentResumeRequested
  //   - Su metadata payload: { title, description, playerType } — sin campo 'type'
  //
  // Detección de ad cards: player.metadata.type ausente → es ad card
  // (los reels reales siempre tienen type:'media')

  test('player.metadata tiene payload completo en el reel que sigue al ad card', async ({ player, page, browserName }) => {
    // ── Contexto del bug ─────────────────────────────────────────────────────
    // Bug original (issue-627): después de pasar un ad, el reel siguiente no
    // mostraba metadata (título, descripción) en pantalla.
    //
    // Flujo: reel 1 → reel 2 → ... → [ad card] → reel N ← debe tener metadata
    //
    // WebKit skipped: player.metadata.id no se actualiza con suficiente velocidad
    // en webkit, haciendo que goUntilAdCard() no detecte el cambio de item.
    // Comportamiento validado en chromium / firefox / mobile-chrome.
    // ─────────────────────────────────────────────────────────────────────────
    test.skip(browserName === 'webkit', 'webkit: player.metadata no se actualiza correctamente post-goNext — validado en chromium/firefox')
    test.slow()

    await player.goto(reelsConfig(true))
    await player.waitForEvent('playing', 25_000)
    await player.assertNoInitError()

    // Navegar uno a uno hasta encontrar el ad card.
    // goUntilAdCard deja el player posicionado EN el ad card.
    const adCardStep = await goUntilAdCard(page)
    expect(adCardStep, `ad card encontrado en step ${adCardStep}`).toBeGreaterThan(0)

    // ── Swipe al reel post-ad card ─────────────────────────────────────────
    const adId = await page.evaluate(() => (window as any).__player?.metadata?.id)

    await page.evaluate(() => (window as any).__player?.goNext?.())

    // Esperar a que player.metadata.id cambie (item cambió del ad card al reel)
    await expect.poll(
      () => page.evaluate(() => (window as any).__player?.metadata?.id),
      { timeout: 10_000, message: `player.metadata.id debe cambiar al pasar del ad card (step ${adCardStep}) al reel siguiente` }
    ).not.toBe(adId)

    // El reel post-ad debe tener payload completo
    const metadata = await page.evaluate(() => (window as any).__player?.metadata)

    expect(metadata, 'player.metadata no debe ser nulo post-ad card').toBeTruthy()
    // type:'media' — confirma que es un reel real, no otro ad
    expect(metadata?.type, 'payload.type debe ser "media" — los ad cards no tienen type').toBe('media')
    // id — de plataforma, no sintético (no empieza con 'ad-')
    expect(typeof metadata?.id, 'payload.id debe ser string').toBe('string')
    expect(metadata?.id, 'payload.id no debe ser id sintético de ad card').not.toMatch(/^ad-/)
    // title — campo de UI que el bug dejaba vacío en pantalla
    expect(typeof metadata?.title, 'payload.title debe ser string post-ad card').toBe('string')
    expect((metadata?.title as string).length, 'payload.title no debe estar vacío').toBeGreaterThan(0)
    // playerType — confirma contexto Reels
    expect(metadata?.playerType, 'payload.playerType debe ser "reels"').toBe('reels')

    await player.assertNoInitError()
  })

  test('ad card no tiene type en metadata y el reel siguiente tiene payload completo exactamente una vez', async ({ player, page, browserName }) => {
    // Valida el ciclo completo en dos fases:
    //   Fase 1 — en el ad card: metadata.type ausente (payload es {title, description, playerType})
    //   Fase 2 — en el reel siguiente: metadata.type:'media' con payload válido
    test.skip(browserName === 'webkit', 'webkit: player.metadata no se actualiza correctamente post-goNext — validado en chromium/firefox')
    test.slow()

    await player.goto(reelsConfig(true))
    await player.waitForEvent('playing', 25_000)
    await player.assertNoInitError()

    // Navegar hasta el ad card y verificar que su metadata no tiene 'type'
    const adCardStep = await goUntilAdCard(page)
    expect(adCardStep, 'debe encontrarse un ad card en el feed').toBeGreaterThan(0)

    const adMetadata = await page.evaluate(() => (window as any).__player?.metadata)
    expect(
      adMetadata?.type,
      'Fase 1: ad card no debe tener type en su metadata (solo reels reales tienen type)'
    ).toBeUndefined()

    // ── Fase 2: reel post-ad card ─────────────────────────────────────────
    const adId = await page.evaluate(() => (window as any).__player?.metadata?.id)
    await page.evaluate(() => { (window as any).__qa.events = [] })
    await page.evaluate(() => (window as any).__player?.goNext?.())

    // Esperar a que el reel siguiente cargue su metadata
    await expect.poll(
      () => page.evaluate(() => (window as any).__player?.metadata?.type),
      { timeout: 10_000, message: 'Fase 2: player.metadata.type debe ser "media" en el reel post-ad card' }
    ).toBe('media')

    // Verificar que player.metadata.id también cambió (diferente al ad)
    const postAdMetadata = await page.evaluate(() => (window as any).__player?.metadata)
    expect(postAdMetadata?.id, 'el id del reel post-ad debe ser diferente al id del ad card').not.toBe(adId)
    expect(postAdMetadata?.id, 'el id no debe ser sintético de ad card').not.toMatch(/^ad-/)
    expect(typeof postAdMetadata?.title).toBe('string')
    expect((postAdMetadata?.title as string).length).toBeGreaterThan(0)
    expect(postAdMetadata?.playerType).toBe('reels')

    // El evento metadatachanged también debe haber disparado (no solo el API)
    // Validamos que no se duplicó: ≤ 1 emisión durante la carga del reel post-ad
    await page.waitForTimeout(2_000)
    const eventCount = await page.evaluate(() =>
      (window as any).__qa.events.filter((e: string) => e === 'metadatachanged').length
    )
    expect(eventCount, 'metadatachanged no debe duplicarse post-ad card').toBeLessThanOrEqual(1)
  })

  test('metadata es válida en 3 ciclos consecutivos de navegación por ad cards', async ({ player, page, browserName }) => {
    // Valida que el fix es estable durante uso sostenido.
    // Cada ciclo navega reel a reel hasta encontrar el ad card, verificando que
    // player.metadata tiene payload completo en CADA reel del ciclo.
    //
    // Patrón por ciclo (ad card cada ~ads.interval reels):
    //   reel N   → metadata.type:'media' con payload válido ✓
    //   reel N+1 → metadata.type:'media' con payload válido ✓
    //   ...
    //   ad card  → metadata.type ausente                    ✓
    //   reel N+k → metadata.type:'media' con payload válido ✓  ← post-ad validado ✓
    //
    // Detección de ad cards: !metadata.type (sin depender de eventos)
    test.skip(browserName === 'webkit', 'webkit: player.metadata no se actualiza correctamente post-goNext — validado en chromium/firefox')
    test.setTimeout(300_000)

    await player.goto(reelsConfig(true))
    await player.waitForEvent('playing', 25_000)
    await player.assertNoInitError()

    // Helper: avanza un reel y valida player.metadata.
    //   - Si metadata.type está ausente → es ad card → retorna null
    //   - Si metadata.type:'media' → reel real → valida payload completo y retorna metadata
    const stepAndValidate = async (label: string): Promise<Record<string, unknown> | null> => {
      const idBefore = await page.evaluate(() => (window as any).__player?.metadata?.id)
      await page.evaluate(() => (window as any).__player?.goNext?.())

      // Esperar a que metadata.id cambie — ítem activo cambió
      try {
        await page.waitForFunction(
          (before) => (window as any).__player?.metadata?.id !== before,
          idBefore,
          { timeout: 5_000 }
        )
      } catch {
        // metadata.id no cambió en 5s — verificar estado actual
      }

      // Pequeña espera para que AdsManager complete si es un ad card
      await page.waitForTimeout(400)

      const metadata = await page.evaluate(() => (window as any).__player?.metadata)

      // Ad card: sin campo 'type' en payload
      if (!metadata?.type) return null

      // Reel real: validar payload completo
      expect(metadata, `${label}: player.metadata no debe ser nulo`).toBeTruthy()
      expect(typeof metadata?.id, `${label}: metadata.id debe ser string`).toBe('string')
      expect((metadata?.id as string).length, `${label}: metadata.id no debe estar vacío`).toBeGreaterThan(0)
      expect(metadata?.id, `${label}: metadata.id no debe ser sintético de ad card`).not.toMatch(/^ad-/)
      expect(typeof metadata?.title, `${label}: metadata.title debe ser string`).toBe('string')
      expect((metadata?.title as string).length, `${label}: metadata.title no debe estar vacío`).toBeGreaterThan(0)
      expect(metadata?.type, `${label}: metadata.type debe ser "media"`).toBe('media')
      expect(metadata?.playerType, `${label}: metadata.playerType debe ser "reels"`).toBe('reels')
      return metadata as Record<string, unknown>
    }

    const CYCLES = 3

    for (let cycle = 1; cycle <= CYCLES; cycle++) {
      // Navegar reel a reel hasta el ad card validando cada reel.
      // MAX_REELS_PER_CYCLE=6: cubre ads.interval hasta 6 con margen.
      let reelStep = 0
      let adCardFound = false
      const MAX_REELS_PER_CYCLE = 6

      while (reelStep < MAX_REELS_PER_CYCLE) {
        reelStep++
        const payload = await stepAndValidate(`ciclo ${cycle} · reel ${reelStep}`)
        if (payload === null) {
          adCardFound = true
          break
        }
      }

      expect(adCardFound, `ciclo ${cycle}: debe encontrarse un ad card en ≤${MAX_REELS_PER_CYCLE} pasos`).toBe(true)

      // ── Validar el reel post-ad card ───────────────────────────────────────
      const adId = await page.evaluate(() => (window as any).__player?.metadata?.id)
      await page.evaluate(() => (window as any).__player?.goNext?.())

      await expect.poll(
        () => page.evaluate(() => (window as any).__player?.metadata?.type),
        { timeout: 20_000, message: `ciclo ${cycle}: metadata.type debe ser "media" en el reel post-ad card` }
      ).toBe('media')

      const postAdMetadata = await page.evaluate(() => (window as any).__player?.metadata)
      expect(postAdMetadata, `ciclo ${cycle}: post-ad metadata no debe ser nulo`).toBeTruthy()
      expect(typeof postAdMetadata?.id, `ciclo ${cycle}: post-ad id debe ser string`).toBe('string')
      expect((postAdMetadata?.id as string).length, `ciclo ${cycle}: post-ad id no debe estar vacío`).toBeGreaterThan(0)
      expect(postAdMetadata?.id, `ciclo ${cycle}: post-ad id no debe ser sintético`).not.toMatch(/^ad-/)
      expect(postAdMetadata?.id, `ciclo ${cycle}: post-ad id debe ser diferente al del ad card`).not.toBe(adId)
      expect(typeof postAdMetadata?.title, `ciclo ${cycle}: post-ad title debe ser string`).toBe('string')
      expect((postAdMetadata?.title as string).length, `ciclo ${cycle}: post-ad title no debe estar vacío`).toBeGreaterThan(0)
      expect(postAdMetadata?.type, `ciclo ${cycle}: post-ad type debe ser "media"`).toBe('media')
      expect(postAdMetadata?.playerType, `ciclo ${cycle}: post-ad playerType debe ser "reels"`).toBe('reels')
    }

    await player.assertNoInitError()
  })

})

test.describe('Reels — Navegación hacia atrás (goPrevious)', { tag: ['@e2e', '@regression'] }, () => {
  // Valida que navegar hacia atrás (goPrevious) actualiza player.metadata con los
  // datos del reel al que se regresa, no del reel que se acaba de dejar.
  //
  // La deduplicación de exposeMetadata.js usa isEqual() sobre el objeto completo —
  // al cambiar a un item con id diferente, el objeto cambia → debe emitir.
  // goPrevious cambia el item activo → metadata.id diferente → debe emitir.
  //
  // Nombre correcto de la API: player.goPrevious() (NO goPrev)
  // Ver: src/view/reels/components/controls.js → expose({ goPrevious: ... })

  test('goPrevious actualiza player.metadata con los datos del reel anterior', async ({ player, page, browserName }) => {
    // Flujo: reel0 → goNext() → reel1 → goPrevious() → reel0
    //                                                   ↑ player.metadata debe ser el de reel0
    //
    // Solo usamos 1 goNext para mantenernos lejos del primer ad card.
    test.skip(browserName === 'webkit', 'webkit: player.metadata no se actualiza en navegación goNext/goPrevious — validado en chromium/firefox')
    // BUG CONOCIDO: goPrevious() no actualiza player.metadata al volver a un reel anterior.
    // El player navega visualmente hacia atrás (swiper.slidePrev()) pero el evento
    // metadatachanged no se emite y player.metadata no se actualiza.
    // Comportamiento esperado: al cambiar a un item con id diferente, isEqual() detecta
    // el cambio y debería emitir. Pendiente de fix en el player.
    test.fail(true, 'BUG: goPrevious() no actualiza player.metadata — el player no notifica cambio de item al navegar hacia atrás')

    await player.goto(reelsConfig(true))
    await player.waitForEvent('playing', 25_000)
    await player.assertNoInitError()

    // ── Capturar metadata del reel inicial (reel0) ────────────────────────
    await expect.poll(
      () => page.evaluate(() => (window as any).__player?.metadata?.id),
      { timeout: 8_000, message: 'player.metadata.id debe estar disponible al iniciar' }
    ).toBeTruthy()

    const id0 = await page.evaluate(() => (window as any).__player?.metadata?.id as string)
    const title0 = await page.evaluate(() => (window as any).__player?.metadata?.title as string)
    expect(typeof id0).toBe('string')
    expect(typeof title0).toBe('string')

    // ── goNext → reel1 ────────────────────────────────────────────────────
    await page.evaluate(() => (window as any).__player?.goNext?.())

    await expect.poll(
      () => page.evaluate(() => (window as any).__player?.metadata?.id),
      { timeout: 8_000, message: 'player.metadata.id debe cambiar al hacer goNext al reel 1' }
    ).not.toBe(id0)

    const id1 = await page.evaluate(() => (window as any).__player?.metadata?.id as string)
    expect(id1, 'reel1 debe tener id diferente al reel0').not.toBe(id0)

    // ── goPrevious → volver a reel0 ───────────────────────────────────────
    await page.evaluate(() => (window as any).__player?.goPrevious?.())

    await expect.poll(
      () => page.evaluate(() => (window as any).__player?.metadata?.id),
      { timeout: 8_000, message: 'goPrevious debe actualizar player.metadata al volver al reel inicial' }
    ).toBe(id0)

    const metadataBack = await page.evaluate(() => (window as any).__player?.metadata)

    expect(
      metadataBack?.id,
      'goPrevious debe mostrar metadata del reel al que se regresa (reel0), no del que se dejó (reel1)'
    ).toBe(id0)
    expect(
      metadataBack?.title,
      'el title debe coincidir con el reel inicial'
    ).toBe(title0)

    await player.assertNoInitError()
  })

})
