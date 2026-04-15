/**
 * reels-metadata-dedup.spec.ts — Deduplicación de eventos metadata en Reels
 *
 * Cubre: fix/issue-627 — prevención de emisiones duplicadas de metadatachanged
 * cuando el mismo item de Reels se re-renderiza internamente.
 *
 * Cómo funciona la deduplicación (src/metadata/exposeMetadata.js):
 *   - useExposeMetadata() mantiene una ref (metadataRef) con el último valor emitido
 *   - En cada render compara currentMetadata vs metadataRef.current con Lodash isEqual()
 *   - Solo emite metadatachanged si el objeto completo difiere del anterior
 *   - Debounce de 100ms para absorber flushes síncronos de React
 *
 * ── Alcance de estos tests de integración ──────────────────────────────────────
 *
 * Con isolatedPlayer + mock content (vod.json), el player puede emitir 0 o 1 vez
 * metadatachanged dependiendo de si el mock tiene un id reconocible.
 * El invariante que validamos: el conteo NO sube durante la ventana de estabilización,
 * sea 0 (mock) o 1 (content real). Cualquier subida es un bug de dedup.
 *
 *   - 0 eventos = mock content sin id de plataforma → no hay duplicados (pasa con 0)
 *   - 1 evento  = content con id real               → no hay duplicados (pasa con 1)
 *   - 2+ eventos = bug de duplicación               → FALLA correctamente
 *
 * ── Dónde están los tests de regla de negocio ──────────────────────────────────
 *
 * Las siguientes validaciones requieren content real (plataforma DEV):
 *   - player.metadata.id cambia al hacer swipe
 *   - metadatachanged se re-emite post-ad (flujo reels → ad card → reel siguiente)
 *
 * Ver: tests/e2e/reels-playback.spec.ts
 *   · "Reels — Playback básico": validación positiva + payload via player.metadata
 *   · "Reels — Regresión post-ad": flujo reel → ad card → reel, validado via player.metadata
 *
 * Fixture: isolatedPlayer (plataforma mockeada + stream HLS local)
 * Tag: @integration
 */
import { test, expect, MockContentIds } from '../../fixtures'

test.describe('Reels — Deduplicación de metadata (fix/issue-627)', { tag: ['@integration'] }, () => {

  test('Reels view inicia correctamente con isolatedPlayer y llega a playing', async ({ isolatedPlayer: player }) => {
    // Valida que view: 'reels' no rompe la inicialización del player con mock content.
    // El Reels swiper se monta aunque solo haya un item — el player debe llegar a playing.
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true, view: 'reels' })
    await player.waitForEvent('playing', 20_000)
    await player.assertNoInitError()
  })

  test('metadatachanged NO se duplica durante ventana de estabilización de 3s (no-dup window)', async ({ isolatedPlayer: player, page }) => {
    // Valida el comportamiento central del fix: que una vez que el item está activo,
    // ReelsControls no vuelve a emitir metadatachanged por re-renders internos.
    //
    // Con mock content: metadatachanged emite 0 veces (sin id real → suprimido).
    // El invariante que importa: el conteo NO sube durante la ventana de estabilización,
    // sea que empiece en 0 (mock) o en 1 (content real). Cualquier subida es un bug.
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true, view: 'reels' })
    await player.waitForEvent('playing', 20_000)

    const countAfterInit = await page.evaluate(() =>
      (window as any).__qa.events.filter((e: string) => e === 'metadatachanged').length
    )

    // Ventana de 3s: tiempo suficiente para que re-renders internos emitan duplicados
    // si la deduplicación por isEqual() dejara de funcionar
    await page.waitForTimeout(3_000)

    const countAfterWait = await page.evaluate(() =>
      (window as any).__qa.events.filter((e: string) => e === 'metadatachanged').length
    )

    expect(
      countAfterWait,
      `metadatachanged no debe emitirse más veces durante la estabilización (dedup por isEqual). ` +
      `Inicio: ${countAfterInit}, después: ${countAfterWait}`
    ).toBe(countAfterInit)
  })

  test('metadatachanged no excede 1 durante toda la sesión con un solo item', async ({ isolatedPlayer: player, page }) => {
    // Con el fix, un item solo puede generar metadatachanged una vez máximo.
    // El bug original causaba múltiples emisiones por el mismo item.
    //
    // Con mock content el conteo será 0 (sin id real → suprimido) — correcto.
    // Con content real el conteo será 1 — también correcto.
    // Si el conteo fuera 2+, es el bug de duplicación.
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true, view: 'reels' })
    await player.waitForEvent('playing', 20_000)

    await page.waitForTimeout(2_000)

    const metadataCount = await page.evaluate(() =>
      (window as any).__qa.events.filter((e: string) => e === 'metadatachanged').length
    )

    expect(
      metadataCount,
      'un solo item de Reels NO debe generar más de 1 metadatachanged (dedup por isEqual)'
    ).toBeLessThanOrEqual(1)
  })

  test('player en view reels no reporta error de inicialización', async ({ isolatedPlayer: player }) => {
    // Smoke de integración: view 'reels' no causa errores de init con mock content.
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: false, view: 'reels' })
    await player.waitForReady(20_000)
    await player.assertNoInitError()
  })
})
