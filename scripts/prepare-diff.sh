#!/usr/bin/env bash
# prepare-diff.sh — Pre-procesa un diff del player antes de pasarlo al agente diff-analyzer
#
# Hace todo el trabajo pesado de data fetching:
#   - gh api calls en paralelo
#   - Filtra ruido (lockfiles, dist/, *.map, generated files)
#   - Extrae firmas de funciones/clases cambiadas (no el patch completo)
#   - Trunca patches a las primeras 40 líneas de contexto
#
# Output: tmp/pipeline/diff-input.json (compacto, semánticamente rico)
#
# Uso:
#   bash scripts/prepare-diff.sh                    → último commit en main
#   bash scripts/prepare-diff.sh 42                 → PR #42
#   bash scripts/prepare-diff.sh feature/pip-mode   → rama vs main
#   bash scripts/prepare-diff.sh abc1234            → commit específico
#   bash scripts/prepare-diff.sh --local            → diff local (fallback)
#
# Requiere: gh CLI autenticado, jq, PLAYER_GITHUB_REPO en .env

set -euo pipefail

# ─── Configuración ────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_DIR="$REPO_ROOT/tmp/pipeline"
OUTPUT_FILE="$OUTPUT_DIR/diff-input.json"
ENV_FILE="$REPO_ROOT/.env"

# Cargar .env si existe
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

PLAYER_GITHUB_REPO="${PLAYER_GITHUB_REPO:-}"
PLAYER_LOCAL_REPO="${PLAYER_LOCAL_REPO:-D:/repos/mediastream/lightning-player}"
INPUT="${1:-}"

# Archivos a ignorar (ruido sin valor para el análisis de riesgo)
NOISE_PATTERNS=(
  "package-lock.json"
  "yarn.lock"
  "pnpm-lock.yaml"
  "*.min.js"
  "*.min.css"
  "*.map"
  "dist/"
  "build/"
  ".next/"
  "coverage/"
  "*.snap"
  "*.lock"
  "CHANGELOG"
  "CHANGELOG.md"
)

# Módulos del player y su nivel de riesgo (path prefix → módulo:riesgo)
declare -A MODULE_MAP=(
  ["src/ads"]="ads:CRITICAL"
  ["src/api"]="api:CRITICAL"
  ["src/hls"]="hls:HIGH"
  ["src/player/handler"]="hls:HIGH"
  ["src/events"]="events:HIGH"
  ["src/platform"]="platform:HIGH"
  ["src/drm"]="drm:HIGH"
  ["src/controls"]="controls:MEDIUM"
  ["src/analytics"]="analytics:MEDIUM"
  ["src/ui"]="ui:MEDIUM"
  ["src/player/base"]="api:CRITICAL"
  ["src/player/drm"]="drm:HIGH"
  ["src/player/ads"]="ads:CRITICAL"
  ["constants"]="api:HIGH"
  ["package.json"]="dependency:HIGH"
)

# ─── Utilidades ───────────────────────────────────────────────────────────────

log() { echo "  $*" >&2; }
err() { echo "ERROR: $*" >&2; exit 1; }

# Detecta si un path es ruido (no aporta al análisis)
is_noise() {
  local path="$1"
  for pattern in "${NOISE_PATTERNS[@]}"; do
    # Comparación por sufijo o substring
    if [[ "$path" == *"$pattern"* ]]; then
      return 0
    fi
  done
  return 1
}

# Mapea un path a módulo:riesgo
map_module() {
  local path="$1"
  for prefix in "${!MODULE_MAP[@]}"; do
    if [[ "$path" == "$prefix"* ]]; then
      echo "${MODULE_MAP[$prefix]}"
      return
    fi
  done
  echo "other:MEDIUM"
}

# Extrae firmas semánticas de un patch (líneas + que son declaraciones)
extract_signatures() {
  local patch="$1"
  echo "$patch" | grep -E "^\+[^+].*(function |class |const [A-Z_]|export |module\.exports|prototype\.|=>|async )" \
    | sed 's/^+//' \
    | sed 's/^[[:space:]]*//' \
    | head -15 \
    || true
}

# Primeras N líneas del patch (contexto inicial)
patch_head() {
  local patch="$1"
  local lines="${2:-40}"
  echo "$patch" | head -"$lines"
}

