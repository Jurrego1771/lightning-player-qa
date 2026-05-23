import { PlayerWithAds } from './AdsMixin'
import type { QoEMetrics } from '../player-types'

export class PlayerWithQoE extends PlayerWithAds {

  async getQoEMetrics(): Promise<QoEMetrics> {
    return this.page.evaluate(() => {
      const p = (window as any).__player
      const video = document.querySelector('video') ?? document.querySelector('audio')
      return {
        currentTime: p?.currentTime ?? 0,
        duration: p?.duration ?? 0,
        bufferedAhead: video?.buffered.length
          ? video.buffered.end(video.buffered.length - 1) - (p?.currentTime ?? 0)
          : 0,
        droppedFrames: p?.droppedFrames ?? 0,
        readyState: video?.readyState ?? 0,
        isLive: p?.isLive ?? false,
        isDVR: p?.isDVR ?? false,
        status: p?.status ?? 'idle',
      }
    })
  }

  async measureStartupTime(): Promise<number> {
    const start = Date.now()
    await this.waitForEvent('playing')
    return Date.now() - start
  }

  async getErrors(): Promise<unknown[]> {
    return this.page.evaluate(() => (window as any).__qa?.errors ?? [])
  }

  async hasInitError(): Promise<string | null> {
    return this.page.evaluate(() => (window as any).__qa?.initError ?? null)
  }
}
