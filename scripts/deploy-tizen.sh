#!/usr/bin/env bash
# deploy-tizen.sh — Deploy automatizado de la app QA al Samsung Tizen TV
#
# Flujo completo:
#   1. Verifica conexión sdb al TV
#   2. Copia icon.png desde webos-test-app si no existe
#   3. Empaqueta la app con `tizen package` → genera .wgt
#   4. Instala la app en el TV via `tizen install`
#   5. Lanza la app via `tizen run`
#   6. [Opcional] Abre port forward sdb: puerto CDP del TV → localhost
#
# Uso:
#   bash scripts/deploy-tizen.sh                    → deploy + launch
#   bash scripts/deploy-tizen.sh --no-forward       → deploy + launch (sin port forward)
#   bash scripts/deploy-tizen.sh --launch-only      → solo lanzar (sin reinstalar)
#   bash scripts/deploy-tizen.sh --forward-only     → solo abrir port forward CDP
#   bash scripts/deploy-tizen.sh --pair             → emparejar control remoto (una vez)
#   bash scripts/deploy-tizen.sh --close            → cerrar la app en el TV
#
# Requiere:
#   - Tizen Studio instalado con tizen y sdb en PATH
#     (export PATH=$PATH:$TIZEN_HOME/tools:$TIZEN_HOME/tools/ide/bin)
#   - TIZEN_CERT_PROFILE en .env (nombre del perfil en Certificate Manager)
#   - TV en Developer Mode con Developer IP registrada (la IP de esta máquina)
#   - sdb conectado: sdb connect <TV_IP>
#
# Setup inicial (una sola vez):
#   1. Habilitar Developer Mode en el TV:
#      SmartHub → Apps → Settings (botón abajo) → presionar 1-2-3-4-5 en el control
#   2. Registrar la IP de esta máquina en "Developer IP" del TV
#   3. sdb connect <TV_IP>
#   4. Crear certificado en Tizen Studio → Certificate Manager → Tizen certificate
#   5. bash scripts/deploy-tizen.sh --pair   → aceptar en el TV → guardar token en .env

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"
APP_DIR="$REPO_ROOT/apps/tizen-test-app"
WEBOS_APP_DIR="$REPO_ROOT/apps/webos-test-app"

# ── Cargar .env ───────────────────────────────────────────────────────────────

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

# ── Configuración (defaults + .env) ───────────────────────────────────────────

DEVICE_IP="${TIZEN_DEVICE_IP:-}"
DEVICE_NAME="${TIZEN_DEVICE_NAME:-samsung1}"
APP_ID="${TIZEN_APP_ID:-com.mediastream.lightningqa}"
CERT_PROFILE="${TIZEN_CERT_PROFILE:-}"
TV_CDP_PORT="${TIZEN_CDP_PORT:-9222}"
LOCAL_CDP_PORT="${TIZEN_LOCAL_CDP_PORT:-9223}"

# ── Opciones de línea de comandos ─────────────────────────────────────────────

MODE="full"
case "${1:-}" in
  --no-forward)   MODE="deploy-only"   ;;
  --launch-only)  MODE="launch-only"   ;;
  --forward-only) MODE="forward-only"  ;;
  --pair)         MODE="pair"          ;;
  --close)        MODE="close"         ;;
esac

log()  { echo "  $*" >&2; }
err()  { echo "ERROR: $*" >&2; exit 1; }
ok()   { echo "  ✅ $*" >&2; }
info() { echo "  ℹ  $*" >&2; }

# ── Verificar requisitos ──────────────────────────────────────────────────────

for cmd in sdb tizen; do
  if ! command -v "$cmd" &>/dev/null; then
    err "Comando '$cmd' no encontrado. Verificar instalación de Tizen Studio y PATH:
    export TIZEN_HOME=/ruta/a/tizen-studio
    export PATH=\$PATH:\$TIZEN_HOME/tools:\$TIZEN_HOME/tools/ide/bin"
  fi
done

if [[ -z "$DEVICE_IP" ]]; then
  err "TIZEN_DEVICE_IP no configurado en .env"
fi

if [[ "$MODE" != "pair" && "$MODE" != "forward-only" && -z "$CERT_PROFILE" ]]; then
  err "TIZEN_CERT_PROFILE no configurado en .env.
  Crear en Tizen Studio → Certificate Manager → Add → Tizen certificate"
fi

# ── Función: conectar al TV ───────────────────────────────────────────────────

connect_device() {
  log "Conectando a $DEVICE_IP via sdb..."

  sdb connect "$DEVICE_IP" >&2 || true

  sleep 1

  if ! sdb devices 2>/dev/null | grep -q "$DEVICE_IP"; then
    err "No se pudo conectar al TV ($DEVICE_IP). Verificar:
    - TV encendido y en Developer Mode
    - IP de esta máquina registrada como 'Developer IP' en el TV
    - Firewall no bloqueando puerto 26101"
  fi

  ok "TV conectado: $DEVICE_IP"
}

# ── Función: empaquetar la app ────────────────────────────────────────────────