# ─── Preparar directorio de output ────────────────────────────────────────────

mkdir -p "$OUTPUT_DIR"

# ─── Detectar modo de input ───────────────────────────────────────────────────

MODE=""
if [[ "$INPUT" == "--local" ]]; then
  MODE="local"
elif [[ -z "$INPUT" ]]; then
  MODE="github-latest"
elif [[ "$INPUT" =~ ^[0-9]+$ ]]; then
  MODE="github-pr"
elif [[ "$INPUT" =~ ^[0-9a-f]{7,40}$ ]]; then
  MODE="github-commit"
else
  MODE="github-branch"
fi

log "Modo: $MODE | Input: ${INPUT:-'(último commit)'}"

# ─── Validar requisitos ───────────────────────────────────────────────────────

if [[ "$MODE" != "local" ]]; then
  if [[ -z "$PLAYER_GITHUB_REPO" ]]; then
    log "PLAYER_GITHUB_REPO no configurado — usando modo local como fallback"
    MODE="local"
  elif ! gh auth status &>/dev/null; then
    log "gh CLI no autenticado — usando modo local como fallback"
    MODE="local"
  fi
fi

# ─── Fetch del diff ───────────────────────────────────────────────────────────

SOURCE_DESC=""
COMMIT_MESSAGE=""
PR_TITLE=""
PR_BODY=""
RAW_FILES_JSON=""  # array de {filename, status, patch, additions, deletions}

