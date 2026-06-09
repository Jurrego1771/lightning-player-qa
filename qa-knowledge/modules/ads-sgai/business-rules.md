# ads-sgai — Business Rules

## Reglas de configuración

**BR-SGAI-001** — networkCode y customAssetKey son obligatorios para activar SGAI

Sin ambos valores (`ctx.ads.sgai.networkCode` y `ctx.ads.sgai.customAssetKey`), el hook
`useGoogleSGAILifecycle` retorna inmediatamente sin inicializar nada. El stream de contenido
reproduce normalmente, sin overlay de anuncios, sin errores. Esta es una política explícita
del código: SGAI es opt-in y su ausencia no debe afectar el playback.

**BR-SGAI-002** — SGAI solo funciona con streams HLS procesados por hls.js

El módulo depende de la API de pLoader de hls.js y del evento FRAG_CHANGED. Streams DASH,
streams HLS reproducidos con HLS nativo (sin hls.js), o cualquier otro formato de stream
no son soportados. SGAI queda inactivo en esos casos.

**BR-SGAI-003** — adBreakIdEndpoint es opcional; si ausente, se usa el endpoint de plataforma por defecto

Si `ctx.ads.sgai.adBreakIdEndpoint` no está configurado, `AdBreakService` construye la URL:
`{protocol}://{embedHost}/api/live-stream/{contentId}/sgai-ad-break`. El embedHost varía
por ambiente (develop.mdstrm.com, embed.mdstrm.com). Si se provee `adBreakIdEndpoint`,
se usa esa URL en su lugar, añadiendo `currentTime` y `cust_params` como query params.

---

## Reglas de señalización en el manifiesto

**BR-SGAI-004** — El player usa EXT-X-CUE-OUT, NO EXT-X-DATERANGE para señalización de ad breaks

Los encoders en producción (AWS Elemental) generan `#EXT-X-CUE-OUT:Duration=N` y
`#EXT-OATCLS-SCTE35:...`. El player parsea estos tags vía custom pLoader. Manifests que
solo contengan `#EXT-X-DATERANGE` no activarán SGAI en este player (hls.js parsea
EXT-X-DATERANGE nativamente pero el SGAI plugin no lo consume).

**BR-SGAI-005** — Cada EXT-X-CUE-OUT debe estar inmediatamente antes del segmento trigger

`ManifestParser` asocia cada cue point con el segmento de media que sigue inmediatamente.
Ese segmento es el "trigger" del ad break — cuando hls.js carga ese fragmento, se evalúa
si el ad pod está listo. Un CUE-OUT sin segmento siguiente en el manifest se ignora.

**BR-SGAI-006** — La deduplicación de cues usa scte35 como ID primario, segmentName como fallback

Si el manifest incluye `#EXT-OATCLS-SCTE35` o `#EXT-X-SCTE35`, ese valor se usa como
`cueId` para deduplicación. Si no hay SCTE-35, el nombre del segmento (sin path ni query)
es el cueId. En streams donde los segmentos no tienen nombres únicos (sin datetime en el
nombre), la deduplicación puede fallar.

---

## Reglas del lifecycle del ad break

**BR-SGAI-007** — El stream de contenido NO se interrumpe durante un ad break SGAI

A diferencia de CSAI (que pausa el stream) o SSAI (que reemplaza segmentos), SGAI superpone
un segundo `<video>` con el pod de anuncios. El HLS del programa continúa descargando y
buffering durante el ad. `player.status` puede reportar `'playing'` durante el ad break.

**BR-SGAI-008** — La ventana de gracia es de 1200ms; si el ad pod no está listo, el break se skipea

Desde que el fragmento trigger es detectado en FRAG_CHANGED, hay 1200ms para que:
1. `AdBreakService.fetchAdBreakId()` responda con el adBreakId
2. El ad pod sea precargado (`AdPlaybackController.preload()`)

Si alguno de estos pasos no completa dentro de 1200ms, el ad break se cancela silenciosamente.
El contenido continúa reproduciendo normalmente. Esta es una política content-first explícita.

**BR-SGAI-009** — El ad break se skipea si el fragmento trigger ya pasó (seek post-trigger)

