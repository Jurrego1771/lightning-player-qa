#!/usr/bin/env bash
#
# _wsl-build-player.sh — corre DENTRO de WSL/Ubuntu. No invocar directo desde
# Windows; usar scripts/build-player-local-wsl.sh (el launcher).
#
# Compila el Lightning Player en Linux (Node 20, igual que el CI) y lo sirve.
# El build de Windows produce un bundle roto — ver memoria player-build-requires-linux.
#
# Env requerido: PLAYER_WSL_REPO (ruta /mnt/... al repo), NPMRC (npmrc con authToken).
# Env opcional:  PORT (default 8090), NODEVER (default 20.18.0).

set -uo pipefail
: "${PLAYER_WSL_REPO:?falta PLAYER_WSL_REPO}"
: "${NPMRC:?falta NPMRC}"
PORT="${PORT:-8090}"
NODEVER="${NODEVER:-20.18.0}"
NODEDIR="$HOME/node-v$NODEVER-linux-x64"
LP="$HOME/lp"   # copia en ext4 (rápido; no pisa el node_modules de Windows)

# 1. Node 20 Linux portable (sin sudo)
if [ ! -x "$NODEDIR/bin/node" ]; then
  echo "==> Descargando Node $NODEVER linux-x64…"
  curl -fsSL "https://nodejs.org/dist/v$NODEVER/node-v$NODEVER-linux-x64.tar.xz" -o "$HOME/node-$NODEVER.tar.xz"
  tar -xf "$HOME/node-$NODEVER.tar.xz" -C "$HOME"
fi
export PATH="$NODEDIR/bin:$PATH"
echo "==> node $(node --version) / npm $(npm --version)"

# 2. Copiar source a ext4 (node_modules/dist/.git excluidos y protegidos de --delete)
echo "==> rsync source → $LP"
rsync -a --delete \
  --exclude node_modules --exclude dist --exclude .git --exclude '.playwright-mcp' \
  "$PLAYER_WSL_REPO/" "$LP/"

# 3. npm ci (solo si falta) con token GitHub Packages + rewrite git+ssh→https (wavesurfer)
cd "$LP"
if [ ! -d node_modules/webpack ]; then
  echo "==> npm ci (Linux/Node20)…"
  TOKEN=$(grep -oE '_authToken=.*' "$NPMRC" | cut -d= -f2- | tr -d '\r')
  GIT_CONFIG_COUNT=2 \
  GIT_CONFIG_KEY_0="url.https://x-access-token:$TOKEN@github.com/.insteadOf" GIT_CONFIG_VALUE_0="ssh://git@github.com/" \
  GIT_CONFIG_KEY_1="url.https://x-access-token:$TOKEN@github.com/.insteadOf" GIT_CONFIG_VALUE_1="git@github.com:" \
  npm ci --userconfig "$NPMRC" --no-audit --no-fund --no-optional || { echo "npm ci FALLÓ"; exit 1; }
else
  echo "==> node_modules ya presente (skip npm ci; borrar $LP/node_modules para forzar)"
fi

# 4. Build prod con publicPath local (chunks resuelven desde :$PORT, no el CDN)
export PUBLIC_PATH="http://localhost:$PORT/"
echo "==> build prod, PUBLIC_PATH=$PUBLIC_PATH"
NODE_ENV=production npx webpack --config webpack.prod.cjs --mode production 2>&1 | tail -4
npm run icon:build 2>&1 | tail -1 || true
[ -f dist/api.js ] || { echo "build no generó dist/api.js"; exit 1; }
echo "==> artefactos: $(ls -la dist/api.js dist/icons.json 2>&1)"

# 5. Servir (CORS para crossOriginLoading de los chunks)
echo "==> serve dist en :$PORT — desde Windows: PLAYER_ENV=local PLAYER_LOCAL_URL=http://localhost:$PORT/api.js"
exec npx --yes serve dist -p "$PORT" --cors
