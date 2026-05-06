---
name: sync-knowledge
description: Sincroniza el conocimiento del QA suite con el estado actual del repo del player. Lee archivos clave del player, detecta diffs vs la memoria actual y propone actualizaciones.
---

# /sync-knowledge — Sincronización de Conocimiento QA ↔ Player

<!-- CANONICAL: este archivo es la fuente de verdad.
     .claude/commands/sync-knowledge.md debe mantenerse idéntico a este. -->

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

## Cuándo correr este skill

- Cuando el player hace un release (nueva versión en su repo)
- Antes de empezar a escribir tests para una feature nueva
- Cuando un test falla de manera inesperada y sospechas que el player cambió su comportamiento
- Como rutina mensual de mantenimiento

## Tiempo estimado

5-15 minutos dependiendo de cuánto cambió el player.
