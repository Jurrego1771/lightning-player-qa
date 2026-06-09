# Events — Overview

## Qué hace

El módulo `events` es la columna vertebral de comunicación del Lightning Player. Provee un sistema de pub/sub bidireccional con dos capas:

1. **Capa interna (`internalEmitter`)** — un EventEmitter (Node.js-style) que conecta todos los módulos del player entre sí. Solo es accesible desde el código del player, nunca desde el integrador.
2. **Capa externa (API pública: `player.on / off / once`)** — expone al integrador un subconjunto filtrado de eventos. Solo los eventos registrados en `Events.*` (constants.cjs) son aceptados; cualquier nombre inválido es descartado silenciosamente.

Además, todos los eventos públicos se propagan hacia afuera del iframe mediante `window.postMessage` con prefijo `msp:`, permitiendo que el host de la página escuche eventos del player sin acceder directamente a la instancia.

## Archivos clave

| Archivo | Rol |
|---------|-----|
| `constants.cjs → Events.*` | Catálogo completo de todos los eventos públicos (fuente de verdad) |
| `src/events/index.js` | Implementación del emitter: lógica de on/off/once, validación de eventos, propagación por postMessage |

## Flujo de datos

```
Módulo interno (ej: hls.js, ads-ima)
    │
    ▼
internalEmitter.emit(Events._playing, payload)
    │
    ├─► Handlers registrados con player.on('playing', fn)  ← integrador externo
    │
    └─► window.postMessage({ event: 'msp:playing', id: uniqueId }, location.origin)
             │
             └─► Otros iframes / host page que escuchan 'message'
                  (filtran por event.origin === location.origin y event.data.id !== propio)
```

**Flujo inverso (postMessage → player):**
```
Host page → window.postMessage({ event: 'msp:nextEpisodePlayNext' }, origin)
    │
    └─► ExternalEmitter recibe el mensaje, valida origen, emite internamente
         (Eventos msp: de la propia instancia se filtran para evitar loop)
```

**Regla anti-loop:** Si `disableMspEvents=true` en la config del player, los eventos se emiten solo internamente (sin postMessage). Esto se usa en escenarios donde el host gestiona el postMessage manualmente.

## API pública

### Métodos de suscripción

```js
// Registrar un listener (el handler se llama cada vez que el evento se emite)
player.on(eventName: string, handler: Function): void

// Registrar un listener de una sola ejecución (se auto-elimina tras el primer disparo)
player.once(eventName: string, handler: Function): void

// Eliminar un listener previamente registrado (requiere la misma referencia de función)
player.off(eventName: string, handler: Function): void
```

**Comportamiento de validación:** Tanto `on()` como `once()` validan que `eventName` esté en `Events.*`. Si no lo está, la llamada es un no-op silencioso (sin error, sin warning). Esto previene crashes si el integrador usa un nombre de evento con typo, pero también oculta errores de integración.

**`player.off()` requiere referencia exacta:** El mecanismo subyacente usa igualdad de referencia para identificar el handler. Una función anónima inline pasada a `on()` nunca puede ser eliminada con `off()` porque la referencia se pierde. Esto es una fuente clásica de memory leaks.

**No hay `unsubscribe` de retorno:** A diferencia del patrón moderno (ej: RxJS, Vue 3 `watch`), `player.on()` retorna `void`. El integrador debe guardar la referencia del handler para poder llamar `off()`.

### Catálogo completo de eventos públicos (Events.*)

**Ciclo de vida del player**
| Evento | Descripción |
|--------|-------------|
| `loaded` | Las dependencias necesarias han sido cargadas |
| `ready` | El player está listo para recibir comandos de API |
| `contentFirstPlay` | El contenido real empieza a reproducir por primera vez (no ads) |
| `sourcechange` | La fuente del stream cambió (ej: tras `load()`) |

