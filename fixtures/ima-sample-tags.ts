/**
 * ima-sample-tags.ts — Ad tags de muestra OFICIALES de Google IMA (VAST/VMAP productivos)
 *
 * Fuente: https://developers.google.com/interactive-media-ads/docs/sdks/html5/client-side/tags
 * Extraídos verbatim el 2026-06-17. Son tags reales servidos por pubads.g.doubleclick.net
 * (ad unit /21775744923/external/*). Devuelven VAST/VMAP de verdad y reproducen en headless.
 *
 * Uso en tests (en lugar del mock VAST, para validar contra ads productivos):
 *   import { ImaSampleTags } from '../../fixtures/ima-sample-tags'
 *   await player.goto({ type:'media', id: MockContentIds.vod, autoplay:true,
 *                       adsMap: ImaSampleTags.singleInlineLinear })
 *
 * NOTA: dependen de red real a Google + fill de Google → NO son 100% deterministas
 * (pueden no llenar por geo/consent/no-fill). Para tests deterministas usar el mock VAST.
 * IMPORTANTE: NO usar tags con `impl=s` (server-side) en client-side IMA — no reproducen.
 */

export interface ImaSampleTag {
  /** Nombre legible del sample (de la doc de Google) */
  label: string
  /** Tipo de respuesta: VAST (ad directo) o VMAP (con ad breaks por timeOffset) */
  format: 'vast' | 'vmap'
  /** URL completa del ad tag */
  url: string
}

const BASE = 'https://pubads.g.doubleclick.net/gampad/ads'

