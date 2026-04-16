# Anti-Patterns

- Generar tests directamente desde un diff sin revisar reglas de negocio.
- Validar internals del DOM del player sin necesidad.
- Usar el mismo tipo de aserción para smoke, integration y performance.
- Confundir `evento despachado` con `transición completada`.
- Dejar lógica crítica solo en comentarios de tests en vez de moverla a documentación de feature.
- Crear cobertura “verde” que en realidad depende de señales débiles.
