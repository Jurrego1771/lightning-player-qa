import { PlayerWithPlayback } from './PlaybackMixin'

export class PlayerWithNextEpisode extends PlayerWithPlayback {

  async updateNextEpisode(data: Record<string, unknown>): Promise<void> {
    await this.page.evaluate((d) => {
      ;(window as any).__player?.updateNextEpisode(d)
    }, data)
  }

  async playNext(): Promise<{ success: boolean }> {
    return this.page.evaluate(() => (window as any).__player?.playNext() ?? { success: false })
  }

  async keepWatching(): Promise<{ success: boolean }> {
    return this.page.evaluate(() => (window as any).__player?.keepWatching() ?? { success: false })
  }

  async clearTrackedEvents(): Promise<void> {
    await this.page.evaluate(() => {
      ;(window as any).__qa.events = []
      ;(window as any).__qa.eventData = {}
    })
  }

  async getEventData<T = unknown>(eventName: string): Promise<T | null> {
    return this.page.evaluate((name) => (window as any).__qa?.eventData?.[name] ?? null, eventName)
  }
}
