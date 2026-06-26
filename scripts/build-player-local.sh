#!/usr/bin/env bash
#
# build-player-local.sh — Compila y sirve el Lightning Player desde PLAYER_LOCAL_REPO
# para que el harness QA lo cargue (PLAYER_ENV=local) en vez del CDN.
#
# Es el CIMIENTO del loop ATDD: escribir tests → implementar en el player →
# compilar → correr la suite contra el bundle local → iterar a verde → PR.
#
# El build del player (webpack) produce `dist/api.js`, el mismo artefacto que el
# CDN. El dev-server ya tiene CORS abierto (Access-Control-Allow-Origin: *) en
# 0.0.0.0, así que el harness en :3000 puede cargar :8080/api.js cross-origin.
#
# Modos:
#   dev   (default) — webpack-dev-server con HMR. Recompila incremental (~seg) en
#                     cada cambio de src. Ideal para el loop iterar→verde.
#   prod            — `npm run build` (webpack.prod.cjs, minificado = idéntico al
#                     CDN) y sirve dist/. Para la VALIDACIÓN final antes del PR:
#                     atrapa bugs que solo aparecen en el bundle minificado.
#
# Uso:
#   bash scripts/build-player-local.sh [dev|prod]
#   PORT=9100 bash scripts/build-player-local.sh dev
#
# Luego, en otra terminal:
#   PLAYER_ENV=local npx playwright test <spec>
#
# Variables:
#   PLAYER_LOCAL_REPO — ruta al repo del player (se lee de .env si existe).
#   PORT              — puerto donde se sirve api.js (default 8080).
#                       Si lo cambias, exporta también PLAYER_LOCAL_URL para el harness.

set -euo pipefail

MODE="${1:-dev}"
PORT="${PORT:-8080}"
QA_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ── Cargar PLAYER_LOCAL_REPO desde .env si no viene del entorno ───────────────
if [ -z "${PLAYER_LOCAL_REPO:-}" ] && [ -f "$QA_ROOT/.env" ]; then
  PLAYER_LOCAL_REPO="$(grep -E '^PLAYER_LOCAL_REPO=' "$QA_ROOT/.env" | head -1 | cut -d= -f2- | tr -d '\r')"
fi

if [ -z "${PLAYER_LOCAL_REPO:-}" ]; then
  echo "❌ PLAYER_LOCAL_REPO no está definido (ni en el entorno ni en .env)." >&2
  echo "   Configura la ruta al repo del player clonado. Ej:" >&2
  echo "   PLAYER_LOCAL_REPO=D:/repos/mediastream/lightning-player" >&2
  exit 1
fi

# Normalizar backslashes de Windows a forward slashes para bash.
PLAYER_LOCAL_REPO="${PLAYER_LOCAL_REPO//\\//}"

if [ ! -f "$PLAYER_LOCAL_REPO/package.json" ]; then
  echo "❌ No encuentro package.json en PLAYER_LOCAL_REPO: $PLAYER_LOCAL_REPO" >&2
  exit 1
fi

echo "🎬 Player repo : $PLAYER_LOCAL_REPO"
echo "🌿 Rama        : $(git -C "$PLAYER_LOCAL_REPO" branch --show-current 2>/dev/null || echo '?')"
echo "🔌 Puerto      : $PORT  (PLAYER_ENV=local → :$PORT/api.js)"
echo "⚙️  Modo        : $MODE"
echo ""

cd "$PLAYER_LOCAL_REPO"

# Instalar deps si faltan (primera vez).
if [ ! -d node_modules ]; then
  echo "📦 node_modules ausente — instalando (npm ci)…"
  npm ci
fi

case "$MODE" in
  dev)
    echo "🚀 webpack-dev-server (HMR) en :$PORT — recompila en cada cambio de src/"
    echo "   Dejá esto corriendo. En otra terminal: PLAYER_ENV=local npx playwright test"
    echo "   Ctrl-C para detener."
    echo ""
    # webpack serve directo (sin webpack-dashboard ni --open: no interactivo, apto CI/agente).
    # El config (webpack.dev.cjs) ya fija host 0.0.0.0 + CORS *. Solo imponemos el puerto.
    exec npx webpack serve --config webpack.dev.cjs --port "$PORT"
    ;;

  prod)
    echo "🏗  Build prod (webpack.prod.cjs, minificado)…"
    NODE_ENV=production npx webpack --config webpack.prod.cjs --mode production
    npm run icon:build || true
    if [ ! -f dist/api.js ]; then
      echo "❌ El build no generó dist/api.js" >&2
      exit 1
    fi
    echo "✅ dist/api.js generado."
    echo "🚀 Sirviendo dist/ en :$PORT (CORS abierto)…"
    echo "   En otra terminal: PLAYER_ENV=local npx playwright test"
    echo "   Ctrl-C para detener."
    echo ""
    exec npx serve dist -p "$PORT" --cors
    ;;

  *)
    echo "❌ Modo desconocido: '$MODE'. Usá: dev | prod" >&2
    exit 1
    ;;
esac