export const ImaSampleTags = {
  // ── VAST (ads directos) ──────────────────────────────────────────────────
  singleInlineLinear:
    `${BASE}?iu=/21775744923/external/single_ad_samples&sz=640x480&cust_params=sample_ct%3Dlinear&ciu_szs=300x250%2C728x90&gdfp_req=1&output=vast&unviewed_position_start=1&env=vp&correlator=`,

  singleSkippableInline:
    `${BASE}?iu=/21775744923/external/single_preroll_skippable&sz=640x480&ciu_szs=300x250%2C728x90&gdfp_req=1&output=vast&unviewed_position_start=1&env=vp&correlator=`,

  singleRedirectLinear:
    `${BASE}?iu=/21775744923/external/single_ad_samples&sz=640x480&cust_params=sample_ct%3Dredirectlinear&ciu_szs=300x250%2C728x90&gdfp_req=1&output=vast&unviewed_position_start=1&env=vp&correlator=`,

  singleRedirectError:
    `${BASE}?iu=/21775744923/external/single_ad_samples&sz=640x480&cust_params=sample_ct%3Dredirecterror&ciu_szs=300x250%2C728x90&gdfp_req=1&output=vast&unviewed_position_start=1&env=vp&correlator=`,

  singleRedirectBrokenFallback:
    `${BASE}?iu=/21775744923/external/single_ad_samples&sz=640x480&cust_params=sample_ct%3Dredirecterror&ciu_szs=300x250%2C728x90&gdfp_req=1&output=vast&unviewed_position_start=1&env=vp&nofb=1&correlator=`,

  singleVpaid2Linear:
    `${BASE}?iu=/21775744923/external/single_ad_samples&sz=640x480&cust_params=sample_ct%3Dlinearvpaid2js&ciu_szs=300x250%2C728x90&gdfp_req=1&output=vast&unviewed_position_start=1&env=vp&correlator=`,

  singleVpaid2NonLinear:
    `${BASE}?iu=/21775744923/external/single_ad_samples&sz=640x480&cust_params=sample_ct%3Dnonlinearvpaid2js&ciu_szs=728x90%2C300x250&gdfp_req=1&output=vast&unviewed_position_start=1&env=vp&correlator=`,

  singleNonLinearInline:
    `${BASE}?iu=/21775744923/external/nonlinear_ad_samples&sz=480x70&cust_params=sample_ct%3Dnonlinear&ciu_szs=300x250%2C728x90&gdfp_req=1&output=vast&unviewed_position_start=1&env=vp&correlator=`,

  singleVerticalInlineLinear:
    `${BASE}?iu=/21775744923/external/single_vertical_ad_samples&sz=360x640&gdfp_req=1&output=vast&unviewed_position_start=1&env=vp&correlator=`,

  simidSurveyPreroll:
    `${BASE}?iu=/21775744923/external/simid&description_url=https%3A%2F%2Fdevelopers.google.com%2Finteractive-media-ads&sz=640x480&gdfp_req=1&output=vast&unviewed_position_start=1&env=vp&correlator=`,

  omSdkSamplePreroll:
    `${BASE}?iu=/21775744923/external/omid_ad_samples&env=vp&gdfp_req=1&output=vast&sz=640x480&description_url=http%3A%2F%2Ftest_site.com%2Fhomepage&vpmute=0&vpa=0&vad_format=linear&url=http%3A%2F%2Ftest_site.com&vpos=preroll&unviewed_position_start=1&correlator=`,

  // ── VMAP (ad breaks: pre/mid/post) ─────────────────────────────────────────
  vmapSessionAdRulePreroll:
    `${BASE}?iu=/21775744923/external/vmap_ad_samples&sz=640x480&cust_params=sar%3Da0f2&ciu_szs=300x250&ad_rule=1&gdfp_req=1&output=vmap&unviewed_position_start=1&env=vp&correlator=`,

  vmapPreroll:
    `${BASE}?iu=/21775744923/external/vmap_ad_samples&sz=640x480&cust_params=sample_ar%3Dpreonly&ciu_szs=300x250%2C728x90&gdfp_req=1&ad_rule=1&output=vmap&unviewed_position_start=1&env=vp&correlator=`,

  vmapPrerollBumper:
    `${BASE}?iu=/21775744923/external/vmap_ad_samples&sz=640x480&cust_params=sample_ar%3Dpreonlybumper&ciu_szs=300x250&gdfp_req=1&ad_rule=1&output=vmap&unviewed_position_start=1&env=vp&correlator=`,

  vmapPostroll:
    `${BASE}?iu=/21775744923/external/vmap_ad_samples&sz=640x480&cust_params=sample_ar%3Dpostonly&ciu_szs=300x250&gdfp_req=1&ad_rule=1&output=vmap&unviewed_position_start=1&env=vp&correlator=`,

  vmapPostrollBumper:
    `${BASE}?iu=/21775744923/external/vmap_ad_samples&sz=640x480&cust_params=sample_ar%3Dpostonlybumper&ciu_szs=300x250&gdfp_req=1&ad_rule=1&output=vmap&unviewed_position_start=1&env=vp&correlator=`,

  vmapMidrollPod2Skippable:
    `${BASE}?iu=/21775744923/external/vmap_skip_ad_samples&sz=640x480&cust_params=sample_ar%3Dmidskiponly&ciu_szs=300x250&gdfp_req=1&ad_rule=1&output=vmap&unviewed_position_start=1&env=vp&cmsid=496&vid=short_onecue&correlator=`,

  vmapPreMidPostSingle:
    `${BASE}?iu=/21775744923/external/vmap_ad_samples&sz=640x480&cust_params=sample_ar%3Dpremidpost&ciu_szs=300x250&gdfp_req=1&ad_rule=1&output=vmap&unviewed_position_start=1&env=vp&cmsid=496&vid=short_onecue&correlator=`,

  vmapPreMidPostStandardPod3:
    `${BASE}?iu=/21775744923/external/vmap_ad_samples&sz=640x480&cust_params=sample_ar%3Dpremidpostpod&ciu_szs=300x250&gdfp_req=1&ad_rule=1&output=vmap&unviewed_position_start=1&env=vp&cmsid=496&vid=short_onecue&correlator=`,

  vmapPreMidPostOptimizedPod3:
    `${BASE}?iu=/21775744923/external/vmap_ad_samples&sz=640x480&cust_params=sample_ar%3Dpremidpostoptimizedpod&ciu_szs=300x250&gdfp_req=1&ad_rule=1&output=vmap&unviewed_position_start=1&env=vp&cmsid=496&vid=short_onecue&correlator=`,

  vmapPreMidPostStandardPod3Bumper:
    `${BASE}?iu=/21775744923/external/vmap_ad_samples&sz=640x480&cust_params=sample_ar%3Dpremidpostpodbumper&ciu_szs=300x250&gdfp_req=1&ad_rule=1&output=vmap&unviewed_position_start=1&env=vp&cmsid=496&vid=short_onecue&correlator=`,

  vmapPreMidPostOptimizedPod3Bumper:
    `${BASE}?iu=/21775744923/external/vmap_ad_samples&sz=640x480&cust_params=sample_ar%3Dpremidpostoptimizedpodbumper&ciu_szs=300x250&gdfp_req=1&ad_rule=1&output=vmap&unviewed_position_start=1&env=vp&cmsid=496&vid=short_onecue&correlator=`,

  vmapPreMidPostLongPod5:
    `${BASE}?iu=/21775744923/external/vmap_ad_samples&sz=640x480&cust_params=sample_ar%3Dpremidpostlongpod&ciu_szs=300x250&gdfp_req=1&ad_rule=1&output=vmap&unviewed_position_start=1&env=vp&cmsid=496&vid=short_onecue&correlator=`,
} as const