**HTML5 Media Standard**
| Evento | Descripción |
|--------|-------------|
| `abort` | La carga del audio/video fue abortada |
| `canplay` | El browser puede iniciar reproducción |
| `canplaythrough` | Puede reproducir sin pausar por buffering |
| `durationchange` | La duración cambió |
| `emptied` | El playlist está vacío |
| `ended` | Reproducción terminó |
| `error` | Error durante la carga del media |
| `loadeddata` | Frame actual cargado |
| `loadedmetadata` | Metadatos del media cargados |
| `loadstart` | El browser empieza a buscar el audio/video |
| `pause` | El audio/video fue pausado |
| `play` | Reproducción iniciada o reanudada |
| `playing` | Reproducción activa (tras pausa o buffering) |
| `progress` | El browser descarga el audio/video |
| `ratechange` | La velocidad de reproducción cambió |
| `seeked` | El usuario terminó de moverse a una nueva posición |
| `seeking` | El usuario está moviendo la posición |
| `stalled` | Browser intentando obtener datos, no disponibles |
| `suspend` | Browser no obteniendo datos intencionalmente |
| `timeupdate` | Posición de reproducción cambió |
| `volumechange` | Volumen cambió |
| `waiting` | El video se detuvo por necesidad de buffering |

**Buffering / QoE**
| Evento | Descripción |
|--------|-------------|
| `buffering` | El player no tiene buffer y está solicitando datos |
| `programdatetime` | Un segmento informa el program date time |

**Metadatos**
| Evento | Descripción |
|--------|-------------|
| `metadata` | Metadatos desde cualquier fuente (ej: nowplaying) |
| `metadataloading` | Los metadatos están siendo cargados |
| `metadataloaded` | Los metadatos han sido cargados |
| `metadatachanged` | Los metadatos cambiaron |

**Calidad / ABR**
| Evento | Descripción |
|--------|-------------|
| `levelchange` | Se solicitó un cambio de calidad |
| `levelchanged` | El nivel de calidad cambió efectivamente |

**Subtítulos / Text Tracks**
| Evento | Descripción |
|--------|-------------|
| `texttrackchange` | La pista de texto activa cambió |
| `texttrackaddtrack` | Se añadió una pista de texto |
| `texttrackremovetrack` | Se eliminó una pista de texto |
| `subtitlechange` | El usuario cambió la pista de subtítulos (objeto TextTrack o null) |

**Audio Tracks**
| Evento | Descripción |
|--------|-------------|
| `audiotrackchange` | La pista de audio activa cambió |
| `audiotrackaddtrack` | Se añadió una pista de audio |
| `audiotrackremovetrack` | Se eliminó una pista de audio |

**Ads (IMA / DAI / SGAI)**
| Evento | Descripción |
|--------|-------------|
| `adsAdBreakReady` | Ad break listo |
| `adsAdMetadata` | Metadatos del anuncio |
| `adsAllAdsCompleted` | Todos los anuncios del ad break completados |
| `adsClick` | Click en el anuncio |
| `adsComplete` | Un anuncio completó su reproducción |
| `adsContentPauseRequested` | Solicitud de pausa del contenido (para anuncio lineal) |
| `adsContentResumeRequested` | Solicitud de reanudar el contenido |
| `adsDurationChange` | Duración del anuncio cambió |
| `adsFirstQuartile` | Primer cuartil del anuncio |
| `adsImpression` | Impresión del anuncio registrada |
| `adsLinearChanged` | Tipo lineal/no-lineal del anuncio cambió |
| `adsLoaded` | Anuncio cargado |
| `adsLog` | Log del sistema de anuncios |
| `adsMidpoint` | Punto medio del anuncio |
| `adsPaused` | Anuncio pausado |
| `adsResumed` | Anuncio reanudado |
| `adsSkippableStateChanged` | Estado de skipability cambió |
| `adsSkipped` | Anuncio saltado |
| `adsStarted` | Anuncio iniciado |
| `adsThirdQuartile` | Tercer cuartil del anuncio |
| `adsTimeUpdate` | Actualización de tiempo del anuncio |
| `adsUserClose` | Usuario cerró el anuncio |
| `adsVolumeChanged` | Volumen del anuncio cambió |
| `adsVolumeMuted` | Anuncio muteado |
| `adsError` | Error en el sistema de anuncios |
| `adsAdBuffering` | Anuncio en buffering |
| `adsAdCanPlay` | Anuncio puede reproducir |
| `adsAdProgress` | Progreso del anuncio |
| `adsExpandedChange` | Estado expandido del anuncio cambió |
| `adsInteraction` | Interacción con el anuncio |
| `adsViewableImpression` | Impresión visible del anuncio |
| `adsRequested` | Anuncio solicitado |
| `adsVideoClicked` | Video del anuncio clicado |
| `adsVideoIconClicked` | Ícono del video del anuncio clicado |

