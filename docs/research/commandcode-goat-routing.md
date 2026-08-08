# CommandCode GOAT provider routing for Pi Minions

Status: research note for issue #42. Benchmarks and GOAT capacity are time-sensitive
and should be re-validated before relying on the exact numbers.

## Goal

Add **CommandCode** as a first-class provider for `pi-minions`, with routing optimized
specifically for the **GOAT** plan rather than raw API token prices. The routing
targets **medium/high usage** and preserves the current behavior for `openai-codex`
and `github-copilot`.

The updated strategy is intentionally simple:

- **DeepSeek V4 Flash 0731 = high-volume workhorse, always `max`**
- **GPT-5.6 Luna = judgment/frontier/review/architecture, never below `xhigh`**
- **Kimi K3 = rare high-value escalation only**
- **Muse Spark 1.2 Contributor = manual/experimental override only for now**
- **Grok 4.5 = manual override only; no automatic route**

## Important: GOAT allowance is model-specific

GOAT shows a shared monthly usage meter (currently `$70` total in the UI), but each
model has a different effective model allowance. At the time of this research,
relevant values are approximately:

| Model | Model allowance | Effective meter factor vs $70 | Estimated requests/month |
|---|---:|---:|---:|
| **GPT-5.6 Luna** | **$70** | **1.00x** | ~51,800 |
| **DeepSeek V4 Flash 0731** | **$60** | **1.17x** | ~195,000 |
| GLM-5.2 | $70 | 1.00x | ~4,740 |
| MiniMax M3 | $47 | ~1.49x | — |
| MiMo V2.5 | $30 | ~2.33x | — |
| **Muse Spark 1.2 Contributor** | **$20** | **3.50x** | ~90,900 |
| **Kimi K3** | **$20** | **3.50x** | ~980 |
| **Grok 4.5** | **$20** | **3.50x** | ~719 |

Source: https://commandcode.ai/docs/plans/goat

The practical implication is that raw `$ / 1M tokens` is not enough to choose the best
GOAT model. A `$20`-allowance model erodes the shared meter much faster than Luna,
while DeepSeek is only modestly penalized relative to Luna. This changes the earlier
routing recommendation substantially.

## Real-world usage evidence

Observed usage with almost exclusively DeepSeek V4 Flash:

- ~112.8M total tokens
- ~978 runs
- only ~$0.71 shown on the `$70` monthly GOAT meter

This strongly supports using DeepSeek as the default high-volume worker for Minions.
Its very low cache-read cost and large GOAT allowance make it exceptionally efficient
for agentic workloads with repeated repository context.

## Benchmark snapshot

Use the **latest DeepSeek V4 Flash 0731/latest release**, not the older Flash version.

Approximate current positioning:

| Model | Intelligence | Coding | Terminal | Long context | GOAT role |
|---|---:|---:|---:|---:|---|
| **Kimi K3** | ~57.1 | ~76.2 | ~85.0 | ~74.7 | rare escalation |
| Muse Spark 1.2 Contributor | ~54.1 | ~72.2 | ~80.1 | ~64.7 | manual/experimental only |
| Grok 4.5 | ~53.8 | ~72.4 | ~81.6 | ~67.7 | manual second opinion only |
| **GPT-5.6 Luna** | ~51.2 | ~71.4 | ~80.9 | **~74.0** | judgment/frontier/review |
| **DeepSeek V4 Flash 0731** | ~50.0 | ~69.1 | ~78.7 | ~65.7 | default worker |
| GLM-5.2 | ~51.1 | ~68.8 | ~77.9 | ~71.3 | not preferred |

References:

- https://commandcode.ai/models/deepseek-v4-flash
- https://commandcode.ai/models/gpt-5-6-luna
- https://commandcode.ai/models/kimi-k3
- https://commandcode.ai/models/muse-spark-1-2-contributor
- https://commandcode.ai/models/grok-4-5
- https://commandcode.ai/models/glm-5-2
- https://artificialanalysis.ai/articles/deepseek-v4-flash-0731-scores-50-on-the-artificial-analysis-intelligence-index-10-points-above-previous-deepseek-v4-flash

### Why DeepSeek 0731 wins the high-volume role

DeepSeek gives up only a small amount of coding/terminal quality versus Luna, but the
GOAT calculator estimates roughly **3.8x more requests/month**. For Minions, this
makes DeepSeek the right model for the majority of
implementation/exploration/mechanical work.

### Why Luna wins judgment roles

Luna is stronger overall, especially on long-context work, and has the full `$70`
model allowance. Use Luna when the worker's main value is: deciding what to do,
understanding large repository context, architecture, review, validating DeepSeek
output, or frontier/orchestrator decisions.

### Why Kimi should not be a normal architect/planner route

Kimi is clearly the strongest of the selected models, but its `$20` GOAT allowance and
~980 estimated requests/month make it too expensive for routine use. Use Kimi only
when previous workers provide concrete evidence that Luna is insufficient, for
example: repeated implementation failure, verification failure after retry,
unresolved architecture conflict, a reviewer finding a serious design flaw, or Luna
producing a mediocre/uncertain result on a genuinely high-value decision.

### Why Muse should leave automatic routing

Muse Contributor has attractive nominal token pricing, but only a `$20` GOAT
allowance. After normalizing for the GOAT meter, its effective consumption is
significantly worse than DeepSeek's, while its benchmark gain is modest. It has also
shown intermittent upstream availability errors. Therefore:

- do **not** use Muse as the default LB implementer
- do **not** require Muse for provider preflight
- keep it available as an explicit user override / experiment
- revisit if CommandCode increases its GOAT allowance or serving reliability improves

### Why Grok should leave automatic routing

