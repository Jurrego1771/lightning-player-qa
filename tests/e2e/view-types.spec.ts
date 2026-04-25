/**
 * view-types.spec.ts — Tests de View Types del Lightning Player
 *
 * Verifica que el player inicializa y reproduce correctamente
 * con los distintos valores del parámetro `view`.
 *
 * Views con ID disponible actualmente:
 *   - video    (default) — cubierto en vod-playback y smoke
 *   - audio              — MockContentIds.audio (isolatedPlayer)
 *   - compact            — MockContentIds.audio (isolatedPlayer)
 *   - radio              — pendiente ID dedicado en plataforma
 *
 * Contrato mínimo por view:
 *   1. waitForReady() sin error de init
 *   2. play() → evento 'playing'
 *   3. assertIsPlaying()
 *
 * Decisión de diseño: usar isolatedPlayer en lugar del player fixture real.
 * El player de audio requiere platform-devel.s-mdstrm.com/waveform/... para
 * inicializarse, y este endpoint es intermitentemente inestable en DEV.
 * Con isolatedPlayer no hay waveform URL en el mock → sin dependencia externa.
 */
import { test, expect, MockContentIds, mockAudioPlayerConfig } from '../../fixtures'

test.describe('View Types — audio (compact)', { tag: ['@regression'] }, () => {

  test('view compact (audio): inicializa sin error', async ({ isolatedPlayer }) => {
    await isolatedPlayer.goto({ type: 'media', id: MockContentIds.audio, autoplay: false, view: 'compact' })
    await isolatedPlayer.waitForReady(25_000)
    await isolatedPlayer.assertNoInitError()
  })

  test('view compact (audio): puede reproducir con autoplay=true', async ({ isolatedPlayer }) => {
    await isolatedPlayer.goto({ type: 'media', id: MockContentIds.audio, autoplay: true, view: 'compact' })
    await isolatedPlayer.waitForEvent('playing', 25_000)
    await isolatedPlayer.assertIsPlaying()
  })

  test('view compact (audio): play() → playing desde estado pausado', async ({ isolatedPlayer }) => {
    await isolatedPlayer.goto({ type: 'media', id: MockContentIds.audio, autoplay: false, view: 'compact' })
    await isolatedPlayer.waitForReady(25_000)
    await isolatedPlayer.play()
    await isolatedPlayer.waitForEvent('playing', 20_000)
    await isolatedPlayer.assertIsPlaying()
  })
})

test.describe('View Types — compact', { tag: ['@regression'] }, () => {

  test('view compact: inicializa sin error', async ({ isolatedPlayer }) => {
    // compact no requiere audio player config — funciona con el default (view: video)
    await isolatedPlayer.goto({ type: 'media', id: MockContentIds.audio, autoplay: false, view: 'compact' })
    await isolatedPlayer.waitForReady(25_000)
    await isolatedPlayer.assertNoInitError()
  })

  test('view compact: puede reproducir', async ({ isolatedPlayer }) => {
    await isolatedPlayer.goto({ type: 'media', id: MockContentIds.audio, autoplay: false, view: 'compact' })
    await isolatedPlayer.waitForReady(25_000)
    await isolatedPlayer.play()
    await isolatedPlayer.waitForEvent('playing', 20_000)
    await isolatedPlayer.assertIsPlaying()
  })
})

test.describe('View Types — radio', { tag: ['@regression'] }, () => {
  // TODO: view:radio requiere type:'live' — pendiente MockContentIds.live con stream local.
  // type:'media' + view:'radio' no es una combinación válida en el Lightning Player.

  test.skip('view radio: inicializa sin error', async ({ isolatedPlayer, page }) => {
    await mockAudioPlayerConfig(page)
    await isolatedPlayer.goto({ type: 'live', id: MockContentIds.live, autoplay: false, view: 'radio' })
    await isolatedPlayer.waitForReady(25_000)
    await isolatedPlayer.assertNoInitError()
  })

  test.skip('view radio: puede reproducir con autoplay=true', async ({ isolatedPlayer, page }) => {
    await mockAudioPlayerConfig(page)
    await isolatedPlayer.goto({ type: 'live', id: MockContentIds.live, autoplay: true, view: 'radio' })
    await isolatedPlayer.waitForEvent('playing', 25_000)
    await isolatedPlayer.assertIsPlaying()
  })
})
