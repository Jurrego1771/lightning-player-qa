# AirPlay — Overview

## Qué hace

AirPlay permite al usuario enviar la reproducción de video/audio desde el player
(corriendo en Safari macOS/iOS) a un receptor AirPlay en la misma red local
(Apple TV, smart TVs con AirPlay 2, HomePod). El player:

- Detecta si la plataforma soporta AirPlay (capacidad WebKit).
- Detecta dinámicamente si hay un receptor AirPlay **disponible** en la red.
- Expone una API pública de solo lectura (`player.airplay`, `player.airplayAvailable`)
  y dispara eventos cuando cambia el estado de conexión.
- Renderiza un botón/indicador de AirPlay en el skin de video cuando hay un
  receptor disponible.
- Resuelve el conflicto conocido entre `hls.js` + `ManagedMediaSource` y AirPlay
  (Safari 17.1+), de modo que el handoff al dispositivo destino funcione.

A diferencia de Chromecast (que usa el Cast Application Framework, una sesión de
red controlada por la app web y un receiver propio), AirPlay es una capacidad
**nativa del sistema operativo Apple expuesta por WebKit**: el player no controla
el protocolo de transporte, solo invoca el picker nativo y observa eventos del
`<video>`. No hay "sender/receiver app" — el SO hace el handoff del elemento de
media completo.

## Archivos clave

### Player (SUT) — `D:\Dev\Repos\mediastream\lightning-player`

