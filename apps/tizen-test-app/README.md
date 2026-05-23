# Lightning QA — Samsung Tizen TV App

App web empaquetada como `.wgt` para deploy en Samsung Smart TV (Tizen 8.0+).
Expone `window.__qa` con el mismo contrato que el harness desktop y webOS,
permitiendo que los tests WebdriverIO/Appium lean el estado del player y envíen
teclas del control remoto.

## Setup inicial (una sola vez)

### 1. Tizen Studio

Descargar desde [developer.tizen.org](https://developer.tizen.org/development/tizen-studio/download).

Agregar a PATH:
```bash
export TIZEN_HOME=/ruta/a/tizen-studio
export PATH=$PATH:$TIZEN_HOME/tools:$TIZEN_HOME/tools/ide/bin
```

### 2. Certificado

Tizen Studio → Certificate Manager → Add → **Tizen certificate** (no Samsung).
Guardar el nombre del perfil en `.env` como `TIZEN_CERT_PROFILE`.

### 3. Developer Mode en el TV

1. SmartHub → Apps
2. Presionar **1-2-3-4-5** con el control remoto en la pantalla de Apps
3. Activar Developer Mode → registrar la IP de esta máquina como "Developer IP"
4. Reiniciar el TV

### 4. Conectar via sdb

```bash
sdb connect <IP_DEL_TV>
sdb devices   # debe mostrar el TV como "device"
```

### 5. Instalar dependencias Appium

```bash
npm install
npm run tizen:setup     # instala appium-tizen-tv-driver
```

### 6. Deploy de la app

```bash
npm run deploy:tizen    # package + install + launch + port forward
```

### 7. Emparejar control remoto (obtener RC token)

```bash
npm run deploy:tizen:launch   # asegurar que la app está corriendo
npm run tizen:pair            # aparece popup en el TV — aceptar
```

Guardar el token mostrado en `.env` como `TIZEN_RC_TOKEN`.

### 8. Chromedriver

Para `rcMode: 'js'` (necesario para `executeScript`):

```bash
# Ver versión de Chromium del TV
sdb shell cat /etc/issue

# Descargar chromedriver matching desde:
# https://googlechromelabs.github.io/chrome-for-testing/
# Guardar ruta en .env como TIZEN_CHROMEDRIVER_PATH
```

## Uso diario

```bash
# Iniciar app en el TV (si ya está instalada)
npm run deploy:tizen:launch

# Correr todos los tests Tizen
npm run test:tizen

# Correr solo smoke tests
npm run test:tizen -- --mochaOpts.grep "@tv-tizen-smoke"
```

## Diferencias vs webOS

| Aspecto | webOS | Tizen |
|---|---|---|
| Evento de launch | `webOSLaunch` | `appcontrol` |
| BACK keyCode | 461 | 10009 |
| PLAY_PAUSE keyCode | 503 | 10252 |
| Key registration | No necesaria | `tizen.tvinputdevice.registerKeyBatch()` |
| Framework de tests | Playwright + CDP | WebdriverIO + Appium |
| Key injection | `page.evaluate(__qa.dispatchKey)` | `driver.executeScript('tizen: pressKey', ...)` |

## Archivos

```
apps/tizen-test-app/
├── config.xml       ← metadata (equivalente a appinfo.json en webOS)
├── index.html       ← entry point con listener appcontrol
├── qa-harness.js    ← window.__qa + TIZEN_KEYS + registerKeyBatch
├── debug-overlay.js ← overlay visual en pantalla
└── icon.png         ← copiar desde apps/webos-test-app/icon.png si no existe
                        (el deploy script lo copia automáticamente)
```
