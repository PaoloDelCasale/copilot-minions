# GitHub Copilot low-budget routing: Grok-first profile

**Access date:** 2026-08-04
**Routing revision:** 2026-08-07
**Scope:** GitHub Copilot low-budget profile only; standard and OpenAI Codex matrices
are unchanged.

## Decision

| Role | Model | Effort | Rationale |
|------|-------|--------|-----------|
| Frontier | `gpt-5.6-sol` | medium | Low-volume decomposition and user decisions remain quality-sensitive |
| Mechanical | `grok-4.5` | high | Highest available Grok effort for verified command work |
| Explorer | `grok-4.5` | high | Strong repository Q&A and terminal-agency results |
| Implementer | `grok-4.5` | high | Broad agentic coding capability behind mandatory verification |
| Architect | `grok-4.5` | high | Consistent repository context across design and implementation |
| Reviewer | `gpt-5.6-sol` | low | Preserve an independent model family at the correctness gate |
| Planner | `grok-4.5` | high | Reuse repository context for structured synthesis |

Named routes:

| Override | Model | Effort |
|----------|-------|--------|
| `mechanical-judgment` | `grok-4.5` | high |
| `escalate-entry` | `grok-4.5` | high |
| `escalate-sol-low` | `gpt-5.6-sol` | low |
| `escalate-sol-medium` | `gpt-5.6-sol` | medium |

The runtime's structured-evidence gate remains mandatory for named escalation routes.
An invalid override is audited and downgraded to the role's normal Grok route. Sol
remains the independent reviewer and later escalation family.

## Evidence

Artificial Analysis Coding Agent Index v1.3:

| Setting | Index | DeepSWE | SWE-Atlas-QnA | Terminal-Bench v2 | AA cost/task | Wall time |
|---------|------:|--------:|--------------:|------------------:|-------------:|----------:|
| Luna high | 51.42% | 53.39% | 29.03% | 71.83% | $0.19 | 339 s |
| Luna max | 58.66% | 63.42% | 32.80% | 79.76% | $0.31 | 480 s |
| Grok 4.5 high | 64.44% | 59.88% | 48.12% | 85.32% | $2.59 | 992 s |
| Terra max | 62.28% | 66.96% | 35.75% | 84.13% | $2.21 | 502 s |

Grok 4.5 high is selected for the Copilot LB worker roles because it leads these
measured settings on the aggregate index, repository Q&A, and terminal agency. Luna
max retains a DeepSWE and cost advantage, so this change deliberately favors broader
quality and consistency over the previous minimum-cost posture. Verification and Sol
review continue to contain implementation risk.

## Official Copilot pricing

Default-tier USD per one million tokens:

| Model | Input | Cached input | Cache write | Output |
|-------|------:|-------------:|------------:|-------:|
| GPT-5.6 Luna | $0.20 | $0.02 | $0.25 | $1.20 |
| Grok 4.5 | $2.00 | $0.50 | n/a | $6.00 |
| GPT-5.6 Sol | $5.00 | $0.50 | $6.25 | $30.00 |

The Grok-first matrix costs materially more than the previous Luna-first profile.
Reasoning effort changes token usage but not these per-token rates.

Source: [GitHub Copilot models and pricing](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing),
[Artificial Analysis coding-agent benchmarks](https://artificialanalysis.ai/agents/coding-agents).

## Illustrative cost posture

Applying Artificial Analysis mean task costs to a representative ten-worker mix—two
mechanical, two explorer, three implementer, one architect, one reviewer, and one
planner—previously estimated:

- Grok-heavy Copilot LB profile: **$25.06**;
- Luna-first Copilot LB profile: **$4.29**.

This is an illustration, not a Copilot invoice forecast: real prompts, caching,
reasoning tokens, retries, and role-specific task lengths differ. The revised routing
accepts this higher expected cost in exchange for Grok's measured aggregate,
repository-Q&A, and terminal results.

## Validation plan

Track verified success, review-change rate, escalation rate, wall time, and observed
cost by role. Compare those measurements with the previous Luna-first baseline and
reconsider Grok for bounded roles if quality gains do not offset its cost and latency.