export type ImaSampleTagKey = keyof typeof ImaSampleTags

/**
 * VAST estáticos de terceros (basil79.github.io/vast-sample-tags).
 *
 * A diferencia de los ImaSampleTags (pubads de Google → fill no-determinista),
 * estos son XML ESTÁTICOS: siempre devuelven el mismo VAST + el mismo MediaFile mp4.
 * → DETERMINISTAS y con creativo REAL (no sintético como el mock local).
 *
 * Verificados el 2026-06-17: reproducen en headless, disparan el ciclo completo
 * (adsStarted → cuartiles) y piden el .mp4 real.
 *
 * Caveat: dependen de red externa (GitHub Pages). Los beacons de tracking apuntan
 * a www.example.com (no responden, pero IMA los dispara → el adBeaconInterceptor
 * los detecta como salientes; el conteo es verificable, el destino no).
 *
 * Uso para tests de ads CSAI (en lugar del mock local):
 *   await player.goto({ ..., adsMap: StaticVastTags.linearSkippable })
 */
export const StaticVastTags = {
  /** VAST 2.0 linear, skippable @5s, duración 30s, MediaFile mp4 real (pg/vast.xml) */
  linearSkippable: 'https://basil79.github.io/vast-sample-tags/pg/vast.xml',
  /** VAST 2.0 vacío (sin Ad) — para tests de no-fill / continuación sin ad */
  emptyNoAd: 'https://basil79.github.io/vast-sample-tags/empty-no-ad.xml',
  /** VAST 4.0 (rise.xml) — variante de versión más nueva */
  vast4: 'https://basil79.github.io/vast-sample-tags/rise.xml',
  /** VAST 2.0 (twe/vast.xml) */
  linearTwe: 'https://basil79.github.io/vast-sample-tags/twe/vast.xml',
  /** VAST 2.0 (rama/vast.xml) */
  linearRama: 'https://basil79.github.io/vast-sample-tags/rama/vast.xml',
  /** VAST 2.0 con companion ads (companion-ads/vast.xml) */
  companionAds: 'https://basil79.github.io/vast-sample-tags/companion-ads/vast.xml',
} as const

export type StaticVastTagKey = keyof typeof StaticVastTags

