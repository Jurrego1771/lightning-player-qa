import { expect } from '@playwright/test'
import { PlayerWithState } from './StateMixin'

export class PlayerWithPlayback extends PlayerWithState {

  async play(): Promise<void> {
    await this.page.evaluate(() => (window as any).__player?.play())
  }

  /**
   * Retry hasta que el player esté listo internamente.
   * En v1.0.57+ el player puede lanzar "Player is not ready" si pause() se llama
   * antes de que su evento 'ready' interno se dispare (puede ser async post-Promise).
   */
  async pause(): Promise<void> {
    await expect(async () => {
      await this.page.evaluate(() => (window as any).__player?.pause())
    }).toPass({ timeout: 5_000 })
  }

  async getCurrentTime(): Promise<number> {
    return this.page.evaluate(() => (window as any).__player?.currentTime ?? 0)
  }

  async getDuration(): Promise<number> {
    return this.page.evaluate(() => (window as any).__player?.duration ?? 0)
  }

  async seek(seconds: number): Promise<void> {
    await this.page.evaluate((t) => { (window as any).__player.currentTime = t }, seconds)
  }

  async setVolume(value: number): Promise<void> {
    await this.page.evaluate((v) => { (window as any).__player.volume = v }, value)
  }

  async getVolume(): Promise<number> {
    return this.page.evaluate(() => (window as any).__player?.volume ?? 1)
  }

  async isPaused(): Promise<boolean> {
    return this.page.evaluate(() => (window as any).__player?.paused ?? true)
  }

  async hasEnded(): Promise<boolean> {
    return this.page.evaluate(() => (window as any).__player?.ended ?? false)
  }

  async isMuted(): Promise<boolean> {
    return this.page.evaluate(() => (window as any).__player?.muted ?? false)
  }

  async setMuted(muted: boolean): Promise<void> {
    await this.page.evaluate((m) => { (window as any).__player.muted = m }, muted)
  }

  async getPlaybackRate(): Promise<number> {
    return this.page.evaluate(() => (window as any).__player?.playbackRate ?? 1)
  }

  async setPlaybackRate(rate: number): Promise<void> {
    await this.page.evaluate((r) => { (window as any).__player.playbackRate = r }, rate)
  }

  // player.readyState no está expuesto — leer del elemento HTML5 directamente
  async getReadyState(): Promise<number> {
    return this.page.evaluate(() => {
      const v = document.querySelector('video') ?? document.querySelector('audio')
      return v?.readyState ?? 0
    })
  }

  async getHandler(): Promise<string> {
    return this.page.evaluate(() => (window as any).__player?.handler ?? '')
  }

  async getVersion(): Promise<string> {
    return this.page.evaluate(() => (window as any).__player?.version ?? '')
  }

  async getType(): Promise<string> {
    return this.page.evaluate(() => (window as any).__player?.type ?? '')
  }

  async getLoop(): Promise<boolean> {
    return this.page.evaluate(() => (window as any).__player?.loop ?? false)
  }

  async setLoop(value: boolean): Promise<void> {
    await this.page.evaluate((v) => { (window as any).__player.loop = v }, value)
  }

  async showControls(): Promise<void> {
    await this.page.evaluate(() => (window as any).__player?.showControls())
  }

  async hideControls(): Promise<void> {
    await this.page.evaluate(() => (window as any).__player?.hideControls())
  }

  async setFullscreen(value: boolean): Promise<void> {
    await this.page.evaluate((v) => { (window as any).__player.fullscreen = v }, value)
  }

  async destroy(): Promise<void> {
    await this.page.evaluate(() => (window as any).__player?.destroy?.())
  }
}
