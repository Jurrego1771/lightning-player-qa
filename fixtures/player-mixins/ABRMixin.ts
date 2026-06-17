import { PlayerWithNextEpisode } from './NextEpisodeMixin'

export class PlayerWithABR extends PlayerWithNextEpisode {

  /** Nivel de calidad activo (HLS.js only). -1 = auto */
  async getLevel(): Promise<number> {
    return this.page.evaluate(() => (window as any).__player?.level ?? -1)
  }

  async getLevels(): Promise<unknown[]> {
    return this.page.evaluate(() => (window as any).__player?.levels ?? [])
  }

  async getBitrate(): Promise<number> {
    return this.page.evaluate(() => (window as any).__player?.bitrate ?? 0)
  }

  async getBandwidth(): Promise<number> {
    return this.page.evaluate(() => (window as any).__player?.bandwidth ?? 0)
  }

  /** Nivel solicitado (puede diferir de level durante un cambio de calidad). -1 = auto */
  async getNextLevel(): Promise<number> {
    return this.page.evaluate(() => (window as any).__player?.nextLevel ?? -1)
  }

  async setLevel(level: number): Promise<void> {
    await this.page.evaluate((l) => { (window as any).__player.level = l }, level)
  }

  /**
   * @deprecated `nextLevel` es READ-ONLY en la API del player (base.js readOnlyProps).
   * Escribirlo no tiene efecto. Para forzar un nivel usar `setLevel()` (escribe `level`,
   * que sí es read-write). `getNextLevel()` se mantiene para LEER el nivel que hls.js resolvió.
   */
  async setNextLevel(level: number): Promise<void> {
    await this.page.evaluate((l) => { (window as any).__player.level = l }, level)
  }
}
