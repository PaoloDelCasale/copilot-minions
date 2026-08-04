# Model rationale

Routing differs by provider. OpenAI Codex retains Luna for bounded daily work, Sol
for complex implementation, review, and escalation, and Terra for structured
planning. GitHub Copilot's standard profile is a quality-first portfolio selected
from its broader catalog; its low-budget profile remains unchanged.

| Route kind | OpenAI Codex | GitHub Copilot standard | Rationale |
|------------|--------------|-------------------------|-----------|
| Frontier | Sol medium | Sol medium | Strong decomposition without paying max effort every turn |
| Mechanical | Luna low | Luna high | Cheap bounded execution; high effort protects command accuracy |
| Explorer | Luna high | Opus 5 high | Quality-first repository understanding; xhigh remains reserved for architecture |
| Implementer | Luna xhigh | Terra max | Terra max is close to Sol on DeepSWE at materially lower token prices |
| Architect | Sol medium | Opus 5 xhigh | Highest-quality low-volume architecture route |
| Reviewer | Sol low | Sol high | Independent family from the architect and a stronger correctness gate |
| Planner | Terra high | Terra max | Structured synthesis with a quality-first effort setting |

The Copilot matrix and its pricing snapshot are supported by the repository's
[research note](https://github.com/PaoloDelCasale/copilot-minions/blob/main/docs/research/copilot-standard-model-routing.md).
Benchmarks are selection evidence, not guarantees for the Pi or native Copilot harness. Required-model checks resolve
all IDs against the selected provider's own catalog and never fall back across
providers.
