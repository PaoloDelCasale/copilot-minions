# Model rationale

Routing differs by provider. OpenAI Codex retains Luna for bounded daily work, Sol
for complex implementation, review, and escalation, and Terra for structured
planning. GitHub Copilot's standard profile is a quality-first portfolio selected
from its broader catalog; its low-budget profile uses Grok 4.5 high for ordinary
worker roles with independent Sol review and escalation.

| Route kind | OpenAI Codex | GitHub Copilot standard | CommandCode standard | Rationale |
|------------|--------------|-------------------------|----------------------|-----------|
| Frontier | Sol medium | Sol medium | Luna max | Luna minimum is Extra High; standard uses max for the thinking frontier |
| Mechanical | Luna low | Luna high | DeepSeek Flash 0731 max | DeepSeek is the high-volume GOAT workhorse; always max |
| Explorer | Luna high | Opus 5 high | Luna xhigh | Quality-first repository understanding |
| Implementer | Luna xhigh | Terra max | DeepSeek Flash 0731 max | DeepSeek is a strong agentic coding workhorse; always max |
| Architect | Sol medium | Opus 5 xhigh | Luna max | Luna decides architecture; Kimi is escalation-only |
| Reviewer | Luna low | Sol high | Luna max | Independent family and a stronger correctness gate |
| Planner | Terra high | Terra max | Luna max | Luna plans; Kimi only when evidence says Luna is insufficient |

## CommandCode GOAT routing policy

CommandCode runs on the GOAT plan. GOAT shows a shared monthly meter (currently `$70`
in the UI) but each model has a different effective allowance; raw `$ / 1M tokens`
is not enough to choose the best model. Relevant values:

| Model | Model allowance | Meter factor vs $70 | Estimated requests/month |
|---|---:|---:|---:|
| **GPT-5.6 Luna** | **$70** | **1.00x** | ~51,800 |
| **DeepSeek V4 Flash 0731** | **$60** | **1.17x** | ~195,000 |
| Muse Spark 1.2 Contributor | $20 | ~3.50x | ~90,900 |
| Kimi K3 | $20 | ~3.50x | ~980 |
| Grok 4.5 | $20 | ~3.50x | ~719 |

Observed real-world usage with almost exclusively DeepSeek V4 Flash: ~112.8M total
tokens, ~978 runs, only ~$0.71 shown on the `$70` monthly GOAT meter — strong
support for DeepSeek as the default high-volume worker.

The default policy until new benchmark/capacity data suggests otherwise:

- **DeepSeek V4 Flash 0731 is the GOAT workhorse and always runs at `max`**
  (`deepseek/deepseek-v4-flash`). It gives up only a small coding/terminal margin
  versus Luna while the GOAT calculator estimates roughly **3.8x more
  requests/month**, making it the right model for the majority of
  implementation/exploration/mechanical work.
- **GPT-5.6 Luna handles judgment/frontier/review/architecture and never runs below
  `xhigh`** (`gpt-5.6-luna`). Its full `$70` allowance makes it the right
  model when the worker's main value is deciding what to do, understanding large
  repository context, or validating DeepSeek output.
- **Kimi K3 is escalation-only** (`moonshotai/Kimi-K3`). It is the strongest model
  but its `$20` allowance (~980 requests/month) makes routine use too expensive. Use
  it only after a terminal/triaged worker result proves Luna is insufficient:
  repeated implementation failure, verification failure after retry, unresolved
  architecture conflict, or a serious design flaw.
- **Muse Spark 1.2 Contributor** (`meta/muse-spark-1.2-contributor`) is a
  manual/experimental override only. Normalized for the GOAT meter its effective
  consumption is significantly worse than DeepSeek's while the benchmark gain is
  modest, and it still shows intermittent upstream availability errors. Revisit if
  CommandCode increases its allowance or reliability improves.
- **Grok 4.5** (`xai/grok-4.5`) is a manual override only. Its quality gain over Luna
  is too small to justify the `$20` allowance and ~719 requests/month; if we spend a
  `$20`-allowance call automatically, Kimi is the stronger escalation target.

Benchmarks and GOAT capacity are time-sensitive; the routing table in the extension
keeps model IDs and effort in one place so thresholds are easy to update. See the
[CommandCode GOAT routing research note](../docs/research/commandcode-goat-routing.md).

The Copilot matrix and its pricing snapshot are supported by the repository's
[research note](https://github.com/PaoloDelCasale/copilot-minions/blob/main/docs/research/copilot-standard-model-routing.md).
Benchmarks are selection evidence, not guarantees for the Pi or native Copilot
harness. Required-model checks resolve
all IDs against the selected provider's own catalog and never fall back across
providers. CommandCode distinguishes required (run cannot start without these) and
optional (available for explicit override/escalation; absence never blocks startup).
