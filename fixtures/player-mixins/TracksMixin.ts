import { PlayerWithABR } from './ABRMixin'

export class PlayerWithTracks extends PlayerWithABR {

  // ── Text Tracks ────────────────────────────────────────────────────────────

  /**
   * Espera exactamente `count` text tracks con metadatos completos (language no vacío).
   * Los tracks pueden aparecer en lista antes de que el parser popule sus propiedades.
   */
  async waitForTextTracks(count: number, timeout = 10_000): Promise<void> {
    await this.page.waitForFunction(
      (expectedCount) => {
        const tracks = (window as any).__player?.textTracks
        if (!tracks || tracks.length < expectedCount) return false
        for (let i = 0; i < tracks.length; i++) {
          if (!tracks[i].language) return false
        }
        return true
      },
      count,
      { timeout }
    )
  }

  async getTextTracks(): Promise<Array<{ id: string; kind: string; label: string; language: string; mode: string }>> {
    return this.page.evaluate(() => {
      const tracks = (window as any).__player?.textTracks
      if (!tracks) return []
      return Array.from({ length: tracks.length }, (_, i) => ({
        id: tracks[i].id,
        kind: tracks[i].kind,
        label: tracks[i].label,
        language: tracks[i].language,
        mode: tracks[i].mode,
      }))
    })
  }

  async setTextTrackMode(trackId: string, mode: 'showing' | 'disabled'): Promise<void> {
    await this.page.evaluate(
      ({ id, m }) => {
        const tracks = (window as any).__player?.textTracks
        const track = tracks?.getTrackById(id)
        if (track) track.mode = m
      },
      { id: trackId, m: mode }
    )
  }

  // ── Audio Tracks ───────────────────────────────────────────────────────────

  async getAudioTracks(): Promise<Array<{ id: string; kind: string; label: string; language: string; enabled: boolean }>> {
    return this.page.evaluate(() => {
      const tracks = (window as any).__player?.audioTracks
      if (!tracks) return []
      return Array.from({ length: tracks.length }, (_, i) => ({
        id: tracks[i].id,
        kind: tracks[i].kind,
        label: tracks[i].label,
        language: tracks[i].language,
        enabled: tracks[i].enabled,
      }))
    })
  }

  async setAudioTrack(trackId: string): Promise<void> {
    await this.page.evaluate((id) => {
      const tracks = (window as any).__player?.audioTracks
      const track = tracks?.getTrackById(id)
      if (track) track.enabled = true
    }, trackId)
  }
}
