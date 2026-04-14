/**
 * reels-metadata-dedup.spec.ts — Deduplicación de eventos metadata en Reels
 *
 * Cubre: fix/issue-627 — ReelsControls agrega mapMetadata()/getMetadataKey() y
 * lastMetadataKeyRef para suprimir emisiones duplicadas de metadatachanged cuando el
 * mismo item de Reels se re-renderiza internamente.
 *
 * Cómo funciona el fix:
 *   - Al montar ReelsControls, se suscribe a currentItemApi.on('metadatachanged')
 *   - Calcula una key: `id|src` para cada metadata recibida (getMetadataKey)
 *   - Si la key es la misma que la anterior (lastMetadataKeyRef), suprime la emisión
 *   - Solo propaga metadatachanged cuando el item cambia realmente
 *   - Metadata sin content id (ej: ads) se suprime siempre
 *
 * ── Alcance de estos tests de integración ──────────────────────────────────────
 *
 * Con isolatedPlayer + mock content (vod.json), el player NO emite metadatachanged.
 * Motivo: getMetadataKey() requiere metadata.id en el payload del evento, que el
 * player solo popula cuando el content tiene un id real de la plataforma.
 * Con mock content, el player trata la metadata como "ads metadata" y la suprime.
 *
 * Por eso estos tests de integración validan AUSENCIA DE DUPLICADOS, no que el
 * evento se emita. Ambas cosas son verdad:
 *   - 0 eventos = mock content sin id real → no hay duplicados (pasa con 0)
 *   - 1 evento  = content real con id     → no hay duplicados (pasa con 1)
 *   - 2+ eventos = bug de duplicación     → FALLA correctamente
 *
 * ── Dónde están los tests de regla de negocio ──────────────────────────────────
 *
 * Las siguientes validaciones requieren content real (plataforma DEV):
 *   - metadatachanged SE EMITE al menos una vez
 *   - el payload incluye title, mediaId, etc.
 *   - metadatachanged se re-emite post-ad (flujo 5 reels → ad → reel 6)
 *
 * Ver: tests/e2e/reels-playback.spec.ts
 *   · "Reels — Playback básico": validación positiva + payload
 *   · "Reels — Regresión post-ad": flujo 5 reels → ad → reel 6 → metadata
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
    // si el fix de lastMetadataKeyRef no funcionara
    await page.waitForTimeout(3_000)

    const countAfterWait = await page.evaluate(() =>
      (window as any).__qa.events.filter((e: string) => e === 'metadatachanged').length
    )

    expect(
      countAfterWait,
      `metadatachanged no debe emitirse más veces durante la estabilización (fix/issue-627). ` +
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
      'un solo item de Reels NO debe generar más de 1 metadatachanged (fix/issue-627)'
    ).toBeLessThanOrEqual(1)
  })

  test('player en view reels no reporta error de inicialización', async ({ isolatedPlayer: player }) => {
    // Smoke de integración: view 'reels' no causa errores de init con mock content.
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: false, view: 'reels' })
    await player.waitForReady(20_000)
    await player.assertNoInitError()
  })
})
