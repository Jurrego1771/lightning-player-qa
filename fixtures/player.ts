/**
 * player.ts — Punto de composición del Page Object Model
 *
 * LightningPlayerPage se construye via cadena de herencia por dominio:
 *   PlayerBase → Init → State → Playback → ABR → Tracks → Ads → QoE → Assertions
 *
 * Cada dominio vive en fixtures/player-mixins/ — editar allí, no aquí.
 */
export type { PlayerStatus, ContentType, PlayerView, InitConfig, LoadOptions, QoEMetrics, AdInfo } from './player-types'
export { PlayerBase } from './player-mixins/PlayerBase'

import { PlayerWithAssertions } from './player-mixins/AssertionsMixin'

export class LightningPlayerPage extends PlayerWithAssertions {}
