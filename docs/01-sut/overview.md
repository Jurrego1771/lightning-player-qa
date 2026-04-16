# SUT Overview

## Sistema bajo prueba

- Repo SUT: `D:\Dev\Repos\mediastream\lightning-player`
- Repo QA: `D:\Dev\Repos\jurrego1771\lightning-player-qa`
- Tipo: suite externa de QA, no integrada en el repo del player

## Objetivo del repo QA

- Automatizar validaciones del player con foco en estabilidad, cobertura y diagnóstico.
- Proveer contexto suficiente para que IA genere tests útiles y revisables.
- Reducir falsos positivos obligando a documentar señales válidas y supuestos.

## Realidad actual

- El player tiene múltiples dominios funcionales: video, live, DVR, reels, ads, DRM, TV UI, audio, radio, podcast y APIs headless.
- El repo de QA ya contiene smoke, e2e, integration, visual, a11y, contract y performance.
- El riesgo principal no es solo falta de cantidad de tests, sino falta de contexto de negocio y observabilidad antes de generarlos.
