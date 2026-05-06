#!/usr/bin/env bash
# deploy-webos.sh — Deploy automatizado de la app QA al LG webOS TV
#
# Flujo completo:
#   1. Descarga clave SSH fresca del TV (Key Server puerto 9991)
#   2. Descifra la clave RSA (encriptada AES-128-CBC)
#   3. Empaqueta la app con --no-minify (necesario para CDP/Web Inspector)
#   4. Instala la app en el TV via ares-install
#   5. Lanza la app via ares-launch
#   6. Abre tunnel SSH: puerto 9998 del TV → 9222 local (para CDP de Playwright)
#
# Uso:
#   bash scripts/deploy-webos.sh                    → deploy + launch + tunnel
#   bash scripts/deploy-webos.sh --no-tunnel        → deploy + launch (sin tunnel)
#   bash scripts/deploy-webos.sh --launch-only      → solo lanzar (sin reinstalar)
#   bash scripts/deploy-webos.sh --tunnel-only      → solo abrir tunnel CDP
#   bash scripts/deploy-webos.sh --close            → cerrar la app en el TV
#
# Requiere:
#   - ares-cli instalado (@webos-tools/cli)
#   - WEBOS_KEY_PASSPHRASE en .env (passphrase para descifrar la clave RSA del TV)
#   - curl, openssl, ssh disponibles en PATH
#   - TV en modo Developer con IP 192.168.0.28

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"
APP_DIR="$REPO_ROOT/apps/webos-test-app"

# ── Cargar .env ───────────────────────────────────────────────────────────────

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

# ── Configuración (con defaults y overrides desde .env) ───────────────────────

DEVICE_IP="${WEBOS_DEVICE_IP:-192.168.0.28}"
SSH_PORT="${WEBOS_SSH_PORT:-9922}"
KEY_SERVER_PORT="${WEBOS_KEY_SERVER_PORT:-9991}"
KEY_PASSPHRASE="${WEBOS_KEY_PASSPHRASE:-}"
APP_ID="${WEBOS_APP_ID:-com.mediastream.lightningqa}"
TV_CDP_PORT="${WEBOS_CDP_PORT:-9998}"
LOCAL_CDP_PORT="${WEBOS_LOCAL_CDP_PORT:-9222}"
DEVICE_NAME="${WEBOS_DEVICE_NAME:-lg1}"
SSH_USER="${WEBOS_SSH_USER:-prisoner}"
SSH_KEY_PATH="$HOME/.ssh/lg1_webos"

# ── Opciones de línea de comandos ─────────────────────────────────────────────

MODE="full"
case "${1:-}" in
  --no-tunnel)   MODE="deploy-only"   ;;
  --launch-only) MODE="launch-only"   ;;
  --tunnel-only) MODE="tunnel-only"   ;;
  --close)       MODE="close"         ;;
esac

log()  { echo "  $*" >&2; }
err()  { echo "ERROR: $*" >&2; exit 1; }
ok()   { echo "  ✅ $*" >&2; }
info() { echo "  ℹ  $*" >&2; }

# ── Verificar requisitos ──────────────────────────────────────────────────────

for cmd in curl openssl ssh ares-package ares-install ares-launch; do
  if ! command -v "$cmd" &>/dev/null; then
    err "Comando '$cmd' no encontrado. Verificar instalación."
  fi
done

if [[ -z "$KEY_PASSPHRASE" ]]; then
  err "WEBOS_KEY_PASSPHRASE no está configurado en .env. Necesario para descifrar la clave RSA del TV."
fi

# ── Función: renovar clave SSH ────────────────────────────────────────────────

refresh_ssh_key() {
  log "Descargando clave SSH fresca del TV (Key Server $DEVICE_IP:$KEY_SERVER_PORT)..."

  RAW_KEY="$HOME/.ssh/lg1_webos_raw"

  curl --silent --connect-timeout 5 \
    "http://$DEVICE_IP:$KEY_SERVER_PORT/webos_rsa" \
    -o "$RAW_KEY" \
    || err "No se pudo descargar la clave del Key Server. Verificar que el TV esté encendido y en Developer Mode."

  log "Descifrando clave RSA..."
  # -traditional: necesario en OpenSSL 3.x para generar PKCS#1 (BEGIN RSA PRIVATE KEY)
  # que es el formato que ares-cli y ssh requieren (no PKCS#8)
  openssl rsa \
    -traditional \
    -in "$RAW_KEY" \
    -out "$SSH_KEY_PATH" \
    -passin "pass:$KEY_PASSPHRASE" \
    2>/dev/null \
    || err "Error descifrando la clave. Verificar WEBOS_KEY_PASSPHRASE en .env."

  chmod 600 "$SSH_KEY_PATH"
  rm -f "$RAW_KEY"
  ok "Clave SSH renovada → $SSH_KEY_PATH"
}