**Chromecast**
| Evento | Descripción |
|--------|-------------|
| `castStateChange` | Estado del cast cambió (NO_DEVICES / NOT_CONNECTED / CONNECTING / CONNECTED) |
| `castConnected` | Conectado a un dispositivo Chromecast |
| `castDisconnected` | Desconectado del dispositivo Chromecast |
| `castError` | Error de Chromecast |
| `castMediaLoaded` | Media cargada en el dispositivo cast |
| `castMediaEnded` | Media terminó en el dispositivo cast |
| `castTracksLoaded` | Pistas de texto cargadas en el dispositivo cast |
| `castActiveTracksChanged` | Pistas activas cambiaron en el dispositivo cast |

**AirPlay**
| Evento | Descripción |
|--------|-------------|
| `airPlayAvailabilityChange` | Disponibilidad de destinos AirPlay cambió |
| `airPlayConnected` | Conectado a un dispositivo AirPlay |
| `airPlayDisconnected` | Desconectado del dispositivo AirPlay |

**Picture-in-Picture / Fullscreen**
| Evento | Descripción |
|--------|-------------|
| `enterpictureinpicture` | El usuario entró al modo PiP |
| `leavepictureinpicture` | El usuario salió del modo PiP |
| `fullscreenchange` | El estado de pantalla completa cambió |

**UI / Controles**
| Evento | Descripción |
|--------|-------------|
| `dismissButton` | Click en el botón de cierre/volver (skin TV) |
| `share` | Click en el botón de compartir |
| `tabchange` | Cambio de tab en el menú lateral |
| `tabitemchange` | Item de tab seleccionado cambió |
| `tabitemschange` | Lista de items del tab cambió |
| `pip` | Estado PiP cambió |
| `fullscreenchange` | Estado fullscreen cambió |

**Next Episode**
| Evento | Descripción |
|--------|-------------|
| `nextEpisodeIncoming` | 5 segundos antes de que aparezca el UI de Next Episode |
| `nextEpisodeConfirmed` | El usuario confirmó el siguiente episodio (con datos custom) |
| `nextEpisodePlayNext` | Externo: carga el siguiente episodio inmediatamente |
| `nextEpisodeKeepWatching` | Externo: previene la carga automática al terminar el video |
| `nextEpisodeLoadRequested` | Se solicitó cargar el siguiente episodio (click o auto-load) |

**Playlist**
| Evento | Descripción |
|--------|-------------|
| `playlistchange` | El usuario añadió/removió un elemento del playlist |

**Interacciones**
| Evento | Descripción |
|--------|-------------|
| `quizAnswered` | El usuario respondió una pregunta de quiz |
| `reactionEmitted` | El usuario emitió una reacción |

**Analytics / Restricciones**
| Evento | Descripción |
|--------|-------------|
| `adblockerDetected` | Se detectó un bloqueador de anuncios |
| `restriction` | Restricción personalizada para analytics |
| `alert` | Alerta personalizada para analytics |

**Eventos Internos (NO públicos — no usar en tests)**

Los `InternalEvents.*` (`_ready`, `_adsLoaded`, `_playerLoaded`, `pluginsReady`, `controlsReady`, `_federationLoaded`, `_isCurrentMediaSession`) son exclusivamente para comunicación interna entre módulos del player. No son parte de la API pública y no deben usarse en tests QA.

## Interacciones con otros sistemas

El módulo `events` no tiene lógica de negocio propia — es pura infraestructura. Todos los demás módulos dependen de él:

- **playback-core, hls, dash** → emiten eventos HTML5 Media + buffering + QoE
- **ads-ima, ads-dai, ads-sgai** → emiten todos los eventos `ads*`
- **chromecast** → emite `cast*`
- **airplay** → emite `airPlay*`
- **controls-api** → emite `dismissButton`, `share`, `tab*`
- **subtitles** → emite `texttrack*`, `subtitlechange`
- **quality-selector** → emite `levelchange`, `levelchanged`
- **youbora, analytics-*** → consumen eventos vía `player.on()` para reportar métricas
- **embed (iframe)** → consume eventos vía `window.postMessage` (prefijo `msp:`)