/**
 * Tags de pubads de Google para casos que basil NO cubre (NonLinear).
 * Son pubads REALES → dependen del fill de Google (no-deterministas) → @flaky.
 *
 * VERIFICADO 2026-06-17:
 *  - NonLinear: usar SIN impl=s. La URL con impl=s NO reproduce (request 200 pero
 *    adsStarted nunca dispara). Usamos la oficial nonlinear_ad_samples.
 *  - VMAP: NINGÚN VMAP de pubads real arranca por adsMap en este harness (0 eventos,
 *    ni la del equipo ni la oficial vmapPreroll). Para VMAP usar el MOCK (/vmap/*),
 *    que sí inserta los breaks. No incluido aquí.
 */
export const PubadsSampleTags = {
  /** NonLinear overlay — oficial IMA, SIN impl=s (reproduce: adsLoaded→adsImpression→adsStarted). */
  nonLinear: ImaSampleTags.singleNonLinearInline,
} as const

/** Lista con metadata (label + format) para iterar en tests parametrizados. */
export const ImaSampleTagList: ImaSampleTag[] = [
  { label: 'Single Inline Linear',            format: 'vast', url: ImaSampleTags.singleInlineLinear },
  { label: 'Single Skippable Inline',         format: 'vast', url: ImaSampleTags.singleSkippableInline },
  { label: 'Single Redirect Linear',          format: 'vast', url: ImaSampleTags.singleRedirectLinear },
  { label: 'Single Redirect Error',           format: 'vast', url: ImaSampleTags.singleRedirectError },
  { label: 'Single Redirect Broken (Fallback)', format: 'vast', url: ImaSampleTags.singleRedirectBrokenFallback },
  { label: 'Single VPAID 2.0 Linear',         format: 'vast', url: ImaSampleTags.singleVpaid2Linear },
  { label: 'Single VPAID 2.0 Non-Linear',     format: 'vast', url: ImaSampleTags.singleVpaid2NonLinear },
  { label: 'Single Non-linear Inline',        format: 'vast', url: ImaSampleTags.singleNonLinearInline },
  { label: 'Single Vertical Inline Linear',   format: 'vast', url: ImaSampleTags.singleVerticalInlineLinear },
  { label: 'SIMID Survey Pre-roll',           format: 'vast', url: ImaSampleTags.simidSurveyPreroll },
  { label: 'OM SDK Sample Pre-roll',          format: 'vast', url: ImaSampleTags.omSdkSamplePreroll },
  { label: 'VMAP Session Ad Rule Pre-roll',   format: 'vmap', url: ImaSampleTags.vmapSessionAdRulePreroll },
  { label: 'VMAP Pre-roll',                   format: 'vmap', url: ImaSampleTags.vmapPreroll },
  { label: 'VMAP Pre-roll + Bumper',          format: 'vmap', url: ImaSampleTags.vmapPrerollBumper },
  { label: 'VMAP Post-roll',                  format: 'vmap', url: ImaSampleTags.vmapPostroll },
  { label: 'VMAP Post-roll + Bumper',         format: 'vmap', url: ImaSampleTags.vmapPostrollBumper },
  { label: 'VMAP Mid-roll pod (2 skippable)', format: 'vmap', url: ImaSampleTags.vmapMidrollPod2Skippable },
  { label: 'VMAP Pre/Mid/Post Single',        format: 'vmap', url: ImaSampleTags.vmapPreMidPostSingle },
  { label: 'VMAP Pre/Mid(pod3)/Post',         format: 'vmap', url: ImaSampleTags.vmapPreMidPostStandardPod3 },
  { label: 'VMAP Pre/Mid(opt-pod3)/Post',     format: 'vmap', url: ImaSampleTags.vmapPreMidPostOptimizedPod3 },
  { label: 'VMAP Pre/Mid(pod3)/Post + Bumpers', format: 'vmap', url: ImaSampleTags.vmapPreMidPostStandardPod3Bumper },
  { label: 'VMAP Pre/Mid(opt-pod3)/Post + Bumpers', format: 'vmap', url: ImaSampleTags.vmapPreMidPostOptimizedPod3Bumper },
  { label: 'VMAP Pre/Mid(long-pod5 /10s)/Post', format: 'vmap', url: ImaSampleTags.vmapPreMidPostLongPod5 },
]
