import { expect } from '@playwright/test'
import { PlayerWithQoE } from './QoEMixin'

export class PlayerWithAssertions extends PlayerWithQoE {

  async assertIsPlaying(): Promise<void> {
    await expect.poll(() => this.getStatus(), { timeout: 10_000 }).toBe('playing')
  }

  async assertIsPaused(): Promise<void> {
    await expect.poll(() => this.getStatus(), { timeout: 10_000 }).toBe('pause')
  }

  async assertCurrentTimeNear(expected: number, toleranceSec = 2): Promise<void> {
    const actual = await this.getCurrentTime()
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(toleranceSec)
  }

  async assertBufferHealthAbove(minSeconds: number): Promise<void> {
    const metrics = await this.getQoEMetrics()
    expect(metrics.bufferedAhead).toBeGreaterThanOrEqual(minSeconds)
  }

  async assertNoInitError(): Promise<void> {
    const err = await this.hasInitError()
    expect(err, `Player init error: ${err}`).toBeNull()
  }
}
