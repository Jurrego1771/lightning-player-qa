# Skills — Lightning Player QA

Este directorio contiene skills de Claude Code personalizadas para el proyecto QA.

## Propósito

Las skills proveen comandos rápidos que Claude puede ejecutar durante sesiones de trabajo,
específicos al contexto de este proyecto de QA.

## Skills Planeadas

| Skill | Comando | Descripción |
|---|---|---|
| `run-failing` | `/run-failing` | Corre solo los tests que fallaron en el último run |
| `analyze-report` | `/analyze-report` | Analiza el reporte HTML de Playwright y resume los fallos |
| `add-test` | `/add-test <flujo>` | Genera un spec nuevo para un flujo dado |
| `update-snapshots` | `/update-snapshots` | Actualiza el baseline de visual regression |
| `check-streams` | `/check-streams` | Verifica que todos los streams de test estén disponibles |
| `session-review` | `/session-review` | Protocolo de fin de sesión — guarda learnings en memoria |

## Convención de Archivos

```
skills/
├── run-failing.md      ← Prompt del skill
├── analyze-report.md
├── add-test.md
└── README.md
```

## Creación de un nuevo Skill

1. Crear un archivo `.md` en este directorio
2. El archivo debe comenzar con frontmatter YAML:
   ```yaml
   ---
   name: nombre-del-skill
   description: Descripción breve
   ---
   ```
3. El cuerpo del archivo es el prompt que Claude ejecutará
4. Registrar en `.claude/settings.json` si requiere hooks

## Referencia

Ver documentación de Claude Code skills:
`/help skills` en la CLI de Claude Code
