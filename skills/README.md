# Skills — Lightning Player QA

> **Nota:** Los slash commands de Claude Code deben estar en `.claude/commands/`.
> Los archivos `.md` de este directorio son la fuente de autoría — el contenido
> activo está en `.claude/commands/`.

## Comandos disponibles

| Comando | Archivo | Descripción |
|---|---|---|
| `/review-diff` | `.claude/commands/review-diff.md` | Pipeline completo: diff → riesgo → cobertura → tests → ejecución → Notion |
| `/session-review` | `.claude/commands/session-review.md` | Protocolo de fin de sesión — guarda learnings en memoria |
| `/sync-knowledge` | `.claude/commands/sync-knowledge.md` | Sincroniza conocimiento del player con los archivos de memoria |

## Uso

```
/review-diff 42                   → analiza PR #42
/review-diff feature/custom-ui-tv → analiza rama vs main
/review-diff abc1234              → analiza un commit
/review-diff                      → analiza el último commit en main
/review-diff --dry-run            → análisis sin ejecutar tests
```

## Agregar un nuevo comando

1. Crear `.claude/commands/<nombre>.md` — ese es el archivo que Claude Code lee
2. Opcionalmente copiar aquí para autoría/documentación
3. El nombre del archivo (sin `.md`) es el comando: `review-diff.md` → `/review-diff`
