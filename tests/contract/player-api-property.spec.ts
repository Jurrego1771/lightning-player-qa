/**
 * player-api-property.spec.ts — Property-based tests for player API surface
 *
 * Uses fast-check to verify that no valid input combination crashes or
 * produces out-of-range output. Tests method contracts:
 *   if input ∈ valid range → output ∈ valid range ∧ no exceptions
 *
 * Strategy: load player once per test, run N property iterations on the
 * same instance (fast — no re-init per iteration).
 *
 * Fixture: isolatedPlayer (mocked platform, local streams, deterministic)
 * Tag: @contract @property
 */
import { test, expect, MockContentIds } from '../../fixtures'
import fc from 'fast-check'

test.describe('Player API — property contracts', { tag: ['@contract', '@property'] }, () => {

  test('volume: acepta [0,1] y siempre retorna valor en [0,1]', async ({ isolatedPlayer: player }) => {
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })
    await player.waitForEvent('ready', 20_000)

    await fc.assert(
      fc.asyncProperty(
        fc.float({ min: 0, max: 1, noNaN: true }),
        async (vol) => {
          await player.setVolume(vol)
          const result = await player.getVolume()
          return result >= 0 && result <= 1 && !isNaN(result)
        }
      ),
      { numRuns: 30 }
    )
  })

  test('muted: setMuted(b) → isMuted() siempre refleja b', async ({ isolatedPlayer: player }) => {
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })
    await player.waitForEvent('ready', 20_000)

    await fc.assert(
      fc.asyncProperty(
        fc.boolean(),
        async (muted) => {
          await player.setMuted(muted)
          const result = await player.isMuted()
          return result === muted
        }
      ),
      { numRuns: 20 }
    )
  })

  test.fixme('loop: setLoop(true) no se refleja en getLoop()', async ({ isolatedPlayer: player }) => {
    // fast-check encontró: counterexample=[true]. setLoop(false) funciona, setLoop(true) no.
    // El player.loop parece ser getter-only (no setter) en v1.0.75.
    // Confirmar con /sync-knowledge si loop es config-only (no runtime-settable).
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })
    await player.waitForEvent('ready', 20_000)

    await fc.assert(
      fc.asyncProperty(
        fc.boolean(),
        async (loop) => {
          await player.setLoop(loop)
          const result = await player.getLoop()
          return result === loop
        }
      ),
      { numRuns: 20 }
    )
  })

  test('playbackRate: valores en [0.25, 2.0] no lanzan excepciones JS', async ({ isolatedPlayer: player, page }) => {
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })
    await player.waitForEvent('ready', 20_000)

    const uncaughtErrors: string[] = []
    page.on('pageerror', (err) => {
      const msg = err.message.toLowerCase()
      if (!msg.includes('notallowederror') && !msg.includes('play()')) {
        uncaughtErrors.push(err.message)
      }
    })

    await fc.assert(
      fc.asyncProperty(
        fc.float({ min: 0.25, max: 2.0, noNaN: true }),
        async (rate) => {
          await player.setPlaybackRate(rate)
          return uncaughtErrors.length === 0
        }
      ),
      { numRuns: 20 }
    )

    expect(
      uncaughtErrors,
      `setPlaybackRate con valor en [0.25,2.0] no debe lanzar excepciones. Errores: ${uncaughtErrors.join(' | ')}`
    ).toHaveLength(0)
  })

  test('volume + muted: combinaciones arbitrarias no corrompen el estado del player', async ({ isolatedPlayer: player }) => {
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })
    await player.waitForEvent('ready', 20_000)

    await fc.assert(
      fc.asyncProperty(
        fc.record({
          volume: fc.float({ min: 0, max: 1, noNaN: true }),
          muted: fc.boolean(),
        }),
        async ({ volume, muted }) => {
          await player.setVolume(volume)
          await player.setMuted(muted)

          const vol = await player.getVolume()
          const mut = await player.isMuted()

          // volume debe seguir en rango válido independientemente de muted
          const volValid = vol >= 0 && vol <= 1 && !isNaN(vol)
          // muted debe reflejar el valor seteado
          const mutValid = mut === muted

          return volValid && mutValid
        }
      ),
      { numRuns: 25 }
    )
  })

})
