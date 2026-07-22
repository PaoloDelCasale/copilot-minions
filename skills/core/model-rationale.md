# Model rationale

The orchestrator uses one GPT-5.6 family and the same model IDs on every platform.
Tracer-bullet decomposition makes Luna viable for bounded daily work; Sol is reserved
for complex implementation, independent review, and escalation; Terra handles
structured planning.

| Role | Choice | Rationale |
|------|--------|-----------|
| Frontier | Sol medium | Strong decomposition without paying high effort every turn |
| Mechanical | Luna low | Fast, low-cost command and commit work |
| Explorer | Luna high | Efficient read-heavy discovery |
| Implementer | Luna high/xhigh | Cost-effective for tightly specified slices |
| Architect | Sol medium | Better fit for ambiguous cross-cutting work |
| Reviewer | Sol low | Independent judgment over Luna implementation |
| Planner | Terra high | Strong structured synthesis at low planning volume |

These are routing decisions, not benchmark claims. Codex installation must fail
before writing files when its model catalog cannot resolve all required IDs.