| Archivo | Rol |
|---------|-----|
| `src/airplay/AirPlayManager.js` | Núcleo. `EventEmitter` que adjunta listeners WebKit al `<video>`, traduce eventos nativos a `availabilityChange` / `connected` / `disconnected`, y expone `showPicker()`. |
| `src/airplay/isSupported.js` | `isAirPlaySupported()` — feature-detect de `HTMLVideoElement.prototype.webkitShowPlaybackTargetPicker`. Única fuente de verdad de soporte. |
| `src/airplay/constants.js` | Enum `AirPlayState` (`UNAVAILABLE` / `AVAILABLE` / `CONNECTED`). |
| `src/airplay/index.js` | Barrel export del módulo. |
| `src/view/video/atoms/airplay.js` | Capa de integración (Jotai). Instancia singleton del manager, conecta sus eventos al `internalEmitter`, expone la API pública vía `expose()`, y aplica el workaround del segundo `<source>` para ManagedMediaSource. |
| `src/view/video/components/airplay/AirPlayIndicator.jsx` | Indicador "AirPlay activo" (solo visible cuando `connected`). |
| `src/view/common/components/airplay/AirPlayIcon.jsx` | Icono SVG. |
| `src/player/handler/hls/handler.js` | Setea `preferManagedMediaSource: !isAirPlaySupported()` — desactiva MMS en dispositivos AirPlay-capaces (fix hls.js #6197). |
| `src/api/player.jsx` | Reporta `ext_pb: getAirPlayManager()?.isConnected ? 1 : 0` en analytics de playback. |
| `constants.cjs` (líneas 167-170) | Declara los eventos públicos `airPlayAvailabilityChange`, `airPlayConnected`, `airPlayDisconnected`. |

### QA (este repo)

| Archivo | Rol |
|---------|-----|
| `tests/integration/airplay.spec.ts` | Tests de superficie de API + disponibilidad WebKit + `test.fixme` para connect/disconnect en dispositivo real. |

## Flujo de datos

```
                       Safari/WebKit (macOS/iOS)  ── ÚNICO entorno soportado
                                  │
   isAirPlaySupported() ──true──► airPlayManagerAtomEffect
                                  │ (solo si view.airplay !== false)
                                  ▼
                       AirPlayManager.attach(<video>)
                                  │
            ┌─────────────────────┼──────────────────────────┐
            ▼                     ▼                           ▼
  el.disableRemotePlayback   addEventListener            (si MMS activo)
    = false  (workaround)    webkitplaybacktarget-       append 2º <source>
                             availabilitychanged          src = HLS .m3u8
                             webkitcurrentplayback-       type=x-mpegurl
                             targetiswirelesschanged
            │                     │                           │
            ▼                     ▼                           ▼
   WebKit reporta         availability='available'    Apple TV puede fetchear
   receptor disponible    ─► emit('availabilityChange')  la URL real al conectar
                                  │
                          airPlayAvailableInnerAtom = true
                                  │
                          ► botón/indicador visible
                                  │
            usuario toca botón ──► showAirPlayPickerAtom
                                  │
                          manager.showPicker()
                          el.webkitShowPlaybackTargetPicker()  (picker nativo del SO)
                                  │
            usuario elige Apple TV en el picker nativo
                                  │
            webkitCurrentPlaybackTargetIsWireless = true
                                  │
            ► emit('connected') ► internalEmitter.emit(_airPlayConnected)
            ► airPlayConnectedInnerAtom = true ► <AirPlayIndicator/> visible
            ► player.airplay getter = true
            ► analytics: ext_pb = 1
```

## API pública

Verificada en `src/view/video/atoms/airplay.js` y `constants.cjs`.

### Getters de solo lectura (expuestos vía `expose()`)
| Propiedad | Tipo | Significado |
|-----------|------|-------------|
| `player.airplay` | `boolean` | `true` si actualmente conectado a un receptor AirPlay. |
| `player.airplayAvailable` | `boolean` | `true` si hay un receptor AirPlay disponible en la red. |

Nota: ambos getters solo se registran si `isAirPlaySupported()` es `true`. En
Chrome/Firefox/plataformas no-WebKit, las propiedades **no existen** en la instancia
(no lanzan; devuelven `undefined` al leerse).

### Eventos públicos (`player.on(...)`) — `constants.cjs` 167-170
| Evento | Payload | Cuándo |
|--------|---------|--------|
| `airPlayAvailabilityChange` | — | DECLARADO en constants pero **NO se emite** en el código actual (ver defects APLY-DEF-001). El cambio de disponibilidad solo se refleja en el getter `airplayAvailable` y la UI. |
| `airPlayConnected` | (sin payload) | Al conectar a un receptor AirPlay (`webkitCurrentPlaybackTargetIsWireless` pasa a `true`). |
| `airPlayDisconnected` | (sin payload) | Al desconectar del receptor. |

### Config (context / setup)
| Clave | Valor | Efecto |
|-------|-------|--------|
| `view.airplay` | `false` / `'false'` / `0` / `'0'` | Desactiva AirPlay (el manager no se adjunta). Cualquier otro valor (incl. ausencia) lo deja habilitado. |

### Métodos internos del manager (NO API pública del player)
`AirPlayManager`: `attach(el)`, `detach()`, `destroy()`, `showPicker()`,
getters `isSupported` / `isAvailable` / `isConnected`. El usuario invoca el picker
a través del botón del skin, no por un método público documentado.

## Interacciones con otros sistemas

- **playback-core / handlers**: AirPlay opera sobre el `<video>` real. El `native.js`
  handler (Safari HLS nativo + FairPlay) y el `hls.js` handler comparten el mismo
  elemento. El estado de conexión se reporta a analytics (`ext_pb`).
- **hls (ManagedMediaSource)**: acoplamiento crítico. `preferManagedMediaSource:
  !isAirPlaySupported()` desactiva MMS en dispositivos AirPlay. Si MMS estuviera
  activo, el blob URL de MSE no es fetcheable por el Apple TV → handoff roto.
- **events / `internalEmitter`**: el atom traduce eventos del manager a
  `Events._airPlayConnected` / `_airPlayDisconnected` en el bus interno, que el
  `externalEmitter` reexporta como API pública.
- **DRM (FairPlay)**: contenido protegido con FairPlay sigue las restricciones de
  copia del SO al hacer handoff a AirPlay (el receptor debe poder reproducir el
  stream protegido). Fuera del scope directo del módulo pero relevante para QA.
- **Chromecast**: mutuamente excluyentes en la práctica (AirPlay solo en WebKit,
  Cast SDK solo en Chromium/Android). No comparten estado.
