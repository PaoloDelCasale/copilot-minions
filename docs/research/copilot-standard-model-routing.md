# GitHub Copilot standard routing: quality-first model portfolio

**Access date:** 2026-08-04  
**Scope:** GitHub Copilot standard profile only; native Copilot and Pi/Paseo workers;
low-budget and OpenAI Codex matrices are unchanged.

## Decision

Use a role-specialized portfolio rather than routing every task to GPT-5.6 Sol:

| Role | Model | Effort | Selection objective |
|------|-------|--------|---------------------|
| Frontier | `gpt-5.6-sol` | medium | Reliable decomposition at low parent-turn volume |
| Mechanical | `gpt-5.6-luna` | high | Very low token price with enough effort for bounded command work |
| Explorer | `claude-opus-5` | high | Quality-first repository Q&A; xhigh remains reserved for architecture |
| Implementer | `gpt-5.6-terra` | max | Near-frontier DeepSWE result at 40% of Sol's default token prices |
| Architect | `claude-opus-5` | xhigh | Best measured coding-agent composite; use only for ambiguous, low-volume work |
| Reviewer | `gpt-5.6-sol` | high | Strong independent correctness gate and different family from the architect |
| Planner | `gpt-5.6-terra` | max | Strong structured synthesis without Sol pricing |

Named Copilot routes use Terra max for `mechanical-judgment`, Sol high for the first
real escalation, and retain explicit Sol medium/high/max routes. Verification and
fresh review remain mandatory; model selection does not replace those gates.

## Copilot availability

GitHub's supported-model page lists the following current Copilot models. All models
selected above are GA and included in Copilot CLI.

| Provider | Current models listed by GitHub |
|----------|----------------------------------|
| OpenAI | GPT-5 mini, GPT-5.3-Codex, GPT-5.4, GPT-5.4 mini, GPT-5.4 nano, GPT-5.5, GPT-5.6 Luna, GPT-5.6 Sol, GPT-5.6 Terra |
| Anthropic | Claude Fable 5, Haiku 4.5, Opus 4.5/4.6/4.7/4.8/5, Opus 4.8 fast mode, Sonnet 4.5/4.6/5 |
| Google | Gemini 3.1 Pro, Gemini 3.5 Flash, Gemini 3.6 Flash |
| Microsoft / GitHub | MAI-Code-1-Flash, Raptor mini |
| Moonshot AI | Kimi K2.7 Code |
| xAI | Grok 4.5 |

Important qualifications:

- Gemini 3.1 Pro is public preview; the selected routes use GA models only.
- GPT-5.4 nano and Raptor mini are not available in Copilot CLI even though they
  appear in the broader supported-model catalog.
- GPT-5.6 Sol and Claude Opus 5 require Copilot Pro+ (or the documented
  Business/Enterprise availability). The former standard stack already required Sol,
  so this decision does not raise the minimum individual plan above Pro+.
- Pi start-time preflight must resolve the exact IDs `claude-opus-5`,
  `gpt-5.6-luna`, `gpt-5.6-sol`, and `gpt-5.6-terra` under the captured
  `github-copilot` provider. There is no silent substitute.

