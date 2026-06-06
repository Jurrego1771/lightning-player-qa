---
name: sync-knowledge
description: Sincroniza el conocimiento del QA suite con el estado actual del repo del player. Lee archivos clave del player, detecta diffs vs la memoria actual y propone actualizaciones.
---

# /sync-knowledge — Sincronización de Conocimiento QA ↔ Player

<!-- CANONICAL: skills/sync-knowledge.md es la fuente de verdad.
     Este archivo debe mantenerse idéntico a ese. -->

Eres un agente de sincronización de conocimiento para el proyecto `lightning-player-qa`.
Tu trabajo es leer el estado actual del repositorio del player y compararlo con lo que
el proyecto QA tiene documentado, para detectar inconsistencias y proponer actualizaciones.

---

## Paso 0 — Verificar prerrequisitos

Antes de continuar, lee el archivo `.env` (en la raíz del repo QA) para obtener:
- `PLAYER_LOCAL_REPO` — ruta local al repo del player
- `PLAYER_GITHUB_REPO` — formato `owner/repo` (ej: `mediastream/lightning-player`)

**Árbol de decisión:**

```
PLAYER_LOCAL_REPO seteado y directorio existe?
  → Sí: usar repo local (Paso 2 — rama A)
  → No: PLAYER_GITHUB_REPO seteado y `gh` CLI disponible?
          → Sí: usar GitHub API (Paso 2 — rama B)
          → No: DETENER. Informar al usuario:
                "sync-knowledge requiere PLAYER_LOCAL_REPO (ruta local)
                 o PLAYER_GITHUB_REPO + gh CLI autenticado.
                 Configura alguno de los dos en .env y vuelve a correr."
```

---

## Paso 1 — Leer el estado actual de la memoria QA

Lee estos archivos en orden (rutas absolutas desde la raíz del repo QA):

1. `.claude/memory/player_system.md` — referencia del player para QA
2. `.claude/memory/player_architecture.md` — arquitectura interna
3. `.claude/memory/testing_gaps.md` — gaps conocidos
4. `.claude/memory/decisions.md` — decisiones técnicas
5. `.claude/memory/testing_philosophy.md` — filosofía de testing (leer si existe)

Anota:
- Versión del player documentada
- Fecha de "Última verificación desde fuente" en `player_system.md`
- Supuestos principales sobre API, eventos y ad systems

---

## Paso 2 — Leer el estado actual del player repo

### Rama A — Repo local (`PLAYER_LOCAL_REPO`)

Antes de leer cada archivo, **verifica que existe** con Glob o un check de existencia.
Si un archivo no existe, registrarlo como "no encontrado" y continuar — no fallar.

**Versión y dependencias:**
- `$PLAYER_LOCAL_REPO/package.json`

**API pública** (buscar con Glob si la ruta exacta es incierta):
- `$PLAYER_LOCAL_REPO/src/api/api.js` o `src/api/index.js` o `src/api/api.ts`
- `$PLAYER_LOCAL_REPO/src/controls/index.js` o buscar `glob: src/controls/**`

**Eventos:**
- `$PLAYER_LOCAL_REPO/constants.cjs` o `src/constants.*` o `src/events/constants.*`
- `$PLAYER_LOCAL_REPO/src/events/index.js` (puede ser `.ts`)

**Ads:**
- `$PLAYER_LOCAL_REPO/src/ads/manager/index.js` (puede ser `.ts`)
- Glob `$PLAYER_LOCAL_REPO/src/ads/**` para detectar módulos nuevos

**Platform config:**
- Glob `$PLAYER_LOCAL_REPO/src/platform/**` para encontrar el archivo de loadConfig
- Buscar patrón `develop.mdstrm.com` o `mdstrm.com` para confirmar el dominio

**Changelog / commits recientes:**
- `$PLAYER_LOCAL_REPO/CHANGELOG.md` (si existe)
- Si no hay CHANGELOG: `git -C $PLAYER_LOCAL_REPO log --oneline -20`

### Rama B — GitHub API (`PLAYER_GITHUB_REPO`)

Usar `gh api` para leer los archivos equivalentes:

```bash
gh api repos/$PLAYER_GITHUB_REPO/contents/package.json --jq '.content' | base64 -d
gh api repos/$PLAYER_GITHUB_REPO/git/trees/HEAD?recursive=1 --jq '.tree[].path' | grep -E 'src/(api|events|ads|platform)'
gh api repos/$PLAYER_GITHUB_REPO/commits --jq '.[0:20] | .[] | .commit.message'
```

Para leer un archivo específico:
```bash
gh api repos/$PLAYER_GITHUB_REPO/contents/PATH --jq '.content' | base64 -d
```