case "$MODE" in

  github-pr)
    log "Fetching PR #$INPUT desde GitHub..."

    # Llamadas en paralelo: archivos + metadata del PR
    GH_FILES_TMP=$(mktemp)
    GH_META_TMP=$(mktemp)

    gh api "repos/$PLAYER_GITHUB_REPO/pulls/$INPUT/files" \
      --paginate \
      --jq '[.[] | {filename: .filename, status: .status, patch: (.patch // ""), additions: .additions, deletions: .deletions}]' \
      > "$GH_FILES_TMP" &

    gh api "repos/$PLAYER_GITHUB_REPO/pulls/$INPUT" \
      --jq '{title: .title, body: (.body // ""), base: .base.ref, head: .head.ref}' \
      > "$GH_META_TMP" &

    wait  # esperar ambas llamadas

    RAW_FILES_JSON=$(cat "$GH_FILES_TMP")
    PR_META=$(cat "$GH_META_TMP")
    PR_TITLE=$(echo "$PR_META" | jq -r '.title')
    PR_BODY=$(echo "$PR_META" | jq -r '.body' | head -5)
    SOURCE_DESC="PR #$INPUT — $PR_TITLE"
    COMMIT_MESSAGE="$PR_TITLE"

    rm -f "$GH_FILES_TMP" "$GH_META_TMP"
    ;;

  github-branch)
    log "Fetching rama '$INPUT' vs main desde GitHub..."

    COMPARE_JSON=$(gh api "repos/$PLAYER_GITHUB_REPO/compare/main...$INPUT" \
      --jq '{
        commits: [.commits[].commit.message | split("\n")[0]],
        files: [.files[] | {filename: .filename, status: .status, patch: (.patch // ""), additions: .additions, deletions: .deletions}]
      }')

    RAW_FILES_JSON=$(echo "$COMPARE_JSON" | jq '.files')
    COMMIT_MESSAGE=$(echo "$COMPARE_JSON" | jq -r '.commits[0] // ""')
    SOURCE_DESC="branch $INPUT"
    ;;

  github-commit)
    log "Fetching commit $INPUT desde GitHub..."

    COMMIT_JSON=$(gh api "repos/$PLAYER_GITHUB_REPO/commits/$INPUT" \
      --jq '{
        message: .commit.message,
        files: [.files[] | {filename: .filename, status: .status, patch: (.patch // ""), additions: .additions, deletions: .deletions}]
      }')

    RAW_FILES_JSON=$(echo "$COMMIT_JSON" | jq '.files')
    COMMIT_MESSAGE=$(echo "$COMMIT_JSON" | jq -r '.message | split("\n")[0]')
    SOURCE_DESC="commit $INPUT"
    ;;

  github-latest)
    log "Fetching último commit en main desde GitHub..."

    LATEST_SHA=$(gh api "repos/$PLAYER_GITHUB_REPO/commits" \
      --jq '.[0].sha')

    COMMIT_JSON=$(gh api "repos/$PLAYER_GITHUB_REPO/commits/$LATEST_SHA" \
      --jq '{
        message: .commit.message,
        files: [.files[] | {filename: .filename, status: .status, patch: (.patch // ""), additions: .additions, deletions: .deletions}]
      }')

    RAW_FILES_JSON=$(echo "$COMMIT_JSON" | jq '.files')
    COMMIT_MESSAGE=$(echo "$COMMIT_JSON" | jq -r '.message | split("\n")[0]')
    SOURCE_DESC="latest commit ($LATEST_SHA)"
    ;;

  local)
    log "Modo local: $PLAYER_LOCAL_REPO"

    if [[ ! -d "$PLAYER_LOCAL_REPO" ]]; then
      err "Repo local no encontrado en $PLAYER_LOCAL_REPO. Configura PLAYER_LOCAL_REPO en .env o usa GitHub."
    fi

    BASE_BRANCH=$(git -C "$PLAYER_LOCAL_REPO" symbolic-ref refs/remotes/origin/HEAD 2>/dev/null \
      | sed 's|refs/remotes/origin/||' || echo "main")

    if [[ -n "$INPUT" && "$INPUT" != "--local" ]]; then
      DIFF_TARGET="$INPUT"
    else
      DIFF_TARGET=$(git -C "$PLAYER_LOCAL_REPO" rev-parse --abbrev-ref HEAD)
    fi

    # Fetch silencioso
    git -C "$PLAYER_LOCAL_REPO" fetch origin --prune --quiet 2>/dev/null || true

    # Si el branch no existe localmente, usar origin/ prefix
    if ! git -C "$PLAYER_LOCAL_REPO" rev-parse --verify "$DIFF_TARGET" &>/dev/null; then
      if git -C "$PLAYER_LOCAL_REPO" rev-parse --verify "origin/$DIFF_TARGET" &>/dev/null; then
        log "Branch '$DIFF_TARGET' no existe localmente — usando origin/$DIFF_TARGET"
        DIFF_TARGET="origin/$DIFF_TARGET"
      else
        err "Branch '$DIFF_TARGET' no encontrado ni localmente ni en origin. Verifica el nombre."
      fi
    fi

    COMMIT_MESSAGE=$(git -C "$PLAYER_LOCAL_REPO" log "$BASE_BRANCH...$DIFF_TARGET" \
      --pretty=format:"%s" | head -1 || echo "")

    # Construir JSON de archivos desde git diff
    DIFF_NAMES=$(git -C "$PLAYER_LOCAL_REPO" diff "$BASE_BRANCH...$DIFF_TARGET" --name-status 2>/dev/null || \
                 git -C "$PLAYER_LOCAL_REPO" diff HEAD~1 --name-status)

    # Construir RAW_FILES_JSON desde el diff local
    FILES_ARRAY="[]"
    while IFS=$'\t' read -r status filepath; do
      [[ -z "$filepath" ]] && continue
      GIT_STATUS="modified"
      case "$status" in
        A*) GIT_STATUS="added" ;;
        D*) GIT_STATUS="removed" ;;
        R*) GIT_STATUS="renamed" ;;
        M*) GIT_STATUS="modified" ;;
      esac

      # Patch del archivo (primeras 60 líneas)
      FILE_PATCH=$(git -C "$PLAYER_LOCAL_REPO" diff "$BASE_BRANCH...$DIFF_TARGET" -- "$filepath" 2>/dev/null \
        | head -60 || echo "")

      ADDITIONS=$(echo "$FILE_PATCH" | grep -c "^+" || echo "0")
      DELETIONS=$(echo "$FILE_PATCH" | grep -c "^-" || echo "0")

      FILE_OBJ=$(jq -n \
        --arg f "$filepath" \
        --arg s "$GIT_STATUS" \
        --arg p "$FILE_PATCH" \
        --argjson a "$ADDITIONS" \
        --argjson d "$DELETIONS" \
        '{filename: $f, status: $s, patch: $p, additions: $a, deletions: $d}')

      FILES_ARRAY=$(echo "$FILES_ARRAY" | jq ". + [$FILE_OBJ]")
    done <<< "$DIFF_NAMES"

    RAW_FILES_JSON="$FILES_ARRAY"
    SOURCE_DESC="local $DIFF_TARGET"
    ;;
esac

# ─── Procesar archivos: filtrar ruido + extraer info semántica ────────────────

log "Procesando archivos..."

TOTAL_FILES=$(echo "$RAW_FILES_JSON" | jq 'length')
log "Archivos en diff: $TOTAL_FILES"

PROCESSED_FILES="[]"
FILTERED_COUNT=0
MODULES_SEEN=()

while IFS= read -r file_json; do
  FILENAME=$(echo "$file_json" | jq -r '.filename')
  STATUS=$(echo "$file_json" | jq -r '.status')
  PATCH=$(echo "$file_json" | jq -r '.patch')
  ADDITIONS=$(echo "$file_json" | jq -r '.additions')
  DELETIONS=$(echo "$file_json" | jq -r '.deletions')

  # Filtrar ruido
  if is_noise "$FILENAME"; then
    ((FILTERED_COUNT++)) || true
    continue
  fi

  # Mapear módulo y riesgo
  MODULE_RISK=$(map_module "$FILENAME")
  MODULE="${MODULE_RISK%%:*}"
  RISK="${MODULE_RISK##*:}"

  # Extraer firmas semánticas del patch
  SIGNATURES=$(extract_signatures "$PATCH")

  # Cabecera del patch (primeras 40 líneas — contexto sin implementación completa)
  PATCH_HEAD=$(patch_head "$PATCH" 40)

  # Construir objeto procesado
  PROC_OBJ=$(jq -n \
    --arg path "$FILENAME" \
    --arg status "$STATUS" \
    --arg module "$MODULE" \
    --arg risk "$RISK" \
    --argjson additions "$ADDITIONS" \
    --argjson deletions "$DELETIONS" \
    --arg signatures "$SIGNATURES" \
    --arg patch_head "$PATCH_HEAD" \
    '{
      path: $path,
      status: $status,
      module: $module,
      risk: $risk,
      stats: {additions: $additions, deletions: $deletions},
      signature_changes: ($signatures | split("\n") | map(select(length > 0))),
      patch_head: $patch_head
    }')

  PROCESSED_FILES=$(echo "$PROCESSED_FILES" | jq ". + [$PROC_OBJ]")

  # Acumular módulos únicos
  if [[ ! " ${MODULES_SEEN[*]} " =~ " ${MODULE} " ]]; then
    MODULES_SEEN+=("$MODULE")
  fi

done < <(echo "$RAW_FILES_JSON" | jq -c '.[]')

PROCESSED_COUNT=$(echo "$PROCESSED_FILES" | jq 'length')
log "Archivos analizados: $PROCESSED_COUNT (filtrados como ruido: $FILTERED_COUNT)"

# Módulos afectados como array JSON
MODULES_JSON=$(printf '%s\n' "${MODULES_SEEN[@]}" | jq -R . | jq -s .)

# ─── Escribir diff-input.json ─────────────────────────────────────────────────

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

jq -n \
  --arg timestamp "$TIMESTAMP" \
  --arg source "$SOURCE_DESC" \
  --arg commit_message "$COMMIT_MESSAGE" \
  --arg pr_title "$PR_TITLE" \
  --arg pr_body "$PR_BODY" \
  --arg mode "$MODE" \
  --argjson files "$PROCESSED_FILES" \
  --argjson modules "$MODULES_JSON" \
  --argjson total_raw "$TOTAL_FILES" \
  --argjson filtered "$FILTERED_COUNT" \
  '{
    timestamp: $timestamp,
    source: $source,
    commit_message: $commit_message,
    pr_context: {
      title: $pr_title,
      body_excerpt: $pr_body
    },
    fetch_mode: $mode,
    stats: {
      total_files_in_diff: $total_raw,
      noise_files_filtered: $filtered,
      files_to_analyze: ($files | length)
    },
    affected_modules: $modules,
    files: $files
  }' > "$OUTPUT_FILE"

log ""
log "✅ diff-input.json escrito en $OUTPUT_FILE"
log "   Archivos a analizar: $PROCESSED_COUNT | Módulos: ${MODULES_SEEN[*]}"
log ""
