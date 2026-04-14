# /create-webos-app — Crear app de test para LG webOS TV

Eres el creador de apps webOS para el proyecto `lightning-player-qa`.
Tu trabajo es generar una app web empaquetable para LG webOS que cargue el
Lightning Player y exponga la infraestructura de QA (`window.__qa`) para que
Playwright pueda conectarse via CDP y correr los tests TV marcados como `fixme`.

## Qué genera esta skill

```
apps/webos-test-app/
├── appinfo.json          ← Metadata de la app (inspectable: true)
├── index.html            ← Entry point — carga el player + harness QA
├── qa-harness.js         ← window.__qa, key mapping, event bridge
├── debug-overlay.js      ← Overlay visual en pantalla (estado del player)
├── icon.png              ← Placeholder 80x80 (PNG negro)
├── largeIcon.png         ← Placeholder 130x130 (PNG negro)
└── README.md             ← Instrucciones de deploy
```

Y los archivos de infraestructura:

```
scripts/
├── deploy-webos.sh       ← Setup SSH + package + install + launch
└── connect-webos-cdp.js  ← Helper para que Playwright se conecte via CDP

playwright.tv.config.ts   ← Config de Playwright para el TV
```

## Keycodes del control remoto webOS 4.x

Usar EXACTAMENTE estos valores — confirmados en hardware real:

```javascript
const WEBOS_KEYS = {
  // Navegación
  OK:           13,
  BACK:         461,
  UP:           38,
  DOWN:         40,
  LEFT:         37,
  RIGHT:        39,
  // Media
  PLAY:         415,
  PAUSE:        19,
  PLAY_PAUSE:   503,
  STOP:         413,
  REWIND:       412,
  FAST_FORWARD: 417,
  // Colores
  RED:          403,
  GREEN:        404,
  YELLOW:       405,
  BLUE:         406,
  // Números (ASCII estándar)
  N0: 48, N1: 49, N2: 50, N3: 51, N4: 52,
  N5: 53, N6: 54, N7: 55, N8: 56, N9: 57,
}
```

## Estructura de appinfo.json

```json
{
  "id": "com.mediastream.lightningqa",
  "version": "1.0.0",
  "vendor": "Mediastream",
  "type": "web",
  "main": "index.html",
  "title": "Lightning QA",
  "icon": "icon.png",
  "largeIcon": "largeIcon.png",
  "inspectable": true
}
```

## Qué debe hacer index.html

1. Cargar el player script desde CDN (`https://player.cdn.mdstrm.com/lightning_player/develop/api.js`)
2. Inicializar `window.__qa` con el mismo contrato que usa el harness desktop:
   - `window.__qa.events` — array de eventos recibidos
   - `window.__qa.status` — estado actual del player
   - `window.__qa.currentTime` — posición actual
3. Llamar a `loadMSPlayer()` con los parámetros recibidos via `webOSLaunch` o defaults
4. Registrar todos los eventos del player via `window.addEventListener('message', ...)`
   interceptando mensajes con prefijo `msp:`
5. Mostrar el debug overlay en pantalla

## Qué debe hacer qa-harness.js

- Exponer `window.__qa` con el mismo contrato que `fixtures/player.ts` espera
- Escuchar todos los eventos `msp:*` y acumularlos en `window.__qa.events`
- Mapear keyCodes de webOS a nombres legibles para logging
- Exponer `window.__qa.dispatchKey(keyCode)` para que Playwright inyecte teclas

## Qué debe hacer deploy-webos.sh

```bash
# Pasos en orden:
# 1. Descargar clave SSH fresca del TV
curl http://192.168.0.28:9991/webos_rsa -o ~/.ssh/lg1_webos_raw
# 2. Descifrar (passphrase: ver .env → WEBOS_KEY_PASSPHRASE)
openssl rsa -in ~/.ssh/lg1_webos_raw -out ~/.ssh/lg1_webos -passin pass:$WEBOS_KEY_PASSPHRASE
chmod 600 ~/.ssh/lg1_webos
# 3. Empaquetar la app (--no-minify para CDP)
ares-package --no-minify ./apps/webos-test-app
# 4. Instalar en el TV
ares-install --device lg1 com.mediastream.lightningqa_1.0.0_all.ipk
# 5. Lanzar
ares-launch --device lg1 com.mediastream.lightningqa
# 6. Abrir tunnel CDP (puerto 9998 del TV → 9222 local)
ssh -i ~/.ssh/lg1_webos -p 9922 -L 9222:localhost:9998 prisoner@192.168.0.28 -N &
echo "CDP disponible en localhost:9222"
```

## Qué debe hacer playwright.tv.config.ts

- Definir un proyecto `webos-tv` que use `chromium` con `connectOptions`
- Conectarse via CDP al tunnel local (`http://localhost:9222`)
- Timeout extendido (TV es más lento que desktop)
- Solo correr tests con tag `@tv-hardware`
- Usar los mismos fixtures que `playwright.config.ts`

## Variables de entorno necesarias (agregar a .env.example)

```bash
WEBOS_DEVICE_IP=192.168.0.28
WEBOS_SSH_PORT=9922
WEBOS_KEY_SERVER_PORT=9991
WEBOS_KEY_PASSPHRASE=        # passphrase para descifrar la clave RSA del TV
WEBOS_APP_ID=com.mediastream.lightningqa
WEBOS_CDP_PORT=9998          # puerto CDP en el TV
WEBOS_LOCAL_CDP_PORT=9222    # puerto local del tunnel SSH
```

## Cómo proceder

1. Leer `fixtures/player.ts` para entender el contrato exacto de `window.__qa`
2. Leer `fixtures/index.ts` para entender cómo se exportan los fixtures
3. Leer `playwright.config.ts` para entender la estructura de proyectos
4. Leer `.env.example` para agregar las variables sin romper las existentes
5. Generar todos los archivos listados arriba
6. NO modificar tests existentes ni `playwright.config.ts` — solo agregar `playwright.tv.config.ts`
7. Los tests `fixme` existentes NO se tocan — se activan via tag `@tv-hardware` en el nuevo config

## Convenciones del proyecto

- Los archivos de la app van en `apps/webos-test-app/` (crear directorio)
- Los scripts van en `scripts/` (ya existe)
- El config de Playwright TV va en la raíz junto a `playwright.config.ts`
- Seguir el mismo estilo TypeScript del proyecto (sin semicolons en algunos archivos, revisar)

ARGUMENTS:
