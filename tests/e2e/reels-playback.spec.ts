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
): Promise<{ step: number; lastReelId: string }> {
  // lastReelId: id del último reel real antes del ad card.
  // Se usa para detectar falsos positivos post-ad: si player.metadata revierte
  // al reel previo (type:'media', id !== adId) la aserción post-ad fallaría
  // sin esta referencia. Con ella verificamos que el id es genuinamente nuevo.
  let lastReelId = ''

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
      return { step, lastReelId }
    }

    // Reel real — registrar su id para referencia post-ad
    if (metadata?.id) lastReelId = metadata.id as string
  }
  throw new Error(`No se encontró ad card en los primeros ${maxSteps} reels (ads.interval puede ser > ${maxSteps})`)
}

test.describe('Reels — Playback básico (E2E)', { tag: ['@e2e'] }, () => {

  test('Reels se inicializa correctamente y alcanza estado playing', async ({ player, browserName }) => {
    // webkit: Playwright WebKit no soporta reproducción HLS/MSE en Reels — validado en chromium/firefox
    test.skip(browserName === 'webkit', 'webkit: no soporta reproducción Reels (HLS/MSE) — validado en chromium/firefox/mobile-chrome')

    // Arrange
    await player.goto(reelsConfig(true))

    // Assert — sin error de init y player reproduciendo
    await player.assertNoInitError()
    await player.waitForEvent('playing', 25_000)
    await player.assertIsPlaying()
  })

  test('metadata se emite exactamente una vez al cargar el primer item de Reels', async ({ player, page }) => {
    // Valida dos cosas independientes:
    //   1. Emisión inicial: metadatachanged se emitió al menos 1 vez durante la carga
    //   2. Estabilización: no se vuelve a emitir por re-renders internos post-load
    //
    // Sin verificar (1), el test pasaría aunque el evento nunca disparara:
    //   queue limpiada → 0 eventos → <= 1 → false positive.
    // Sin verificar (2), el test pasaría aunque metadatachanged se emitiera 10 veces.
    await player.goto(reelsConfig(true))
    await player.waitForEvent('playing', 25_000)

    // ── Verificación 1: la emisión inicial ocurrió ─────────────────────────
    // Se lee ANTES de limpiar la cola para capturar lo que se emitió durante la carga.
    const countAtLoad = await page.evaluate(() =>
      (window as any).__qa.events.filter((e: string) => e === 'metadatachanged').length
    )
    expect(
      countAtLoad,
      'metadatachanged debe emitirse al menos una vez durante la carga del primer item'
    ).toBeGreaterThanOrEqual(1)

    // ── Verificación 2: no hay re-emisiones en la ventana de estabilización ─
    // exposeMetadata.js usa isEqual() para deduplicar re-renders internos.
    await page.evaluate(() => { (window as any).__qa.events = [] })
    await page.waitForTimeout(2_000)

    const countDuringStabilization = await page.evaluate(() =>
      (window as any).__qa.events.filter((e: string) => e === 'metadatachanged').length
    )
    expect(
      countDuringStabilization,
      'metadatachanged no debe re-emitirse durante la ventana de estabilización post-load (isEqual dedup)'
    ).toBe(0)
  })

  test('currentTime avanza durante reproducción del item de Reels', async ({ player, browserName }) => {
    // webkit: Playwright WebKit no soporta reproducción HLS/MSE en Reels — validado en chromium/firefox
    test.skip(browserName === 'webkit', 'webkit: no soporta reproducción Reels (HLS/MSE) — validado en chromium/firefox/mobile-chrome')

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
    // Borrar el payload previo del evento antes de navegar.
    // Sin delete, el poll podría leer el eventData del reel inicial y resolver
    // inmediatamente — el delete fuerza a esperar la nueva emisión.
    await page.evaluate(() => { delete (window as any).__qa.eventData['metadatachanged'] })
    await page.evaluate(() => { (window as any).__qa.events = [] })
    await page.evaluate(() => (window as any).__player?.goNext?.())

    // Aserción combinada — evento + payload:
    //   Leer eventData prueba (a) que el evento disparó y (b) qué id envió.
    //   Solo resuelve cuando metadatachanged se emitió con un id diferente al inicial.
    await expect.poll(
      async () => {
        const payload = await page.evaluate(() => (window as any).__qa.eventData['metadatachanged'])
        if (!payload?.id) return null   // evento aún no disparó — seguir esperando
        return payload.id
      },
      { timeout: 8_000, message: 'metadatachanged debe emitirse con nuevo id al navegar al reel 2' }
    ).not.toBe(id0)

    // id y title se leen del PAYLOAD DEL EVENTO (no del estado) — fuente de verdad
    const eventPayload1 = await page.evaluate(() => (window as any).__qa.eventData['metadatachanged'])
    const id1 = eventPayload1.id as string
    const title1 = eventPayload1.title as string

    expect(id1, 'reel 2: id del evento diferente al reel inicial').not.toBe(id0)
    expect(title1, 'reel 2: title del evento diferente al inicial').not.toBe(title0)

    // Consistencia estado ↔ evento: player.metadata.id debe coincidir con el payload.
    // Una discrepancia indica que el evento se emitió con datos obsoletos o que
    // el estado y la notificación quedaron desincronizados.
    const stateId1 = await page.evaluate(() => (window as any).__player?.metadata?.id as string)
    expect(stateId1, 'player.metadata.id debe coincidir con el payload de metadatachanged (reel 2)').toBe(id1)

    // Estabilización: el evento no debe re-emitirse por re-renders internos de React
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
    await page.evaluate(() => { delete (window as any).__qa.eventData['metadatachanged'] })
    await page.evaluate(() => { (window as any).__qa.events = [] })
    await page.evaluate(() => (window as any).__player?.goNext?.())

    await expect.poll(
      async () => {
        const payload = await page.evaluate(() => (window as any).__qa.eventData['metadatachanged'])
        if (!payload?.id) return null
        return payload.id
      },
      { timeout: 8_000, message: 'metadatachanged debe emitirse con nuevo id al navegar al reel 3' }
    ).not.toBe(id1)

    const eventPayload2 = await page.evaluate(() => (window as any).__qa.eventData['metadatachanged'])
    const id2 = eventPayload2.id as string
    const title2 = eventPayload2.title as string

    expect(id2, 'reel 3: id del evento diferente al reel 2').not.toBe(id1)
    expect(title2, 'reel 3: title del evento diferente al reel 2').not.toBe(title1)

    const stateId2 = await page.evaluate(() => (window as any).__player?.metadata?.id as string)
    expect(stateId2, 'player.metadata.id debe coincidir con el payload de metadatachanged (reel 3)').toBe(id2)

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
    // goUntilAdCard deja el player posicionado EN el ad card y retorna el id
    // del último reel real antes del ad (lastReelId) para evitar falsos positivos.
    const { step: adCardStep, lastReelId } = await goUntilAdCard(page)
    expect(adCardStep, `ad card encontrado en step ${adCardStep}`).toBeGreaterThan(0)

    // ── Swipe al reel post-ad card ─────────────────────────────────────────
    const adId = await page.evaluate(() => (window as any).__player?.metadata?.id)

    // Borrar el payload previo (era el del ad card) para detectar la nueva emisión
    await page.evaluate(() => { delete (window as any).__qa.eventData['metadatachanged'] })
    await page.evaluate(() => (window as any).__player?.goNext?.())

    // Aserción combinada — evento + payload:
    //   · eventData existe (evento disparó post-delete)
    //   · type === 'media' — reel real, no otro ad card
    //   · id !== adId y id !== lastReelId — payload genuinamente nuevo (no stale)
    await expect.poll(
      async () => {
        const payload = await page.evaluate(() => (window as any).__qa.eventData['metadatachanged'])
        if (!payload?.id) return false
        return payload.type === 'media' && payload.id !== adId && payload.id !== lastReelId
      },
      { timeout: 10_000, message: `metadatachanged debe emitirse con payload del nuevo reel post-ad card (step ${adCardStep})` }
    ).toBe(true)

    // Payload del evento (fuente primaria) y estado del player (consistencia)
    const eventPayload = await page.evaluate(() => (window as any).__qa.eventData['metadatachanged'])
    const stateMetadata = await page.evaluate(() => (window as any).__player?.metadata)

    // Verificar payload completo del evento
    expect(typeof eventPayload.id, 'payload.id debe ser string').toBe('string')
    expect(eventPayload.id, 'payload.id no debe ser id sintético de ad card').not.toMatch(/^ad-/)
    expect(typeof eventPayload.title, 'payload.title debe ser string post-ad card').toBe('string')
    expect((eventPayload.title as string).length, 'payload.title no debe estar vacío').toBeGreaterThan(0)
    expect(eventPayload.playerType, 'payload.playerType debe ser "reels"').toBe('reels')

    // Consistencia: estado interno debe coincidir con lo que el evento notificó
    expect(stateMetadata?.id, 'player.metadata.id debe coincidir con el payload del evento post-ad').toBe(eventPayload.id)

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
    const { step: adCardStep, lastReelId } = await goUntilAdCard(page)
    expect(adCardStep, 'debe encontrarse un ad card en el feed').toBeGreaterThan(0)

    const adMetadata = await page.evaluate(() => (window as any).__player?.metadata)
    expect(
      adMetadata?.type,
      'Fase 1: ad card no debe tener type en su metadata (solo reels reales tienen type)'
    ).toBeUndefined()

    // ── Fase 2: reel post-ad card ─────────────────────────────────────────
    const adId = await page.evaluate(() => (window as any).__player?.metadata?.id)
    await page.evaluate(() => { delete (window as any).__qa.eventData['metadatachanged'] })
    await page.evaluate(() => { (window as any).__qa.events = [] })
    await page.evaluate(() => (window as any).__player?.goNext?.())

    // Aserción combinada — evento + payload (igual que el test anterior):
    //   · eventData existe (evento disparó post-delete)
    //   · type === 'media' — reel real
    //   · id !== adId y id !== lastReelId — payload genuinamente nuevo
    await expect.poll(
      async () => {
        const payload = await page.evaluate(() => (window as any).__qa.eventData['metadatachanged'])
        if (!payload?.id) return false
        return payload.type === 'media' && payload.id !== adId && payload.id !== lastReelId
      },
      { timeout: 10_000, message: 'Fase 2: metadatachanged debe emitirse con payload del nuevo reel post-ad card' }
    ).toBe(true)

    // Payload del evento y estado del player
    const eventPayload = await page.evaluate(() => (window as any).__qa.eventData['metadatachanged'])
    const postAdState = await page.evaluate(() => (window as any).__player?.metadata)

    expect(eventPayload.id, 'el id del evento no debe ser sintético de ad card').not.toMatch(/^ad-/)
    expect(eventPayload.id, 'el id del evento debe ser diferente al del ad card').not.toBe(adId)
    expect(typeof eventPayload.title).toBe('string')
    expect((eventPayload.title as string).length).toBeGreaterThan(0)
    expect(eventPayload.playerType).toBe('reels')

    // Consistencia: estado interno debe coincidir con lo que el evento notificó
    expect(postAdState?.id, 'player.metadata.id debe coincidir con el payload del evento').toBe(eventPayload.id)

    // Estabilización: el evento no debe re-emitirse
    const countAfterLoad = await page.evaluate(() =>
      (window as any).__qa.events.filter((e: string) => e === 'metadatachanged').length
    )
    await page.waitForTimeout(2_000)
    const countAfterStabilization = await page.evaluate(() =>
      (window as any).__qa.events.filter((e: string) => e === 'metadatachanged').length
    )
    expect(countAfterStabilization, 'metadatachanged no debe duplicarse post-ad card').toBe(countAfterLoad)
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

    // Helper: avanza un reel y valida player.metadata + metadatachanged.
    //   - Si metadata.type está ausente → es ad card → retorna null (sin validar evento)
    //   - Si metadata.type:'media' → reel real → valida payload completo VÍA ESTADO y VÍA EVENTO
    //
    // IMPORTANTE: limpia eventData['metadatachanged'] ANTES del goNext() para que la
    // presencia del payload post-navigate pruebe que el evento se emitió en ESTE swipe
    // específico, no en uno anterior.
    //
    // BUG que detecta (confirmado exploración 2026-04-15, v1.0.59):
    //   Swiper preloads slides adyacentes al reel activo. forwardMetadata() se ejecuta
    //   para el preloaded slide, actualizando lastMetadataKeyRef con su key. Cuando
    //   el usuario navega a ese reel (goNext()), isEqual(reelN, lastRef=reelN) → true
    //   → metadatachanged suprimido. Ocurre desde ciclo 1 · reel 2 (primer preloaded).
    //   player.metadata (estado del child) SÍ cambia, por eso el bug era invisible.
    const stepAndValidate = async (label: string): Promise<Record<string, unknown> | null> => {
      const idBefore = await page.evaluate(() => (window as any).__player?.metadata?.id)

      // Limpiar evento ANTES de navegar — cualquier eventData post-navigate será de este swipe
      await page.evaluate(() => { delete (window as any).__qa.eventData['metadatachanged'] })
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

      // Ad card: sin campo 'type' en payload — no se espera metadatachanged para ad cards
      if (!metadata?.type) return null

      // ── Verificación 1: payload vía estado ───────────────────────────────────
      expect(metadata, `${label}: player.metadata no debe ser nulo`).toBeTruthy()
      expect(typeof metadata?.id, `${label}: metadata.id debe ser string`).toBe('string')
      expect((metadata?.id as string).length, `${label}: metadata.id no debe estar vacío`).toBeGreaterThan(0)
      expect(metadata?.id, `${label}: metadata.id no debe ser sintético de ad card`).not.toMatch(/^ad-/)
      expect(typeof metadata?.title, `${label}: metadata.title debe ser string`).toBe('string')
      expect((metadata?.title as string).length, `${label}: metadata.title no debe estar vacío`).toBeGreaterThan(0)
      expect(metadata?.type, `${label}: metadata.type debe ser "media"`).toBe('media')
      expect(metadata?.playerType, `${label}: metadata.playerType debe ser "reels"`).toBe('reels')

      // ── Verificación 2: el evento también se emitió ──────────────────────────
      // Si metadatachanged no se emite, los consumidores externos (analytics, UI) no se
      // enteran del cambio aunque player.metadata sí esté actualizado.
      //
      // BUG confirmado (exploración 2026-04-15):
      //   Swiper preloads slides adyacentes durante la reproducción del reel activo.
      //   forwardMetadata() se ejecuta para el slide preloaded → actualiza lastMetadataKeyRef
      //   con el key del reel siguiente. Cuando el usuario navega a ese reel (goNext()),
      //   isEqual(reelN, lastRef=reelN) → true → metadatachanged suprimido.
      //   Ocurre desde ciclo 1 · reel 2 (primer slide preloaded), no solo en ciclo 2+.
      //   player.metadata (estado) sí cambia; solo el evento queda silenciado.
      //
      // Poll en lugar de lectura directa: absorbe latencia IPC entre waitForFunction
      // (CDP polling que detecta metadata.id) y la llegada del evento. Si el evento
      // genuinamente no se emite, el poll agota su timeout y el test falla correctamente.
      await expect.poll(
        () => page.evaluate(() => (window as any).__qa.eventData['metadatachanged']),
        {
          timeout: 3_000,
          message: `${label}: metadatachanged debe emitirse al navegar a este reel — BUG: Swiper preloads el slide adyacente y forwardMetadata() actualiza lastMetadataKeyRef antes de la navegación real; isEqual() suprime el evento al llegar al reel`,
        }
      ).toBeTruthy()
      const eventPayload = await page.evaluate(() => (window as any).__qa.eventData['metadatachanged'])
      expect(
        eventPayload?.id,
        `${label}: id del evento debe coincidir con player.metadata.id (estado ↔ evento)`
      ).toBe(metadata?.id)

      return metadata as Record<string, unknown>
    }

    const CYCLES = 3

    for (let cycle = 1; cycle <= CYCLES; cycle++) {
      // Navegar reel a reel hasta el ad card validando cada reel.
      // MAX_REELS_PER_CYCLE=6: cubre ads.interval hasta 6 con margen.
      let reelStep = 0
      let adCardFound = false
      let lastReelId = ''
      const MAX_REELS_PER_CYCLE = 6

      while (reelStep < MAX_REELS_PER_CYCLE) {
        reelStep++
        const payload = await stepAndValidate(`ciclo ${cycle} · reel ${reelStep}`)
        if (payload === null) {
          adCardFound = true
          break
        }
        // Registrar id del último reel real antes del próximo ad card
        if (payload?.id) lastReelId = payload.id as string
      }

      expect(adCardFound, `ciclo ${cycle}: debe encontrarse un ad card en ≤${MAX_REELS_PER_CYCLE} pasos`).toBe(true)

      // ── Validar el reel post-ad card ───────────────────────────────────────
      const adId = await page.evaluate(() => (window as any).__player?.metadata?.id)
      await page.evaluate(() => { delete (window as any).__qa.eventData['metadatachanged'] })
      await page.evaluate(() => (window as any).__player?.goNext?.())

      // Aserción combinada — evento + payload:
      //   · eventData existe (evento disparó post-delete)
      //   · type === 'media' — reel real
      //   · id !== adId y id !== lastReelId — payload genuinamente nuevo (no stale)
      await expect.poll(
        async () => {
          const payload = await page.evaluate(() => (window as any).__qa.eventData['metadatachanged'])
          if (!payload?.id) return false
          return payload.type === 'media' && payload.id !== adId && payload.id !== lastReelId
        },
        { timeout: 20_000, message: `ciclo ${cycle}: metadatachanged debe emitirse con payload del nuevo reel post-ad card` }
      ).toBe(true)

      const eventPayload = await page.evaluate(() => (window as any).__qa.eventData['metadatachanged'])
      const postAdState = await page.evaluate(() => (window as any).__player?.metadata)

      expect(typeof eventPayload.id, `ciclo ${cycle}: post-ad id debe ser string`).toBe('string')
      expect((eventPayload.id as string).length, `ciclo ${cycle}: post-ad id no debe estar vacío`).toBeGreaterThan(0)
      expect(eventPayload.id, `ciclo ${cycle}: post-ad id no debe ser sintético`).not.toMatch(/^ad-/)
      expect(eventPayload.id, `ciclo ${cycle}: post-ad id debe ser diferente al del ad card`).not.toBe(adId)
      expect(typeof eventPayload.title, `ciclo ${cycle}: post-ad title debe ser string`).toBe('string')
      expect((eventPayload.title as string).length, `ciclo ${cycle}: post-ad title no debe estar vacío`).toBeGreaterThan(0)
      expect(eventPayload.type, `ciclo ${cycle}: post-ad type debe ser "media"`).toBe('media')
      expect(eventPayload.playerType, `ciclo ${cycle}: post-ad playerType debe ser "reels"`).toBe('reels')

      // Consistencia: estado interno debe coincidir con lo que el evento notificó
      expect(postAdState?.id, `ciclo ${cycle}: player.metadata.id debe coincidir con el payload del evento`).toBe(eventPayload.id)
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
    // Este test FALLA (rojo) hasta que el player corrija este comportamiento.
    // No usar test.fail() aquí — ese flag oculta el bug haciendo que el test se vea verde.

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
