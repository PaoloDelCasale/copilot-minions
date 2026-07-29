# Model rationale

Routing differs by provider. OpenAI Codex retains Luna for bounded daily work, Sol
for complex implementation, review, and escalation, and Terra for structured
planning. GitHub Copilot uses Grok 4.5 at high reasoning for every route that would
otherwise use Luna; its Sol and Terra decisions remain unchanged.

| Route kind | OpenAI Codex | GitHub Copilot | Rationale |
|------------|--------------|----------------|-----------|
| Frontier | Sol medium | Sol medium | Strong decomposition without high effort every turn |
| Mechanical | Luna low | Grok high | Provider-specific execution route |
| Explorer | Luna medium/high | Grok high | Read-heavy discovery |
| Implementer | Luna high/xhigh | Grok high | Tightly specified slices |
| Architect (standard) | Sol medium | Sol medium | Ambiguous cross-cutting work |
| Reviewer | Sol low | Sol low | Independent judgment |
| Planner (standard) | Terra high | Terra high | Structured synthesis at low volume |

These are routing decisions, not benchmark claims. Required-model checks resolve all
IDs against the selected provider's own catalog and never fall back across providers.