# ── Función: empaquetar ───────────────────────────────────────────────────────

package_app() {
  log "Empaquetando la app (--no-minify para CDP)..."
  cd "$REPO_ROOT"

  # Limpiar IPK anterior
  rm -f "${APP_ID}"_*.ipk

  ares-package --no-minify "$APP_DIR" >&2 \
    || err "Error en ares-package. Verificar appinfo.json."

  IPK_FILE=$(ls "${APP_ID}"_*.ipk 2>/dev/null | head -1)
  if [[ -z "$IPK_FILE" ]]; then
    err "No se generó el archivo .ipk. Revisar output de ares-package."
  fi

  ok "App empaquetada → $IPK_FILE"
  echo "$IPK_FILE"
}

# ── Función: instalar ─────────────────────────────────────────────────────────

install_app() {
  local ipk="$1"
  log "Instalando $ipk en el TV ($DEVICE_NAME)..."

  ares-install --device "$DEVICE_NAME" "$ipk" \
    || err "Error en ares-install. Verificar conexión SSH al TV."

  ok "App instalada correctamente"
}

# ── Función: lanzar ───────────────────────────────────────────────────────────

launch_app() {
  local params="${1:-}"
  log "Lanzando $APP_ID en el TV..."

  if [[ -n "$params" ]]; then
    ares-launch --device "$DEVICE_NAME" "$APP_ID" --params "$params" \
      || err "Error en ares-launch."
  else
    ares-launch --device "$DEVICE_NAME" "$APP_ID" \
      || err "Error en ares-launch."
  fi

  ok "App lanzada"
}

# ── Función: tunnel CDP ───────────────────────────────────────────────────────

open_tunnel() {
  log "Abriendo tunnel CDP: localhost:$LOCAL_CDP_PORT → TV:$TV_CDP_PORT"
  info "El tunnel corre en background. Para cerrarlo: kill \$(cat /tmp/webos-cdp-tunnel.pid)"

  # Cerrar tunnel anterior si existe
  if [[ -f /tmp/webos-cdp-tunnel.pid ]]; then
    OLD_PID=$(cat /tmp/webos-cdp-tunnel.pid)
    kill "$OLD_PID" 2>/dev/null || true
  fi

  ssh \
    -i "$SSH_KEY_PATH" \
    -p "$SSH_PORT" \
    -L "${LOCAL_CDP_PORT}:localhost:${TV_CDP_PORT}" \
    -o StrictHostKeyChecking=no \
    -o ServerAliveInterval=30 \
    -o HostKeyAlgorithms=+ssh-rsa \
    -o PubkeyAcceptedAlgorithms=+ssh-rsa \
    -N \
    "$SSH_USER@$DEVICE_IP" &

  TUNNEL_PID=$!
  echo "$TUNNEL_PID" > /tmp/webos-cdp-tunnel.pid

  # Esperar que el tunnel esté activo
  sleep 2
  if kill -0 "$TUNNEL_PID" 2>/dev/null; then
    ok "Tunnel CDP activo (PID $TUNNEL_PID)"
    ok "CDP disponible en: http://localhost:$LOCAL_CDP_PORT"
    info "Playwright puede conectarse via: cdpUrl: 'http://localhost:$LOCAL_CDP_PORT'"
  else
    err "El tunnel SSH falló. Verificar que la app esté corriendo en el TV."
  fi
}

# ── Función: cerrar app ───────────────────────────────────────────────────────

close_app() {
  log "Cerrando $APP_ID en el TV..."
  ares-launch --device "$DEVICE_NAME" --close "$APP_ID" \
    || log "La app ya no estaba corriendo (ok)"
  ok "App cerrada"
}

# ── Ejecución según modo ──────────────────────────────────────────────────────

echo ""
echo "  🎯 deploy-webos.sh — modo: $MODE"
echo "  📺 TV: $DEVICE_IP | Device: $DEVICE_NAME | App: $APP_ID"
echo ""

case "$MODE" in

  full)
    refresh_ssh_key
    IPK=$(package_app)
    install_app "$IPK"
    sleep 1
    launch_app
    sleep 3
    open_tunnel
    ;;

  deploy-only)
    refresh_ssh_key
    IPK=$(package_app)
    install_app "$IPK"
    launch_app
    ;;

  launch-only)
    refresh_ssh_key
    launch_app
    sleep 3
    open_tunnel
    ;;

  tunnel-only)
    refresh_ssh_key
    open_tunnel
    ;;

  close)
    close_app
    ;;

esac

echo ""
echo "  ✅ deploy-webos.sh completado"
echo ""
