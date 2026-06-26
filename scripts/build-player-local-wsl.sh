#!/usr/bin/env bash
#
# build-player-local-wsl.sh — Launcher (corre en Windows/git-bash).
# Compila y sirve el Lightning Player DENTRO de WSL/Ubuntu (Linux + Node 20,
# igual que el CI), porque el build nativo de Windows produce un bundle roto
# (ver memoria player-build-requires-linux). Reachable desde Windows por el
# localhost-forwarding de WSL2.
#
# Uso (en Windows, git-bash):
#   bash scripts/build-player-local-wsl.sh
#   PORT=8090 bash scripts/build-player-local-wsl.sh
#
# Luego, en otra terminal Windows:
#   PLAYER_ENV=local PLAYER_LOCAL_URL=http://localhost:8090/api.js npx playwright test
#
# Requisitos: WSL con Ubuntu, gh CLI autenticado con scope read:packages
# (gh auth refresh -s read:packages --hostname github.com). Ver memoria
# player-private-deps-install.

set -uo pipefail
PORT="${PORT:-8090}"
DISTRO="${WSL_DISTRO:-Ubuntu}"
QA_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Traduce una ruta Windows (D:\x o D:/x) o git-bash (/d/x) a ruta WSL (/mnt/d/x).
winpath_to_wsl() {
  local p="${1//\\//}"
  if [[ "$p" =~ ^([A-Za-z]):(.*)$ ]]; then
    printf '/mnt/%s%s' "$(printf '%s' "${BASH_REMATCH[1]}" | tr 'A-Z' 'a-z')" "${BASH_REMATCH[2]}"
  elif [[ "$p" =~ ^/([A-Za-z])/(.*)$ ]]; then
    printf '/mnt/%s/%s' "$(printf '%s' "${BASH_REMATCH[1]}" | tr 'A-Z' 'a-z')" "${BASH_REMATCH[2]}"
  else
    printf '%s' "$p"
  fi
}

# ── PLAYER_LOCAL_REPO (env o .env) ───────────────────────────────────────────
if [ -z "${PLAYER_LOCAL_REPO:-}" ] && [ -f "$QA_ROOT/.env" ]; then
  PLAYER_LOCAL_REPO="$(grep -E '^PLAYER_LOCAL_REPO=' "$QA_ROOT/.env" | head -1 | cut -d= -f2- | tr -d '\r')"
fi
[ -z "${PLAYER_LOCAL_REPO:-}" ] && { echo "❌ PLAYER_LOCAL_REPO no definido (env o .env)"; exit 1; }
WSL_REPO="$(winpath_to_wsl "$PLAYER_LOCAL_REPO")"

# ── Token GitHub Packages → npmrc temporal legible desde WSL ──────────────────
TOKEN="$(gh auth token 2>/dev/null || true)"
[ -z "$TOKEN" ] && { echo "❌ 'gh auth token' vacío. Corré: gh auth refresh -s read:packages --hostname github.com"; exit 1; }
if ! gh auth status 2>&1 | grep -q "read:packages"; then
  echo "⚠️  El token de gh no tiene scope read:packages — el npm ci del player fallará."
  echo "    Corré: gh auth refresh -s read:packages --hostname github.com"
fi
TMPNPMRC="$QA_ROOT/.tmp-gh-npmrc"           # gitignored-recomendado; contiene el token
printf '//npm.pkg.github.com/:_authToken=%s\n' "$TOKEN" > "$TMPNPMRC"
trap 'rm -f "$TMPNPMRC"' EXIT
TMPNPMRC_WSL="$(winpath_to_wsl "$TMPNPMRC")"
INNER_WSL="$(winpath_to_wsl "$QA_ROOT/scripts/_wsl-build-player.sh")"

echo "🎬 Player (WSL): $WSL_REPO"
echo "🔌 Puerto      : $PORT  (PLAYER_ENV=local → :$PORT/api.js)"
echo "🐧 Distro      : $DISTRO"
echo ""

# Ejecuta el inner script dentro de WSL (tr -d '\r' por si el repo está en CRLF).
# Sin 'exec' para que el trap limpie el npmrc temporal al terminar (Ctrl-C incluido).
wsl -d "$DISTRO" bash -c "export PLAYER_WSL_REPO='$WSL_REPO' NPMRC='$TMPNPMRC_WSL' PORT='$PORT'; tr -d '\r' < '$INNER_WSL' | bash"
