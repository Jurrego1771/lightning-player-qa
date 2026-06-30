#!/usr/bin/env ts-node
/**
 * setup-overlay-ad-fixture.ts
 *
 * Crea un ad con overlay VAST URL que contiene la macro $custom.tag_custom$
 * y lo asigna al media de fixture (CONTENT_ID_VOD_WITH_OVERLAY_MACRO_ADS).
 *
 * Ejecutar una vez antes de correr ads-ima-overlay-macro-e2e.spec.ts:
 *   npx ts-node scripts/setup-overlay-ad-fixture.ts
 *
 * Requiere en .env:
 *   PLATFORM_API_TOKEN  — token de API admin
 *   PLATFORM_API_URL    — opcional, default: https://dev.platform.mediastre.am/api
 */

const BASE_URL = (process.env.PLATFORM_API_URL ?? 'https://dev.platform.mediastre.am/api').replace(/\/$/, '')
const API_TOKEN = process.env.PLATFORM_API_TOKEN
const MEDIA_ID  = process.env.CONTENT_ID_VOD_WITH_OVERLAY_MACRO_ADS ?? '6a36f0857896eb99d5beffc9'

// Overlay VAST URL con múltiples macros $custom.*$:
//   $custom.tag_custom$ — valor controlado vía URL param para el test de resolución OK (PR #725)
//   $custom.dfp$        — simula el param DFP del cliente (bug: llega literal sin resolver)
//   $custom.kv$         — simula key-values de targeting del cliente (bug)
//   $custom.desc_url$   — simula description_url del cliente (bug)
// Los tres últimos NO se pasan como URL params → deben resolverse desde config de plataforma.
// Si llegan literales al ad server → HTTP 400 en GAM → bug confirmado (ticket #733 equiv.)
// PreRoll con el mismo macro — para comparar si el VMAP de Mediastream
// resuelve $custom.iu_custom$ sin necesidad de URL params en el embed.
// Si PreRoll resuelve y Overlay no → bug confirmado (diferencia de code path).
const PREROLL_VAST_URL =
  'https://pubads.g.doubleclick.net/gampad/ads' +
  '?iu=/$custom.iu_custom$/external/single_ad_samples' +
  '&sz=640x480' +
  '&gdfp_req=1' +
  '&output=vast' +
  '&unviewed_position_start=1' +
  '&env=vp' +
  '&correlator=' +
  '&tag_custom=$custom.tag_custom$'

// $custom.iu_custom$ → el network ID de GAM (ej: "21775744923")
// Si el player no resuelve el macro, iu llega como "$custom.iu_custom$/external/..."
// → GAM rechaza la request (ad unit inválido) — fallo observable y verificable.
// Para resolverlo: pasar ?custom.iu_custom=21775744923 en el embed URL.
const OVERLAY_VAST_URL =
  'https://pubads.g.doubleclick.net/gampad/ads' +
  '?iu=/$custom.iu_custom$/external/nonlinear_ad_samples' +
  '&sz=480x70' +
  '&cust_params=sample_ct%3Dnonlinear' +
  '&ciu_szs=300x250,728x90' +
  '&gdfp_req=1' +
  '&output=vast' +
  '&unviewed_position_start=1' +
  '&env=vp' +
  '&correlator=' +
  '&tag_custom=$custom.tag_custom$'

const PLATFORMS: Record<string, string> = {
  web:       'web',
  android:   'android',
  ios:       'ios',
  androidtv: 'androidtv',
  appletv:   'appletv',
  roku:      'roku',
  firetv:    'firetv',
  samsung:   'samsung',
  lg:        'lg',
  hisense:   'hisense',
}

const HEADERS = {
  'content-type':    'application/x-www-form-urlencoded; charset=UTF-8',
  'x-requested-with': 'XMLHttpRequest',
  'X-API-Token':     API_TOKEN ?? '',
}

