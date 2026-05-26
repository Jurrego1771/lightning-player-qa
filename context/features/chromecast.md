# Chromecast

Feature: reproducción remota vía Google Cast (Chromecast).

---

## Descripción

El player incluye soporte sender-side para Google Cast. Permite al usuario enviar la reproducción a un dispositivo Chromecast en la misma red local. La implementación usa el Cast Web SDK (sender) y depende de la presencia física de un dispositivo Cast o el Cast Simulator.

---

## Archivos del player (src/)

- `src/chromecast/` — módulo Cast: inicialización del SDK, gestión de sesión, MediaBuilder.
- `src/context/index.jsx` — atoms Jotai: `castStateAtom`, `castAvailableAtom`.
- `src/controls/` — controls-api: expone el botón/estado de Cast.
- `src/api/api.js` — expone `player.cast` si el módulo está habilitado.

---

## API pública expuesta

```typescript
// Estado del Cast
player.cast: {
  available: boolean,          // true si hay dispositivos Cast en la red
  connected: boolean,          // true si hay sesión Cast activa
  connect(): Promise<void>,    // lanza el diálogo de selección de dispositivo
  disconnect(): void           // finaliza la sesión Cast
}

// Eventos
player.on('castStateChange', (state: CastState) => void)
// CastState: 'NO_DEVICES_AVAILABLE' | 'NOT_CONNECTED' | 'CONNECTING' | 'CONNECTED'
```

---

## Señales de observabilidad (eventos, estados)

| Señal | Tipo | Descripción |
|---|---|---|
| `castStateChange` | evento | El estado del Cast cambió |
| `player.cast.available` | propiedad | Hay dispositivos Cast detectados en la red |
| `player.cast.connected` | propiedad | Sesión Cast activa |

### Estados de castStateChange

```
NO_DEVICES_AVAILABLE   ← no hay dispositivos en la red
NOT_CONNECTED          ← hay dispositivos, no hay sesión activa
CONNECTING             ← conectando al dispositivo seleccionado
CONNECTED              ← sesión activa, reproducción en el dispositivo
```

---

## Tipos de contenido soportados

| Tipo | Cast | Notas |
|---|---|---|
| VOD HLS | Si | MediaBuilder construye el MediaInfo con URL del stream |
| VOD DASH | Si | Igual que HLS |
| Live HLS | Si | El receptor Cast maneja live |
| DRM | Limitado | Requiere receptor Cast personalizado con licencia DRM |

---

## Riesgos conocidos

- **Requiere dispositivo físico:** el Cast SDK solo funciona con un Chromecast real o Cast Simulator en la misma red. No hay emulador headless.
- **No testeable con Playwright:** Playwright (Chromium headless) no tiene acceso al Cast SDK de Google. El módulo Cast requiere Chrome real con el SDK activado.
- **Cast SDK load:** el SDK se carga dinámicamente desde `https://www.gstatic.com/cv/js/sender/v1/cast_sender.js`. En CI sin acceso a internet, el módulo Cast fallará al cargar pero de forma silenciosa (no bloquea el player).
- **Sesión Cast y estado local:** cuando el usuario está en modo Cast, el player local entra en estado "remoto". Los eventos de `timeupdate`, `playing`, etc. pueden no emitirse o emitirse con retraso respecto a la reproducción real en el dispositivo.

---

## Casos edge

- **Cast disponible pero no activado:** `player.cast.available = true` no significa que haya sesión. El botón Cast debe mostrarse para que el usuario pueda conectar.
- **Desconexión inesperada del dispositivo:** si el Chromecast se desconecta durante la reproducción (apagado, pérdida de red), `castStateChange` debe emitir `NOT_CONNECTED` y el player local debe reanudar la reproducción desde el punto actual.
- **Cambio de src durante Cast:** si se cambia `player.src` mientras hay sesión Cast activa, el nuevo src debe enviarse al receptor Cast. Comportamiento no garantizado en todos los receptores.
- **Volumen remoto vs local:** el volumen del Chromecast es independiente del volumen del player local. `player.volume` afecta al reproductor local pero puede no sincronizarse con el receptor Cast.
- **DRM en Cast:** para contenido DRM en Chromecast, el receptor Cast necesita implementar el manejo de licencias. Un receptor genérico no puede reproducir contenido Widevine. Se requiere receptor personalizado registrado en Google Cast Developer Console.

---

## Limitaciones para tests

**Tests automatizados con Playwright no pueden:**
- Detectar dispositivos Cast (sin SDK activo).
- Abrir el diálogo de selección de dispositivo.
- Simular una sesión Cast activa.
- Verificar reproducción en el dispositivo receptor.

**Lo que SÍ se puede testear:**
- Que `player.cast` existe y tiene la forma correcta (contract test).
- Que el evento `castStateChange` existe en la API del player.
- Que el botón Cast en la UI se renderiza cuando `cast.available = true` (mock del estado).
- Mock del Cast SDK para simular estados y verificar reacciones del player.