package_app() {
  log "Verificando icon.png..."

  # Copiar icon desde webos-test-app si no existe
  if [[ ! -f "$APP_DIR/icon.png" ]]; then
    if [[ -f "$WEBOS_APP_DIR/icon.png" ]]; then
      cp "$WEBOS_APP_DIR/icon.png" "$APP_DIR/icon.png"
      ok "icon.png copiado desde webos-test-app"
    else
      err "icon.png no encontrado. Crear un PNG 86x86 en apps/tizen-test-app/icon.png"
    fi
  fi

  log "Empaquetando la app (tizen package)..."
  cd "$REPO_ROOT"

  # Limpiar WGT anterior
  rm -f "${APP_ID}"*.wgt

  tizen package -t wgt -s "$CERT_PROFILE" -- "$APP_DIR" >&2 \
    || err "Error en tizen package. Verificar config.xml y el perfil de certificado '$CERT_PROFILE'"

  WGT_FILE=$(ls "${APP_ID}"*.wgt 2>/dev/null | head -1)
  if [[ -z "$WGT_FILE" ]]; then
    err "No se generó el archivo .wgt. Revisar output de tizen package."
  fi

  ok "App empaquetada → $WGT_FILE"
  echo "$WGT_FILE"
}

# ── Función: instalar en el TV ────────────────────────────────────────────────

install_app() {
  local wgt="$1"
  log "Instalando $wgt en el TV ($DEVICE_NAME)..."

  tizen install -t "$DEVICE_NAME" -n "$wgt" -- "$REPO_ROOT" \
    || err "Error en tizen install. Verificar que el TV acepte la app (certificado + Developer Mode)"

  ok "App instalada correctamente"
}

# ── Función: lanzar la app ────────────────────────────────────────────────────

launch_app() {
  log "Lanzando $APP_ID en el TV ($DEVICE_NAME)..."

  tizen run -p "$APP_ID" -t "$DEVICE_NAME" \
    || err "Error en tizen run."

  ok "App lanzada"
}

# ── Función: port forward CDP ─────────────────────────────────────────────────
# Permite conectar Web Inspector (chrome://inspect) o Chromedriver al TV.
# No es necesario para tests Appium (el driver lo maneja internamente via sdb).
# Útil para debugging manual via DevTools.

open_forward() {
  log "Abriendo port forward CDP: localhost:$LOCAL_CDP_PORT → TV:$TV_CDP_PORT"
  info "Cerrar con: sdb -s $DEVICE_IP:26101 forward --remove tcp:$LOCAL_CDP_PORT"

  sdb -s "$DEVICE_IP:26101" forward "tcp:$LOCAL_CDP_PORT" "tcp:$TV_CDP_PORT" \
    || err "Error abriendo port forward. Verificar que la app esté corriendo en el TV."

  ok "Port forward activo: localhost:$LOCAL_CDP_PORT → TV"
  info "Conectar en Chrome: chrome://inspect → Configure → localhost:$LOCAL_CDP_PORT"
}

# ── Función: emparejar control remoto (una sola vez) ──────────────────────────
# Necesario para obtener el TIZEN_RC_TOKEN que usan los tests Appium.
# Se muestra un popup en el TV — aceptar con el control remoto.

pair_remote() {
  if ! command -v appium &>/dev/null; then
    err "appium no encontrado. Instalar: npm install -g appium"
  fi

  log "Iniciando emparejamiento del control remoto..."
  info "Aparecerá un popup en el TV — aceptar con el control remoto"
  echo ""

  appium driver run tizentv pair-remote --host "$DEVICE_IP" \
    || err "Error en pair-remote. Verificar que la app esté corriendo en el TV."

  echo ""
  ok "Emparejamiento completado. Guardar el token mostrado en .env como TIZEN_RC_TOKEN"
}

# ── Función: cerrar la app ────────────────────────────────────────────────────

close_app() {
  log "Cerrando $APP_ID en el TV ($DEVICE_NAME)..."

  tizen run -p "$APP_ID" -t "$DEVICE_NAME" --stop \
    || log "La app ya no estaba corriendo (ok)"

  ok "App cerrada"
}

# ── Ejecución según modo ──────────────────────────────────────────────────────

echo ""
echo "  🎯 deploy-tizen.sh — modo: $MODE"
echo "  📺 TV: ${DEVICE_IP:-?} | Device: $DEVICE_NAME | App: $APP_ID"
echo ""

case "$MODE" in

  full)
    connect_device
    WGT=$(package_app)
    install_app "$WGT"
    sleep 2
    launch_app
    sleep 3
    open_forward
    ;;

  deploy-only)
    connect_device
    WGT=$(package_app)
    install_app "$WGT"
    launch_app
    ;;

  launch-only)
    connect_device
    launch_app
    sleep 3
    open_forward
    ;;

  forward-only)
    connect_device
    open_forward
    ;;

  pair)
    connect_device
    pair_remote
    ;;

  close)
    connect_device
    close_app
    ;;

esac

echo ""
echo "  ✅ deploy-tizen.sh completado"
echo ""