---

## Paso 3 — Comparar y detectar diffs

Compara lo leído en Paso 2 con lo documentado en Paso 1. Usa tabla estructurada internamente:

| Área | Documentado | Actual | Diferencia |
|------|-------------|--------|------------|
| Versión player | X.X.X | X.X.X | sí/no |
| Versión hls.js | X.X.X | X.X.X | sí/no |
| ...métodos API... | | | |

### Cambios en versión
- ¿Cambió la versión del player?
- ¿Cambió la versión de hls.js u otras deps clave?

### Cambios en API
- ¿Métodos nuevos en API pública?
- ¿Métodos eliminados o renombrados?
- ¿Propiedades nuevas o eliminadas?

### Cambios en eventos
- ¿Eventos nuevos en constants que no están en `player_system.md`?
- ¿Eventos eliminados?

### Cambios en ads
- ¿Módulos de ads nuevos (nuevos ad systems)?
- ¿Cambió el flujo de IMA o SGAI?

### Cambios en platform config
- ¿Cambió el dominio del endpoint?
- ¿Cambió la estructura del JSON de respuesta?
- Si cambió → los mocks en `fixtures/platform-responses/` y `fixtures/platform-mock.ts` pueden estar desactualizados

### Nuevos módulos o features
- ¿Directorios nuevos en `src/` no documentados?
- ¿Nuevas integraciones (analytics, ad system)?

---

## Paso 4 — Revisar gaps pendientes

Lee `.claude/memory/testing_gaps.md` y para cada ítem marcado como ⬜ pendiente, verifica:
- ¿Sigue siendo relevante?
- ¿Hay alguno implementado que deba marcarse ✅?
- ¿El bug reportado en SGAI sigue existiendo en el código?

---

## Paso 5 — Generar reporte de diffs

Presenta al usuario un reporte con esta estructura:

```
## Reporte sync-knowledge — [YYYY-MM-DD]

### Meta
- Fuente usada: [local: $PLAYER_LOCAL_REPO | github: $PLAYER_GITHUB_REPO]
- Memoria QA — última sincronización: [fecha de "Última verificación" en player_system.md]
- Archivos no encontrados en el repo del player: [lista o "ninguno"]

### Versión del player
- Documentada: X.X.X
- Actual en repo: X.X.X
- [CAMBIO / SIN CAMBIO]

### Cambios en API pública
- [lista de cambios o "Sin cambios detectados"]

### Cambios en eventos
- [lista de eventos nuevos/eliminados o "Sin cambios"]

### Cambios en ads
- [descripción o "Sin cambios"]

### Cambios en platform config
- [descripción o "Sin cambios"]
- Impacto en fixtures: [sí/no — qué archivos afectados]

### Nuevos módulos/features
- [descripción o "Ninguno nuevo"]

### Estado de gaps pendientes
- Gap 1: [sigue pendiente / implementado / ya no aplica]
- ...

### Actualizaciones recomendadas
1. [archivo] → [qué cambiar]
2. ...
```

---

## Paso 6 — Aplicar actualizaciones (con confirmación)

Para cada actualización identificada, pregunta al usuario si quiere que la apliques.
Si dice sí, actualiza los archivos correspondientes:

**Memoria:**
- `.claude/memory/player_system.md` — si cambió API, versión, o eventos
- `.claude/memory/player_architecture.md` — si cambió arquitectura interna
- `.claude/memory/testing_gaps.md` — marcar items completados o agregar nuevos
- `.claude/memory/decisions.md` — si hay nuevas decisiones técnicas
- `.claude/memory/testing_philosophy.md` — si cambió la filosofía de mocking
- `.claude/memory/MEMORY.md` — si se crean archivos nuevos

**Fixtures QA** (si cambió platform config):
- `fixtures/platform-responses/content/*.json` — si cambió estructura de content config
- `fixtures/platform-responses/player/*.json` — si cambió estructura de player config
- `fixtures/platform-mock.ts` — si cambió el dominio interceptado o rutas de endpoints

**Nunca modifiques tests automáticamente.** Los cambios a tests siempre requieren revisión manual.

**Al terminar las actualizaciones**, actualiza el campo `Última verificación desde fuente`
en `.claude/memory/player_system.md` con la fecha de hoy (YYYY-MM-DD).

---

---

## Paso 7 — Detectar oracles desactualizados (behavior.json stale)

Para cada `behavior.json` en `qa-knowledge/modules/*/behavior.json`:

```bash
python3 - <<'EOF'
import os, json, datetime
today = datetime.date.today()
threshold = datetime.timedelta(days=90)
stale = []
for root, dirs, files in os.walk('qa-knowledge/modules'):
    for f in files:
        if f == 'behavior.json':
            path = os.path.join(root, f)
            try:
                data = json.load(open(path))
                lv = data.get('last_verified', '')
                if lv:
                    d = datetime.date.fromisoformat(lv)
                    if (today - d) > threshold:
                        stale.append((path, lv, data.get('status','?')))
                else:
                    stale.append((path, 'never', data.get('status','?')))
            except Exception as e:
                stale.append((path, 'parse-error', str(e)))
for s in stale:
    print(f'STALE: {s[0]} | last_verified={s[1]} | status={s[2]}')
if not stale:
    print('All behavior oracles up to date.')
EOF
```

Para cada oracle marcado STALE:
1. Actualizar `status: "stale"` en el `behavior.json`
2. Agregar al reporte de Paso 5 bajo sección "Oracles desactualizados"
3. No bloquear el pipeline — es advertencia

---

## Paso 8 — Detectar módulos nuevos sin context.yaml

Comparar claves de `risk_map.yaml` vs directorios en `qa-knowledge/modules/`:

```bash
python3 - <<'EOF'
import yaml, os
risk_map = yaml.safe_load(open('risk_map.yaml'))
known_modules = set(risk_map.get('modules', {}).keys())
existing_dirs = set(
    d for d in os.listdir('qa-knowledge/modules')
    if os.path.isdir(os.path.join('qa-knowledge/modules', d))
)
missing = known_modules - existing_dirs
extra = existing_dirs - known_modules
if missing:
    print('MISSING (no context.yaml):', sorted(missing))
if extra:
    print('EXTRA (not in risk_map.yaml):', sorted(extra))
if not missing and not extra:
    print('All modules have qa-knowledge directories.')
EOF
```

Para módulos faltantes → listar en el reporte como "necesitan `context.yaml`".

---

## Paso 9 — Reporte de gaps de cobertura (ACs sin covered_by)

Ejecutar para todos los módulos HIGH y CRITICAL:

```bash
# Obtener módulos HIGH y CRITICAL desde risk_map.yaml
python3 -c "
import yaml
rm = yaml.safe_load(open('risk_map.yaml'))
mods = [m for m,v in rm.get('modules',{}).items() if v.get('base_risk') in ('HIGH','CRITICAL')]
print(' '.join(mods))
" | xargs -I{} npx ts-node scripts/query-context.ts coverage-gaps {} 2>/dev/null
```

Si `query-context.ts` no existe → omitir sin error.

Agregar al reporte de Paso 5 sección "ACs sin cobertura (coverage gaps actuales)".

---

## Paso 10 — Auto-actualizar covered_by en behavior.json

Para cada AC en todos los `behavior.json`, buscar si ya existe un test que la cubre:

```bash
python3 - <<'EOF'
import os, json, subprocess

updated_files = []
for root, dirs, files in os.walk('qa-knowledge/modules'):
    for f in files:
        if f != 'behavior.json':
            continue
        path = os.path.join(root, f)
        data = json.load(open(path))
        changed = False
        for ac in data.get('acceptance_criteria', []):
            ac_id = ac.get('id', '')
            if not ac_id:
                continue
            # grep por AC ID en tests/
            result = subprocess.run(
                ['grep', '-r', ac_id, 'tests/', '--include=*.spec.ts', '-l'],
                capture_output=True, text=True
            )
            found_files = [l.strip() for l in result.stdout.splitlines() if l.strip()]
            if found_files:
                existing = set(ac.get('covered_by', []))
                new_files = set(found_files) - existing
                if new_files:
                    ac['covered_by'] = sorted(existing | new_files)
                    changed = True
        if changed:
            json.dump(data, open(path, 'w'), indent=2)
            json.dump('\n', open(path, 'a'))  # trailing newline
            updated_files.append(path)

if updated_files:
    print('Updated covered_by in:', updated_files)
else:
    print('No covered_by updates needed.')
EOF
```

Agregar archivos actualizados al reporte de Paso 5 bajo "covered_by actualizados".

**Nunca remover** entradas existentes en `covered_by` — solo agregar.

---

## Cuándo correr este skill

- Cuando el player hace un release (nueva versión en su repo)
- Antes de empezar a escribir tests para una feature nueva
- Cuando un test falla de manera inesperada y sospechas que el player cambió su comportamiento
- Después de agregar tests nuevos (para que Paso 10 actualice covered_by)
- Como rutina mensual de mantenimiento

## Tiempo estimado

10-20 minutos dependiendo de cuánto cambió el player y cuántos oracles existen.