Si el usuario hace seek y el `currentFragmentName` ya no coincide con el `segmentName` del
cue pendiente cuando se evalúa `#attemptPendingCuePlayback()`, el ad break se cancela.
Esto previene que ad breaks "viejos" se reproduzcan después de un seek.

**BR-SGAI-010** — lbanner usa lógica de cierre especial basada en eventos del SDK, no en video.ended

Para pods con formato `lbanner`, el cierre del ad break NO se dispara cuando el `<video>`
element emite `ended`. En cambio, se espera que todos los creativos del pod completen
(contando eventos `AD_BREAK_ENDED` del SDK hasta `sgaiPodCreativeTotal`). Si `sgaiPodCreativeTotal`
no está disponible, el break cierra en el primer `AD_BREAK_ENDED`.

---

## Reglas de audio y volume

**BR-SGAI-011** — El audio del contenido se gestiona por formato durante el ad break

El comportamiento del audio depende del formato:
- `fullscreen`: El stream de contenido se mutea; el audio del ad es el principal.
- `pip` / `sidebyside`: El audio del contenido puede continuar a volumen reducido.
- `lbanner`: El audio del contenido continúa; el ad puede tener audio adicional.

Al terminar el ad break, el audio del contenido se restaura exactamente al nivel previo
al break (`restoreSgaiAdAudio()`).

**BR-SGAI-012** — vpmute se sincroniza con el mute state del player vía internalEmitter

Cada vez que el usuario muta o desmuta el player, `Events._volumechange` dispara
`onVolumeChange(volume)` que llama `sgaiService.updateMuteState(isMuted)`. Esto asegura
que el ad server recibe el parámetro `vpmute` correcto para targeting de anuncios en
entornos silenciados (smart TVs, autoplays con muted).

---

## Reglas de compatibilidad y seguridad

**BR-SGAI-013** — Dispositivos sin soporte de dual-video no reciben ads SGAI (política content-first)

Antes de precargar el ad pod, `SGAIService` ejecuta un probe pasivo:
- `window.MediaCapabilities` debe existir
- `HTMLVideoElement.prototype.requestVideoFrameCallback` debe existir
- `navigator.hardwareConcurrency >= 2`

Si alguna condición falla, la sesión se marca como `UNSUPPORTED` y los ad breaks se skipean
silenciosamente. El contenido reproduce sin ads. Esta política es deliberada para proteger
la experiencia en TVs embebidas y dispositivos de baja potencia.

**BR-SGAI-014** — El streamId es único por sesión de cliente y no debe compartirse entre instancias

Google IMA DAI genera un `streamId` único por `PodStreamRequest`. Este ID identifica al
viewer para targeting individual y tracking de impresiones. No debe ser hardcodeado ni
reutilizado entre sesiones o instancias del player.

---

## Reglas de la industria aplicables

**BR-SGAI-IND-001** — SGAI requiere IDR frames en los puntos de cue para transición sin glitch

La especificación SCTE-35 y las guías de Google DAI requieren que el encoder genere un
IDR (Instantaneous Decoder Refresh) frame exactamente en el punto donde ocurre el
CUE-OUT. Sin IDR frame, la transición al ad puede mostrar artifacts de video. QA debe
verificar que el fixture HLS del mock server tiene IDR frames en los segmentos trigger.

**BR-SGAI-IND-002** — Los ad markers deben tener duración declarada en streams live

En streams HLS live, `#EXT-X-CUE-OUT` debe incluir `Duration=N`. Sin duración, el ad
server no puede estimar `pd` (pod duration en ms) para construir la URL del pod. El player
usa `cue.duration` como fallback para `pd`, por lo que una duración de 0 o undefined
resultará en un pod de 30s (default hardcodeado en `#buildAdPodUrl()`).

**BR-SGAI-IND-003** — SGAI es más resistente a ad blockers que CSAI pero requiere CDN de Google accesible

A diferencia de CSAI (donde el VAST tag es el punto de bloqueo), SGAI requiere que el CDN
`imasdk.googleapis.com` no esté bloqueado para cargar el SDK IMA DAI. Los ad blockers
más avanzados (uBlock Origin, Pi-hole) incluyen este dominio en sus listas. El player
degrada gracefully (content sin ads) cuando el SDK no carga.
