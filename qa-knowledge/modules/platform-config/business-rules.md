# platform-config — Business Rules

Reglas derivadas del código fuente (`src/platform/loadConfig.js`, `src/api/api.js`,
`src/helper/request.js`, `constants.cjs`), de los fixtures de QA y de prácticas de la industria OTT.

## Reglas de resolución de configuración

**BR-PLAT-001** — accountId y mediaId implícitos vía type + id
Toda resolución requiere un `type` (`media`|`episode`|`live`|`dvr`) y un `id`. El `account` y el `mediaId`
llegan en la respuesta del content config (`mediaId` puede venir en `metadata` o defaultear al `id` solicitado).
Sin `type`/`id` válidos no se construye el `requestPath` y se aborta con `PlayerInitError('Invalid type...')`.

**BR-PLAT-002** — type mapea a un path específico del endpoint
`media` → `/{video|audio}/{id}.json` (según `renderAs`), `episode` → `/episode/{id}.json`,
`live`|`dvr` → `/live-stream/{id}.json`. El player config (en `api.js`) mapea `live`/`dvr` a `live-stream`
para el path `/{configType}/{id}/player/{playerId}`. Un `type` fuera de ese conjunto es inválido y aborta.

**BR-PLAT-003** — el query del config siempre incluye validate, metadata y cache-bust
Todo request de content config lleva `validate=true` (aplica reglas de closed access / restricciones),
`metadata=true` (incluye title/description aun en errores) y `_={timestamp}` (cache-busting). Estos son
obligatorios y no condicionales.

**BR-PLAT-004** — la estructura `src` define el universo de formatos reproducibles
El backend entrega `src` con cero o más de: `hls`, `mpd`, `mp4`, `m4a`, `mp3`. La prioridad de fallback es
`mp4=hls`, `m4a=mp4`, `mp3=m4a`. Para video el default es `hls||mp3`; para audio siempre `mp3`. DASH (`mpd`)
solo se usa si se solicita explícitamente `format=dash|mpd` y existe `mpd` e `isVideo`.

**BR-PLAT-005** — el tipo de contenido lo decide view.type (player config) + player.type/renderAs (content config)
`isVideo = player.type==='video' || renderAs==='video'`. La UI la decide `view.type` del player config
(`video`/`audio`/`radio`/`compact`). Estos son documentos y campos distintos: no confundir `player.type`
(content) con `view.type` (player).

## Reglas de DRM, ads y subtítulos

**BR-PLAT-006** — DRM se activa si hay video + (drm.enabled o sub-config con serverURL) + (hls o mpd)
Cuando se activa el path DRM: `src` se pone `null`, se construye `drm._candidateUrls` con las URLs HLS/MPD
decoradas, y `hlsVariant` se fuerza a `normal` (la variante `light` de hls.js no soporta DRM). La elección
final HLS vs DASH la hace el plugin DRM vía `getDRMSupport`, no `loadConfig`.

**BR-PLAT-007** — `adsMap` del backend se normaliza a `ads.map`
La clave `adsMap` (VMAP) entregada por la plataforma se reescribe a `ads.map` en el config final y la clave
original se elimina. El ads-manager consume `ads.map`, nunca `adsMap`.

**BR-PLAT-008** — Google DAI tiene precedencia sobre MediaTailor y desactiva preload/subtítulos
`ad_insertion_google.enabled` con `asset_key`/`asset_key_dash`/`source_id` produce `ads.googleDAI`,
fuerza `preloadEnabled=false` y `liveMaxLatencyDurationEnabled=false`, y **elimina** `subtitles` del media
(DAI inyecta los suyos; solo VTT, no ASS). `ad_insertion` (MediaTailor) solo se activa si **no** hay googleDAI.

**BR-PLAT-009** — DAI no aplica en DVR real (start + end con type='dvr')
Cuando se solicita un rango DVR explícito (`start && end && type==='dvr'`), la lógica DAI se salta para no
romper el rango; `mediaTailorDAI` no pone `src=null` en ese caso (`skipDAIForRealDVR`).

## Reglas de transporte y seguridad

**BR-PLAT-010** — el content config se pide con credenciales (cookies)
`GET(requestPath, { withCredentials: true })`. Las cookies de sesión (federación, customer, resume) viajan
con la request. Esto impone el contrato CORS de **BR-PLAT-IND-001**.

**BR-PLAT-011** — el embedHost depende del ambiente
Default `develop.mdstrm.com`; override por `EMBED_HOST`; prod `embed.mdstrm.com`. La URL completa es
`{protocol}://{embedHost}/...`. Cambiar el ambiente cambia el dominio interceptado por los tests.

**BR-PLAT-012** — fallo de resolución es siempre fatal y se propaga como evento `error`
Cualquier error de red, 4xx/5xx o body inválido produce `PlayerInitError(..., fatal=true)`, capturado por
`api.js` y reemitido como evento público `error` con `{ fatal: true, message, data, status, metadata }`.
No hay fallback de contenido ni reintento automático.

## Reglas de la industria aplicables

**BR-PLAT-IND-001** — CORS con credenciales prohíbe wildcard origin
(Fuente: MDN / WorkOS CORS guide, videojs#7232, shaka#2227.) Como el config se pide con `withCredentials`,
el servidor debe responder `Access-Control-Allow-Origin: <origin exacto>` + `Access-Control-Allow-Credentials: true`
y agregar `Vary: Origin` para evitar cache poisoning en CDN. Un `Access-Control-Allow-Origin: *` rompe el fetch.

**BR-PLAT-IND-002** — config delivery debe validar schema antes de consumir
(Fuente: Mux / Bitmovin / JW Player API design.) Un `200 OK` no garantiza un body válido; tras proxies/CDN un
200 puede traer HTML de error. La práctica de industria es validar el schema (presencia de `src`) antes de
construir URLs. El player actual no valida explícitamente — degrada con error críptico (PLAT-DEF-002).

**BR-PLAT-IND-003** — separar TTL de manifests vs config y purgar solo por cambio de derechos
(Fuente: Google Media CDN / FastPix caching.) Segments con TTL largo; playlists/config invalidados solo al
cambiar contenido o derechos. El player usa cache-busting por `_=timestamp`, que fuerza frescura pero no purga
edge caches; un cambio de DRM/geo puede servirse stale hasta expirar el TTL del CDN.

**BR-PLAT-IND-004** — distinguir 403 de acceso (token/geo) de error genérico
(Fuente: VdoCipher token-based URLs, Gumlet secure hosting.) El 403 por token expirado o geo-blocking debe
mostrar un mensaje accionable (`metadata.title`/`description`), no un error genérico. El player preserva
`data='ACCESS_DENIED'` y `metadata` para permitirlo; QA debe verificar que el integrador reciba esa info.

**BR-PLAT-IND-005** — toda request de red de bootstrap debe tener timeout
(Fuente: práctica general de resiliencia OTT.) Un endpoint colgado no debe bloquear el init indefinidamente.
El player actual no configura timeout en axios (PLAT-DEF-001) — recomendación de industria no cumplida.
