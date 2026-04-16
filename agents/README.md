# Agents — Deprecated Directory

Esta carpeta ya no es la fuente operativa de agentes del proyecto.

## Estado actual

El proyecto usa un modelo `Claude-first`:
- agentes reales: `.claude/agents/`
- comandos reales: `.claude/commands/`
- memoria operativa: `.claude/memory/`
- documentación del proceso: `docs/05-pipeline/`

## Decisión

`agents/` queda deprecada como carpeta operativa para evitar duplicidad semántica con `.claude/agents/`.

## Qué hacer si necesitas agregar un agente

1. Crear el agente en `.claude/agents/<nombre>/AGENT.md`
2. Documentar su propósito en `docs/05-pipeline/`
3. Si el agente se expone mediante comando, referenciarlo desde `.claude/commands/`

## Qué no hacer

- No definir agentes nuevos aquí
- No usar esta carpeta como segunda fuente de verdad
- No duplicar prompts o definiciones entre aquí y `.claude/agents/`
