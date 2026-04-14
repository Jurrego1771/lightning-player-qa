# Lightning QA — webOS TV App

App de test para LG webOS TV. Carga el Lightning Player y expone
`window.__qa` para que Playwright se conecte via CDP y ejecute los
tests TV marcados con `@tv-hardware`.

## Estructura

```
apps/webos-test-app/
├── appinfo.json      — Metadata (id, version, inspectable: true)
├── index.html        — Entry point: carga player + harness
├── qa-harness.js     — window.__qa, dispatchKey(), event tracking
├── debug-overlay.js  — HUD visual sobre el video (status, eventos, teclas)
├── icon.png          — Icono 80x80
└── largeIcon.png     — Icono 130x130
```

## Deploy rápido

```bash
# Agregar WEBOS_KEY_PASSPHRASE en .env primero

# Deploy completo + launch + tunnel CDP
bash scripts/deploy-webos.sh

# Solo lanzar (si la app ya está instalada)
bash scripts/deploy-webos.sh --launch-only

# Solo tunnel CDP (si la app ya está corriendo)
bash scripts/deploy-webos.sh --tunnel-only
```

## Correr tests TV

```bash
# Todos los tests @tv-hardware
npx playwright test --config=playwright.tv.config.ts

# Un spec específico
npx playwright test tests/e2e/tv-back-key-codes.spec.ts --config=playwright.tv.config.ts

# Con UI mode (debugging)
npx playwright test --config=playwright.tv.config.ts --ui
```

## Pasar parámetros a la app (ares-launch)

```bash
# Cargar un content ID específico
ares-launch --device lg1 com.mediastream.lightningqa \
  --params '{"type":"media","id":"69d2f1e0461dd502cd921ad6","autoplay":true}'

# Ambiente staging
ares-launch --device lg1 com.mediastream.lightningqa \
  --params '{"env":"staging","type":"media","id":"STAGING_ID","autoplay":true}'
```

## Keycodes del control remoto (webOS 4.x)

| Botón        | keyCode |
|--------------|---------|
| OK / Enter   | 13      |
| Back         | 461     |
| Arriba       | 38      |
| Abajo        | 40      |
| Izquierda    | 37      |
| Derecha      | 39      |
| Play         | 415     |
| Pause        | 19      |
| Play/Pause   | 503     |
| Stop         | 413     |
| Rewind       | 412     |
| FastForward  | 417     |
| Rojo         | 403     |
| Verde        | 404     |
| Amarillo     | 405     |
| Azul         | 406     |

## Inyectar teclas desde Playwright

```typescript
// En un test con @tv-hardware
await page.evaluate((keyCode) => window.__qa.dispatchKey(keyCode), 461) // Back
await page.evaluate((keyCode) => window.__qa.dispatchKey(keyCode), 39)  // ArrowRight
```

## Troubleshooting

**"No se pudo descargar la clave del Key Server"**
→ Verificar que el TV esté encendido, en Developer Mode, y en la misma red.
→ `curl http://192.168.0.28:9991/webos_rsa` debe responder.

**"Error descifrando la clave"**
→ La `WEBOS_KEY_PASSPHRASE` en `.env` es incorrecta. Reconectar Developer Mode.

**"isDate is not a function"**
→ Parche necesario en ares-cli para Node.js v24. Ver: scripts/deploy-webos.sh comentarios.
→ Solución: editar `node_modules/@webos-tools/cli/.../ssh2/lib/protocol/SFTP.js`:
   `const isDate = (d) => d instanceof Date;`

**CDP no responde en localhost:9222**
→ Verificar que el tunnel esté activo: `cat /tmp/webos-cdp-tunnel.pid`
→ Verificar que `inspectable: true` esté en appinfo.json.
→ Re-lanzar la app y abrir el tunnel: `bash scripts/deploy-webos.sh --launch-only`