Source: [GitHub Copilot supported models](https://docs.github.com/en/copilot/reference/ai-models/supported-models).

## Official Copilot token prices

Prices below are GitHub's usage-based prices in USD per one million tokens. They are
the relevant prices for this routing decision; direct OpenAI, Anthropic, or xAI API
prices are not substitutes for Copilot billing.

| Selected or compared model | Input | Cached input | Cache write | Output | Long-context rule |
|----------------------------|------:|-------------:|------------:|-------:|-------------------|
| GPT-5.6 Luna | $0.20 | $0.02 | $0.25 | $1.20 | Above 200K: $0.40 / $0.04 / $0.50 / $1.80 |
| GPT-5.6 Terra | $2.00 | $0.20 | $2.50 | $12.00 | Above 272K: $4.00 / $0.40 / $5.00 / $18.00 |
| Grok 4.5 | $2.00 | $0.50 | n/a | $6.00 | Above 200K: $4.00 / $1.00 / n/a / $12.00 |
| Claude Opus 5 | $5.00 | $0.50 | $6.25 | $25.00 | No separate long-context tier listed |
| GPT-5.6 Sol | $5.00 | $0.50 | $6.25 | $30.00 | Above 272K: $10.00 / $1.00 / $12.50 / $45.00 |

At the default tier:

- Luna costs 4% of Sol for both uncached input and output.
- Terra costs 40% of Sol for uncached input, cached input, cache write, and output.
- Grok costs 40% of Sol for uncached input and 20% for output, although cached input
  costs the same as Sol.
- Opus 5 has the same input/cache prices as Sol and output that is about 17% cheaper.

Source: [GitHub Copilot models and pricing](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing).

## Artificial Analysis coding-agent evidence

The Artificial Analysis Coding Agent Index v1.3 is the simple average of DeepSWE,
Terminal-Bench v2, and SWE-Atlas-QnA. Each benchmark reports task-normalized average
pass@1 over three attempts. The three components map usefully—but not perfectly—to
implementation, terminal agency, and repository understanding.

| Agent/model setting | Index | DeepSWE | SWE-Atlas-QnA | Terminal-Bench v2 | AA cost/task | Wall time |
|---------------------|------:|--------:|--------------:|------------------:|-------------:|----------:|
| Claude Code / Opus 5 xhigh | 66.74% | 60.47% | 54.84% | 84.92% | $8.23 | 1,419 s |
| Codex / Sol max | 66.57% | 68.73% | 43.28% | 87.70% | $7.08 | 610 s |
| Codex / Sol xhigh | 65.09% | 66.96% | 42.20% | 86.11% | $5.24 | 444 s |
| Grok Build / Grok 4.5 high | 64.44% | 59.88% | 48.12% | 85.32% | $2.59 | 992 s |
| Codex / Sol high | 64.11% | 64.90% | 44.89% | 82.54% | $4.14 | 379 s |
| Claude Code / Opus 5 high | 63.37% | 60.77% | 49.19% | 80.16% | $3.80 | 802 s |
| Codex / Terra max | 62.28% | 66.96% | 35.75% | 84.13% | $2.21 | 502 s |
| Codex / Sol medium | 60.61% | 64.01% | 40.05% | 77.78% | $2.99 | 310 s |
| Codex / Luna max | 58.66% | 63.42% | 32.80% | 79.76% | $0.31 | 480 s |
| Codex / Luna high | 51.42% | 53.39% | 29.03% | 71.83% | $0.19 | 339 s |

Artificial Analysis also reports its broader Intelligence Index v4.1 at 60.69 for
Opus 5 max, 58.89 for Sol max, 54.95 for Terra max, 53.83 for Grok 4.5 high, 53.35
for Sonnet 5 max, and 51.24 for Luna max.

Interpretation by role:

- **Explorer:** Opus 5 high scores 49.19% on SWE-Atlas-QnA versus Grok's 48.12%.
  Grok remains better on Terminal-Bench and price, but the standard profile explicitly
  prefers Opus's slightly stronger repository Q&A; xhigh remains reserved for the
  lower-volume architect route.
- **Implementer:** Terra max reaches 66.96% DeepSWE, equal to Sol xhigh in this run,
  while its official Copilot list prices are 60% lower than Sol. Its weaker Q&A score
  is less damaging because implementers receive bounded specs and can request context.
- **Architect:** Opus 5 xhigh has the highest measured coding-agent composite, and
  Opus 5 max leads the broader Intelligence Index. Its cost and wall time rule it out
  for routine roles but are acceptable for ambiguous cross-cutting work.
- **Reviewer:** Sol high is close to the frontier on all three coding components,
  materially stronger than Sol low, and independent from the Opus architect route.
- **Mechanical:** Luna high is not a frontier coding route, but mechanical tasks are
  bounded and verified. High is deliberately retained because Luna medium drops to a
  42.41% coding index while Luna's absolute Copilot price is already very low.
- **Planner:** Terra max is the strongest sub-Sol general model in the selected OpenAI
  family and avoids paying Sol prices for long structured output.

The AA cost/task column is the benchmark's API-cost reconstruction, **not** a Copilot
bill. It is useful for token-efficiency comparisons but must not be multiplied into
Copilot invoices. The official GitHub table above governs Copilot pricing.

Source: [Artificial Analysis coding-agent benchmarks](https://artificialanalysis.ai/agents/coding-agents) and
[Artificial Analysis model benchmarks](https://artificialanalysis.ai/models).

## Models considered but not selected

| Model | Why it is not in the standard matrix |
|-------|--------------------------------------|
| Claude Fable 5 | Strong results, but slightly below Opus/Sol in coding while GitHub lists twice Opus's input and output prices; fallback behavior also complicates attribution. |
| Grok 4.5 | Better terminal score and price than Opus high, but 1.07 points lower on the explorer's primary SWE-Atlas-QnA benchmark. In the low-budget profile it is reserved for evidence-backed escalation after Luna. |
| Claude Sonnet 5 | Attractive $2/$10 input/output pricing, but no matching current coding-agent row and a lower broad Intelligence score than Terra and Grok. Reconsider after a harness-local A/B test. |
| Kimi K2.7 Code | Copilot pricing is attractive, but Artificial Analysis currently shows Kimi K3 agent evidence, not evidence for the exact K2.7 Code route. Do not transfer the score across models. |
| Gemini 3.6 Flash | Very fast and inexpensive, but its broad Intelligence score trails the selected quality routes and there is no matching top coding-agent result. |
| GPT-5.4 mini / GPT-5 mini / Haiku 4.5 | Useful economy models, but Luna is materially cheaper in current Copilot billing and belongs to the same configurable-reasoning family used by the quality routes. |
| Older Opus, Sonnet, GPT, and Codex models | Superseded by stronger current GA models or already listed for retirement. |

## Cost posture and safeguards

This is not an economy profile. It spends heavily where failure is expensive and
saves where verification contains the risk:

1. Sol remains the frontier and review/escalation model.
2. Opus high handles read-only exploration; Opus xhigh is reserved for architecture.
   Both receive a $40 warning, $60 stop, and 50-minute watchdog.
3. Terra max carries implementation and planning instead of Sol max.
4. Luna high carries bounded mechanical work.
5. The $160 default run ceiling, verification gate, fresh reviewer, six-worker limit,
   and no-fallback preflight bound the quality-first profile.

As an illustration only, applying the AA average task costs to a ten-worker mix of
two mechanical, two explorer, three implementer, one architect, one reviewer, and one
planner task gives about $29.18, versus $70.84 if all ten used Sol max in the same AA
harness. This is not a Copilot forecast, but it demonstrates that the portfolio avoids
the obvious “everything on Sol max” outcome while preserving frontier models at the
highest-leverage gates.

## Validation recommendation

Benchmarks compare specific agents and harnesses, not native Copilot or Pi Minions.
After deployment, record by role:

- success after canonical verification;
- review changes required and second-review rate;
- retries, `BLOCKED`, and tool-call failures;
- wall time and observed Copilot cost;
- task size, changed lines, and repository language.

Revisit the matrix after at least 20 representative tasks per high-volume role. The
first challenger should be Sonnet 5 for implementer or reviewer; it should replace a
route only if repository-local verified success is non-inferior, not merely because
its list price is lower.
