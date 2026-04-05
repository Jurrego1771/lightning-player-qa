# Agents — Lightning Player QA

Este directorio contiene agentes de IA especializados para tareas de QA automatizadas.

## Propósito

Los agentes permiten ejecutar tareas complejas de QA de forma autónoma,
más allá de lo que un test estático puede hacer:
- Analizar reportes de Playwright y clasificar fallos
- Generar nuevos casos de test basados en cambios en el player
- Investigar flaky tests y proponer fixes
- Comparar métricas QoE entre versiones del player
- Monitorear streams y reportar anomalías

## Agentes Planeados

| Agente | Descripción | Estado |
|---|---|---|
| `flaky-analyzer` | Analiza runs de CI e identifica tests intermitentes | Pendiente |
| `test-generator` | Genera specs nuevos basados en cambios en el API del player | Pendiente |
| `qoe-reporter` | Compara métricas QoE entre dos versiones del player | Pendiente |
| `stream-monitor` | Monitorea streams de test y alerta si dejan de funcionar | Pendiente |
| `ad-beacon-verifier` | Verifica que los beacons de ads se disparen correctamente en producción | Pendiente |

## Convención de Archivos

```
agents/
├── flaky-analyzer/
│   ├── agent.ts          ← Lógica del agente
│   ├── prompts/          ← Prompts del sistema
│   └── README.md
└── README.md
```

## Integración con Claude Code

Los agentes se invocan via el `Agent` tool de Claude Code o via CLI:

```bash
# Futuro: ejecutar un agente
npx ts-node agents/flaky-analyzer/agent.ts --report playwright-report/
```
