import { PlayerWithTracks } from './TracksMixin'
import type { AdInfo } from '../player-types'

export class PlayerWithAds extends PlayerWithTracks {

  async getAdInfo(): Promise<AdInfo | null> {
    return this.page.evaluate(() => (window as any).__player?.ad?.info ?? null)
  }

  async getAdCuePoints(): Promise<number[]> {
    return this.page.evaluate(() => (window as any).__player?.ad?.cuePoints ?? [])
  }

  async skipAd(): Promise<void> {
    await this.page.evaluate(() => (window as any).__player?.ad?.skip())
  }

  async isAdSkippable(): Promise<boolean> {
    return this.page.evaluate(() => (window as any).__player?.ad?.info?.skippable ?? false)
  }

  async waitForAdStart(timeout = 20_000): Promise<void> {
    await this.waitForEvent('adsStarted', timeout)
  }

  async waitForAdComplete(timeout = 60_000): Promise<void> {
    await this.waitForEvent('adsComplete', timeout)
  }

  async waitForAllAdsComplete(timeout = 120_000): Promise<void> {
    await this.waitForEvent('adsAllAdsCompleted', timeout)
  }
}