Grok's quality gain over Luna is too small to justify the `$20` allowance and ~719
estimated requests/month. If we want to spend a `$20`-allowance call automatically,
Kimi is a much stronger escalation target. Keep Grok only for explicit user-requested
independent/adversarial second opinions.

## Hard routing constraints

For CommandCode automatic routing:

- **GPT-5.6 Luna must never run below `xhigh` (Extra High)**
- **DeepSeek V4 Flash 0731 must always run at `max`**
- Kimi K3 is escalation-only
- Muse and Grok are not used in normal automatic routes

These constraints are enforced by tests, not just documentation.

## Recommended CommandCode matrices

### `commandcode` / `lb`

Goal: maximize throughput for small/medium tasks while keeping independent judgment
where it matters.

| Role | Model | Reasoning |
|---|---|---:|
| **Frontier** | GPT-5.6 Luna | **xhigh** |
| `mechanical` | **DeepSeek V4 Flash 0731** | **max** |
| `explorer` | **DeepSeek V4 Flash 0731** | **max** |
| `implementer` | **DeepSeek V4 Flash 0731** | **max** |
| `architect` | GPT-5.6 Luna | **xhigh** |
| `reviewer` | GPT-5.6 Luna | **xhigh** |
| `planner` | **DeepSeek V4 Flash 0731** | **max** |

Escalation:

1. Luna `max`
2. Kimi K3 `max` only after a terminal/triaged worker result proves the need

Expected philosophy:

> **DeepSeek does most of the work; Luna provides the minimum independent judgment
> needed to keep quality high.**

### `commandcode` / `standard`

Goal: higher quality for important work while still avoiding wasteful use of expensive
GOAT models.

| Role | Model | Reasoning |
|---|---|---:|
| **Frontier** | **GPT-5.6 Luna** | **max** |
| `mechanical` | DeepSeek V4 Flash 0731 | **max** |
| `explorer` | **GPT-5.6 Luna** | **xhigh** |
| `implementer` | **DeepSeek V4 Flash 0731** | **max** |
| `architect` | **GPT-5.6 Luna** | **max** |
| `reviewer` | **GPT-5.6 Luna** | **max** |
| `planner` | **GPT-5.6 Luna** | **max** |

Escalation:

1. Luna `max`
2. **Kimi K3 `max`** for a genuinely hard/failed case backed by a previous worker
   result

Expected philosophy:

> **Luna decides -> DeepSeek implements -> Luna verifies -> Kimi only if the evidence
> says Luna/DeepSeek are not enough.**

This is preferred over using Kimi as the normal architect/planner because it preserves
far more GOAT capacity under medium/high usage.

## Proposed architecture change

The current implementation assumes provider affinity but hard-codes `gpt-5.6-sol` as
the frontier in multiple places. The provider matrix is generalized so each
provider/variant defines its own frontier and effort:

```text
provider
  └─ variant
       ├─ frontier: model + effort
       ├─ requiredModels
       ├─ optionalModels
       ├─ routes
       └─ overrides/escalations
```

`minions_start`, model locking, restoration and status messages derive the frontier
from this matrix rather than hard-coding Sol.

## CommandCode provider integration in Pi

Register a dedicated `commandcode` provider.

- Endpoint: `https://api.commandcode.ai/provider/v1/chat/completions`
- Credential: `CMD_API_KEY`
- Never persist the API key in repository config, run state, logs or worker snapshots.

Candidate model IDs to verify against the live catalog during implementation:

```text
gpt-5.6-luna
deepseek/deepseek-v4-flash
moonshotai/Kimi-K3
meta/muse-spark-1.2-contributor
xai/grok-4.5
```

Docs:

- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/custom-provider.md
- https://commandcode.ai/docs/provider
- https://commandcode.ai/docs/plans/goat

### GOAT / Provider API preflight

There has been documentation inconsistency between the GOAT page and generic Provider
API page regarding external API access. The implementation performs a small provider
preflight and surfaces actionable errors for: 401 invalid key, 403 plan/access
restriction, missing model, and transient upstream failures — not generic Minions
routing failures.

## Model override parsing

Replaces the current `gpt|claude|grok` prefix regex with provider/catalog-driven
validation. Examples valid when explicitly requested by the user:

```text
/minions usa deepseek/deepseek-v4-flash
/minions usa moonshotai/Kimi-K3
/minions usa meta/muse-spark-1.2-contributor
/minions usa xai/grok-4.5
```

The existing security rule is kept: the exact model override must still be authorized
by raw user input. Normal automatic routing still enforces Luna >= `xhigh` and
DeepSeek = `max`.

## Required vs optional models

- `requiredModels` -> run cannot start without these
- `optionalModels` -> available for explicit override/escalation but not required to
  start

Recommended CommandCode requirements:

- LB required: GPT-5.6 Luna, DeepSeek V4 Flash 0731
- Standard required: GPT-5.6 Luna, DeepSeek V4 Flash 0731
- Optional: Kimi K3, Muse Spark 1.2 Contributor, Grok 4.5

If Kimi is unavailable, escalation remains on Luna `max` rather than preventing the
run from starting.

## GOAT-aware budgets

Do not treat public token price as equivalent to GOAT meter consumption. The
CommandCode model metadata represents a GOAT allowance / equivalent weighting
(conceptually `goatAllowanceUsd` and `goatMeterFactor = 70 / allowance`). This is not
a billing engine, but it prevents routing decisions/watchdogs from incorrectly
assuming every model consumes the `$70` pool 1:1.

Recommended policy:

- DeepSeek: broadest worker allowance
- Luna: normal/high allowance
- Kimi: strict escalation budget
- Muse/Grok: no automatic spend

Preserve real provider-reported cost data when available.
