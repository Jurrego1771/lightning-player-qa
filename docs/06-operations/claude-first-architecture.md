# Claude-First Architecture

## Objetivo

Evitar duplicidad entre carpetas conceptuales y la capa operativa real usada por Claude.

## Estructura adoptada

- `.claude/agents/`: agentes reales
- `.claude/commands/`: comandos reales
- `.claude/memory/`: memoria operativa
- `docs/`: fuente de verdad documental
- `skills/`: autoría o documentación auxiliar cuando aplique
- `agents/` raíz: carpeta deprecada como fuente operativa

## Reglas

- Si un agente existe de verdad para Claude, debe vivir en `.claude/agents/`.
- Si un comando existe de verdad para Claude, debe vivir en `.claude/commands/`.
- Si una regla de proceso o contrato existe, debe vivir en `docs/`.
- No crear una segunda definición operativa en `agents/` raíz.

## Estado detectado

Actualmente `.claude/commands/` y `skills/` tienen solapamiento parcial de contenido.
Eso es aceptable solo si `skills/` se entiende como capa de autoría o espejo documental.
La fuente operativa sigue siendo `.claude/commands/`.
