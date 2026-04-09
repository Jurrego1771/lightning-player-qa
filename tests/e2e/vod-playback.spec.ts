/**
 * vod-playback.spec.ts — Tests E2E de playback VOD
 *
 * Cubre el happy path de video bajo demanda usando la API real del player.
 * Inicialización via loadMSPlayer(), carga dinámica via load().
 */
import { test, expect, ContentIds } from '../../fixtures'

test.describe('VOD Playback', { tag: ['@regression'] }, () => {

  test.describe('Inicialización', () => {
    test('loadMSPlayer() inicializa con autoplay=false en estado listo', async ({ player }) => {
      await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: false })
      await player.waitForReady()
      await player.assertNoInitError()
    })

    test('autoplay=true: player emite playing sin interacción', async ({ player }) => {
      await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: true })
      await player.waitForEvent('playing', 20_000)
      await player.assertIsPlaying()
    })

    test('metadata del contenido se carga correctamente', async ({ player }) => {
      await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: false })
      await player.waitForEvent('metadataloaded', 15_000)

      const metadata = await player.getMetadata()
      expect(metadata).toBeTruthy()
    })
  })

  test.describe('Controles de Playback', () => {
    test.beforeEach(async ({ player }) => {
      await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: false })
      await player.waitForReady()
      await player.waitForEvent('canplay')
    })

    test('play() inicia la reproducción', async ({ player }) => {
      await player.play()
      await player.assertIsPlaying()
    })

    test('pause() detiene la reproducción', async ({ player }) => {
      await player.play()
      await player.assertIsPlaying()
      await player.pause()
      await player.assertIsPaused()
      expect(await player.isPaused()).toBe(true)
    })

    test('currentTime avanza durante la reproducción', async ({ player }) => {
      await player.play()
      await player.waitForEvent('timeupdate')
      const t1 = await player.getCurrentTime()
      await expect.poll(
        () => player.getCurrentTime(),
        { timeout: 5_000 }
      ).toBeGreaterThan(t1)
    })

    test('seek cambia posición y el player continúa reproduciendo', async ({ player }) => {
      await player.play()
      await player.waitForEvent('canplay')

      const duration = await player.getDuration()
      expect(duration).toBeGreaterThan(10)

      await player.seek(Math.floor(duration / 2))
      await player.waitForEvent('seeked')
      await player.assertCurrentTimeNear(Math.floor(duration / 2), 2)
    })

    test('volume se actualiza correctamente', async ({ player }) => {
      await player.setVolume(0.5)
      const vol = await player.getVolume()
      expect(vol).toBeCloseTo(0.5, 1)
    })
  })

  test.describe('load() — Carga Dinámica de Contenido', () => {
    test('load() cambia el contenido del player', async ({ player }) => {
      // Inicializar
      await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: false })
      await player.waitForReady()

      // Cargar contenido diferente con load()
      await player.load({ type: 'media', id: ContentIds.vodLong })
      // load() re-inicializa el player → esperar ready antes de llamar a play()
      await player.waitForReady(20_000)

      // El player sigue funcional
      await player.play()
      await player.assertIsPlaying()
    })

    test('load() desde episode carga correctamente', async ({ player }) => {
      await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: false })
      await player.waitForReady()

      // Nota: 'episode' es equivalente a 'media' internamente en el player
      await player.load({ type: 'episode', id: ContentIds.vodShort })
      await player.waitForEvent('ready', 15_000)
      await player.assertNoInitError()
    })

    test('load() seguido de play() funciona correctamente', async ({ player }) => {
      await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: false })
      await player.waitForReady()

      await player.load({ type: 'media', id: ContentIds.vodLong })
      await player.waitForEvent('ready', 15_000)

      await player.play()
      await player.assertIsPlaying()
    })
  })

  test.describe('Tracks', () => {
    test('textTracks disponibles para contenido con subtítulos', async ({ player }) => {
      await player.goto({ type: 'media', id: ContentIds.vodWithSubtitles, autoplay: false })
      await player.waitForReady(20_000)

      const tracks = await player.getTextTracks()
      expect(tracks.length).toBeGreaterThan(0)
    })

    test('audioTracks disponibles para contenido multi-audio', async ({ player }) => {
      test.skip(ContentIds.vodMultiAudio === 'TODO_VOD_MULTI_AUDIO_ID', 'ID multi-audio pendiente')

      await player.goto({ type: 'media', id: ContentIds.vodMultiAudio, autoplay: false })
      await player.waitForEvent('loadedmetadata', 15_000)

      const tracks = await player.getAudioTracks()
      expect(tracks.length).toBeGreaterThan(1)
    })

    test('cambiar audio track emite audiotrackchange', async ({ player }) => {
      test.skip(ContentIds.vodMultiAudio === 'TODO_VOD_MULTI_AUDIO_ID', 'ID multi-audio pendiente')

      await player.goto({ type: 'media', id: ContentIds.vodMultiAudio, autoplay: true })
      await player.waitForEvent('playing', 20_000)

      const tracks = await player.getAudioTracks()
      if (tracks.length < 2) {
        test.skip(true, 'Contenido no tiene múltiples audio tracks')
        return
      }

      const inactiveTrack = tracks.find(t => !t.enabled)
      if (inactiveTrack) {
        await player.setAudioTrack(inactiveTrack.id)
        await player.waitForEvent('audiotrackchange', 5_000)
      }
    })
  })

  test.describe('Ciclo de vida', () => {
    test('ended event se emite al terminar un video corto', async ({ player }) => {
      await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: true })
      await player.waitForEvent('playing', 20_000)

      // Seek al final del video
      const duration = await player.getDuration()
      await player.seek(duration - 2)
      await player.waitForEvent('ended', 15_000)

      expect(await player.hasEnded()).toBe(true)
    })

    test('destroy() remueve el player y limpia el DOM', async ({ player, page }) => {
      await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: false })
      await player.waitForReady()
      await player.destroy()

      await expect(page.locator('video')).toHaveCount(0)
    })
  })

  test.describe('Propiedades de Calidad (HLS.js)', () => {
    test('levels disponibles después de loadedmetadata', async ({ player }) => {
      await player.goto({ type: 'media', id: ContentIds.vodLong, autoplay: true })
      await player.waitForEvent('levelchanged', 25_000)

      const levels = await player.getLevels()
      expect(levels.length).toBeGreaterThan(0)
    })
  })
})
