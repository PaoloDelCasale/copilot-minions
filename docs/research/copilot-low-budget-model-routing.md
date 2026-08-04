# GitHub Copilot low-budget routing: Luna-first profile

**Access date:** 2026-08-04  
**Scope:** GitHub Copilot low-budget profile only; standard and OpenAI Codex matrices
are unchanged.

## Decision

| Role | Model | Effort | Rationale |
|------|-------|--------|-----------|
| Frontier | `gpt-5.6-sol` | medium | Low-volume decomposition and user decisions remain quality-sensitive |
| Mechanical | `gpt-5.6-luna` | high | Max adds avoidable latency to bounded command work |
| Explorer | `gpt-5.6-luna` | max | Cheap first attempt; weak Q&A can escalate to Grok only after recorded evidence |
| Implementer | `gpt-5.6-luna` | max | Strong DeepSWE result at very low cost |
| Architect | `gpt-5.6-luna` | max | Economy-first architecture behind mandatory verification and independent review |
| Reviewer | `gpt-5.6-sol` | low | Preserve an independent model family at the correctness gate |
| Planner | `gpt-5.6-luna` | max | Structured synthesis with inexpensive output |

Named routes:

| Override | Model | Effort |
|----------|-------|--------|
| `mechanical-judgment` | `gpt-5.6-luna` | max |
| `escalate-entry` | `grok-4.5` | high |
| `escalate-sol-low` | `gpt-5.6-sol` | low |
| `escalate-sol-medium` | `gpt-5.6-sol` | medium |

The runtime's structured-evidence gate is essential to the cost model: a normal task
cannot select Grok or Sol merely because it is complex. Grok requires an adverse,
terminal, already-triaged source worker; Sol remains the later escalation.

## Evidence

Artificial Analysis Coding Agent Index v1.3:

| Setting | Index | DeepSWE | SWE-Atlas-QnA | Terminal-Bench v2 | AA cost/task | Wall time |
|---------|------:|--------:|--------------:|------------------:|-------------:|----------:|
| Luna high | 51.42% | 53.39% | 29.03% | 71.83% | $0.19 | 339 s |
| Luna max | 58.66% | 63.42% | 32.80% | 79.76% | $0.31 | 480 s |
| Grok 4.5 high | 64.44% | 59.88% | 48.12% | 85.32% | $2.59 | 992 s |
| Terra max | 62.28% | 66.96% | 35.75% | 84.13% | $2.21 | 502 s |

Luna max is not the strongest all-purpose agent. It is selected because:

- its DeepSWE score exceeds Grok's in the measured runs;
- its observed benchmark cost is about one eighth of Grok's;
- mandatory verification and Sol review contain implementation risk;
- its main weakness, repository Q&A, has a precise Grok escalation route.

Mechanical stays on high because max raises the benchmark's mean wall time by about
42% and cost by about 63% relative to Luna high, while the task class is bounded and
verified. For the other Luna roles, the absolute increase is small enough to buy the
substantial quality gain from high to max.

## Official Copilot pricing

Default-tier USD per one million tokens:

| Model | Input | Cached input | Cache write | Output |
|-------|------:|-------------:|------------:|-------:|
| GPT-5.6 Luna | $0.20 | $0.02 | $0.25 | $1.20 |
| Grok 4.5 | $2.00 | $0.50 | n/a | $6.00 |
| GPT-5.6 Sol | $5.00 | $0.50 | $6.25 | $30.00 |

Luna therefore costs one tenth of Grok for uncached input, one twenty-fifth for cached
input, and one fifth for output. Reasoning effort changes token usage but not these
per-token rates.

Source: [GitHub Copilot models and pricing](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing),
[Artificial Analysis coding-agent benchmarks](https://artificialanalysis.ai/agents/coding-agents).

## Illustrative cost posture

Applying Artificial Analysis mean task costs to a representative ten-worker mix—two
mechanical, two explorer, three implementer, one architect, one reviewer, and one
planner—gives approximately:

- previous Grok-heavy Copilot LB profile: **$25.06**;
- Luna-first Copilot LB profile: **$4.29**.

This is an illustration, not a Copilot invoice forecast: real prompts, caching,
reasoning tokens, retries, and role-specific task lengths differ. It shows why Grok
must be an escalation rather than the default economy route.

## Validation plan

Track verified success, review-change rate, escalation rate, wall time, and observed
cost by role. Reconsider Luna max for explorer or architect if either role escalates
to Grok on more than 20% of representative tasks; at that point the retry cost and
latency may outweigh the cheaper first attempt.
