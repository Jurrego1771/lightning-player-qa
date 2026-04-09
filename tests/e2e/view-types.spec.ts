/**
 * view-types.spec.ts — Tests de View Types del Lightning Player
 *
 * Verifica que el player inicializa y reproduce correctamente
 * con los distintos valores del parámetro `view`.
 *
 * Views con ID disponible actualmente:
 *   - video    (default) — cubierto en vod-playback y smoke
 *   - audio              — ContentIds.audio
 *   - compact            — ContentIds.audio (sidebar de audio)
 *   - radio              — ContentIds.radio (mismo ID que audio por confirmar)
 *
 * Contrato mínimo por view:
 *   1. waitForReady() sin error de init
 *   2. play() → evento 'playing'
 *   3. assertIsPlaying()
 */
import { test, expect, ContentIds } from '../../fixtures'

test.describe('View Types — audio', { tag: ['@regression'] }, () => {

  test('view audio: inicializa sin error', async ({ player }) => {
    await player.goto({ type: 'media', id: ContentIds.audio, autoplay: false, view: 'audio' })
    await player.waitForReady(25_000)
    await player.assertNoInitError()
  })

  test('view audio: puede reproducir con autoplay=true', async ({ player }) => {
    await player.goto({ type: 'media', id: ContentIds.audio, autoplay: true, view: 'audio' })
    await player.waitForEvent('playing', 25_000)
    await player.assertIsPlaying()
  })

  test('view audio: play() → playing desde estado pausado', async ({ player }) => {
    await player.goto({ type: 'media', id: ContentIds.audio, autoplay: false, view: 'audio' })
    await player.waitForReady(25_000)
    await player.play()
    await player.waitForEvent('playing', 20_000)
    await player.assertIsPlaying()
  })
})

test.describe('View Types — compact', { tag: ['@regression'] }, () => {

  test('view compact: inicializa sin error', async ({ player }) => {
    await player.goto({ type: 'media', id: ContentIds.audio, autoplay: false, view: 'compact' })
    await player.waitForReady(25_000)
    await player.assertNoInitError()
  })

  test('view compact: puede reproducir', async ({ player }) => {
    await player.goto({ type: 'media', id: ContentIds.audio, autoplay: false, view: 'compact' })
    await player.waitForReady(25_000)
    await player.play()
    await player.waitForEvent('playing', 20_000)
    await player.assertIsPlaying()
  })
})

test.describe('View Types — radio', { tag: ['@regression'] }, () => {

  test('view radio: inicializa sin error', async ({ player }) => {
    await player.goto({ type: 'media', id: ContentIds.radio, autoplay: false, view: 'radio' })
    await player.waitForReady(25_000)
    await player.assertNoInitError()
  })

  test('view radio: puede reproducir con autoplay=true', async ({ player }) => {
    await player.goto({ type: 'media', id: ContentIds.radio, autoplay: true, view: 'radio' })
    await player.waitForEvent('playing', 25_000)
    await player.assertIsPlaying()
  })
})