async function createAd(): Promise<string> {
  const body = new URLSearchParams({
    'name':                                    'QA Fixture — Overlay Macros $custom.iu_custom$ $custom.tag_custom$',
    'is_enabled':                              'true',
    'type':                                    'vast',
    'schedule[mid]':                           'null',
    'schedule[pre]':                           PREROLL_VAST_URL,
    'schedule[pre_mobile]':                    '',
    'schedule[post]':                          '',
    'schedule[overlay][tag]':                  OVERLAY_VAST_URL,
    'schedule[overlay][position]':             '0',
    'schedule[pausead][tag]':                  '',
    'schedule[pausead][duration]':             '',
    'schedule[pausead][tag_mobile]':           '',
    'schedule[pausead][duration_mobile]':      '',
    'schedule[pausead][position]':             'center',
    'schedule[pausead][close_button]':         '0',
    'schedule[pausead][messages][close_text]': '',
    'schedule[pausead][messages][view_more_text]': '',
    'categories':         'null',
    'tags':               'null',
    'referers':           '',
    'min_media_time_length': '0',
  })

  // custom_params por plataforma para el overlay
  // El player en web recibe custom={tag_custom:"web"} y resuelve $custom.tag_custom$ → "web"
  for (const [platform, value] of Object.entries(PLATFORMS)) {
    body.append(`schedule[overlay_custom_params][${platform}][params][tag_custom]`, value)
  }

  const res = await fetch(`${BASE_URL}/ad/new`, {
    method:  'POST',
    headers: HEADERS,
    body:    body.toString(),
    signal:  AbortSignal.timeout(15_000),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status} al crear el ad:\n${text.slice(0, 500)}`)
  }

  const data = await res.json() as Record<string, unknown>
  const id = (data._id ?? (data.data as Record<string, unknown>)?._id) as string | undefined

  if (!id) throw new Error(`No se obtuvo _id del ad creado. Respuesta:\n${JSON.stringify(data)}`)
  return id
}

async function assignAdToMedia(adId: string): Promise<void> {
  // Replica los campos fijos del media fixture — son constantes porque el media
  // es exclusivo de este fixture y no cambia entre ejecuciones.
  const body = new URLSearchParams({
    'title':                          'Fixture media ads',
    'description':                    '',
    'user_agent_allow_regex':         'false',
    'categories[]':                   '6960065ac768f2683e5dee11',
    'tags':                           '',
    'iab_categories':                 '',
    'is_published':                   'true',
    'ads[]':                          adId,
    'google_dai':                     'null',
    'adPreroll':                      'false',
    'adPostroll':                     'false',
    'no_ad':                          'false',
    'no_logo':                        'false',
    'url':                            '',
    'date_recorded':                  'null',
    'available_from':                 'false',
    'available_until':                'false',
    'access_restrictions_enabled':    'true',
    'access_restrictions':            'null',
    'device_restriction_deny_mobile': 'false',
    'device_restriction_deny_tv':     'false',
    'companion_media_enabled':        'false',
    'companion_media':                'null',
    'next_episode':                   '0',
    'quiz_enabled':                   'false',
    'show_info[type]':                'full',
    'show_info[featuring]':           'null',
    'show_info[hosts]':               'null',
    'audio[0][_id]':                  '6a36f087ea1531367406ea7e',
    'audio[0][language]':             'un',
    'audio[0][language_name]':        'und',
    'audio[0][default]':              'true',
    'itg[enabled]':                   'false',
    'itg[channel]':                   '',
    'next_settings[alternative_canonical_url]': '',
  })

  const res = await fetch(`${BASE_URL}/media/${MEDIA_ID}`, {
    method:  'POST',
    headers: HEADERS,
    body:    body.toString(),
    signal:  AbortSignal.timeout(15_000),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status} al asignar ad a media ${MEDIA_ID}:\n${text.slice(0, 500)}`)
  }
}

async function main(): Promise<void> {
  if (!API_TOKEN) {
    console.error('Error: PLATFORM_API_TOKEN no configurado en .env')
    process.exit(1)
  }

  console.log(`Base URL : ${BASE_URL}`)
  console.log(`Media ID : ${MEDIA_ID}`)
  console.log('')

  console.log('1/2 Creando ad con overlay URL + macros $custom.iu_custom$ y $custom.tag_custom$...')
  const adId = await createAd()
  console.log(`    Ad creado: ${adId}`)

  console.log(`2/2 Asignando ad ${adId} al media ${MEDIA_ID}...`)
  await assignAdToMedia(adId)
  console.log('    Asignación completada.')

  console.log('')
  console.log('Agregar a .env (o confirmar que ya está):')
  console.log(`  CONTENT_ID_VOD_WITH_OVERLAY_MACRO_ADS=${MEDIA_ID}`)
  console.log('')
  console.log('Listo. Ahora puedes correr:')
  console.log('  npx playwright test tests/e2e/ads-ima-overlay-macro-e2e.spec.ts')
}

main().catch((err: unknown) => {
  console.error('Error:', err instanceof Error ? err.message : err)
  process.exit(1)
})
