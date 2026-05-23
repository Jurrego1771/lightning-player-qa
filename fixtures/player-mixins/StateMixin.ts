import { PlayerWithInit } from './InitMixin'
import type { PlayerStatus } from '../player-types'

export class PlayerWithState extends PlayerWithInit {

  async waitForReady(timeout = 30_000): Promise<void> {
    await this.page.waitForFunction(
      () => (window as any).__qa?.ready === true,
      { timeout }
    )
  }

  async waitForCanPlay(timeout = 15_000): Promise<void> {
    await this.waitForEvent('canplay', timeout)
  }

  async waitForEvent(eventName: string, timeout = 15_000): Promise<void> {
    await this.page.waitForFunction(
      (name) => (window as any).__qa?.events?.includes(name),
      eventName,
      { timeout }
    )
  }

  async getStatus(): Promise<PlayerStatus> {
    return this.page.evaluate(() => (window as any).__player?.status ?? 'idle')
  }

  async isLive(): Promise<boolean> {
    return this.page.evaluate(() => (window as any).__player?.isLive ?? false)
  }

  async isDVR(): Promise<boolean> {
    return this.page.evaluate(() => (window as any).__player?.isDVR ?? false)
  }

  async getMetadata(): Promise<Record<string, unknown>> {
    return this.page.evaluate(() => (window as any).__player?.metadata ?? {})
  }
}
