# Lightning Player QA Knowledge Base

Este directorio es la fuente de verdad documental del proyecto.

Principios:
- `repo-first`: todo conocimiento importante vive versionado aquí.
- `obsidian-second`: Obsidian es la interfaz recomendada para navegar este contenido.
- No generar tests nuevos sin contexto suficiente de feature, observabilidad y reglas de negocio.

## Mapa

- `00-index/`: navegación, glosario y taxonomía
- `01-sut/`: contexto global del sistema bajo prueba
- `02-features/`: conocimiento por feature
- `03-testing/`: reglas y filosofía de testing
- `04-coverage/`: cobertura, gaps y riesgo
- `05-pipeline/`: contrato del pipeline de generación de tests con IA
- `06-operations/`: runbooks, decisiones, sesiones y postmortems

## Flujo obligatorio para una feature nueva

1. Crear o actualizar `feature-spec.md`
2. Crear o actualizar `business-rules.md`
3. Crear o actualizar `observability.md`
4. Crear o actualizar `edge-cases.md`
5. Crear o actualizar `test-strategy.md`
6. Redactar `test-brief` antes de generar tests
7. Generar tests
8. Revisar falsos positivos y actualizar cobertura

## Uso con Obsidian

- Abrir `docs/` como vault o abrir la raíz del repo si quieres navegar también tests.
- Mantener la verdad en Markdown; no guardar decisiones críticas solo en `.obsidian/`.
- Usar backlinks entre feature, reglas de negocio, coverage y tests.
