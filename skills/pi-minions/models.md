# Pi standard model routing

Pi selects exactly one matrix from the captured parent provider. Required-model
preflight and route lookup use only that provider's catalog; there is no fallback
across providers. Run start requires every `requiredModels` ID for the active
provider; `optionalModels` are available for explicit override/escalation only and
missing optional models never block startup. The frontier is matrix-driven: each
provider/variant defines its own frontier instead of assuming `gpt-5.6-sol`
globally.

## `commandcode`

CommandCode runs on the GOAT plan and expects `CMD_API_KEY` in the environment
(endpoint `https://api.commandcode.ai/provider/v1/chat/completions`). Hard routing
floors: **DeepSeek V4 Flash 0731 always runs at `max`** and **GPT-5.6 Luna never
runs below `xhigh`**. Automatic routing is centered on only two models: Luna for
thinking/architecture/planning/review and DeepSeek for execution. Kimi, Muse, and
Grok are never used by automatic routes.

| Role | Model | Reasoning |
|------|-------|-----------|
| Frontier | `gpt-5.6-luna` | max |
| `mechanical` | `deepseek/deepseek-v4-flash` | max |
| `explorer` | `gpt-5.6-luna` | xhigh |
| `implementer` | `deepseek/deepseek-v4-flash` | max |
| `architect` | `gpt-5.6-luna` | max |
| `reviewer` | `gpt-5.6-luna` | max |
| `planner` | `gpt-5.6-luna` | max |

- **Kimi K3** (`moonshotai/Kimi-K3`) is escalation-only: it is never a normal
  architect/planner route. Use it only after a terminal/triaged worker result
  proves Luna/DeepSeek are insufficient (repeated failure, unresolved architecture
  conflict, serious design flaw). Its `$20` GOAT allowance (~980 requests/month)
  makes it too expensive for routine use.
- **Muse Spark 1.2 Contributor** (`meta/muse-spark-1.2-contributor`) and
  **Grok 4.5** (`xai/grok-4.5`) are manual/experimental override models only. They
  are never used automatically: normalized for the GOAT meter their effective
  consumption is worse than DeepSeek's while their benchmark gain is modest, and
  Muse still shows intermittent upstream availability errors.

## `openai-codex`

| Role | Model | Reasoning |
|------|-------|-----------|
| Frontier | `gpt-5.6-sol` | medium |
| `mechanical` | `gpt-5.6-luna` | low |
| `explorer` | `gpt-5.6-luna` | high |
| `implementer` | `gpt-5.6-luna` | xhigh |
| `architect` | `gpt-5.6-sol` | medium |
| `reviewer` | `gpt-5.6-sol` | low |
| `planner` | `gpt-5.6-terra` | high |

## `github-copilot`

| Role | Model | Reasoning |
|------|-------|-----------|
| Frontier | `gpt-5.6-sol` | medium |
| `mechanical` | `gpt-5.6-luna` | high |
| `explorer` | `claude-opus-5` | high |
| `implementer` | `gpt-5.6-terra` | max |
| `architect` | `claude-opus-5` | xhigh |
| `reviewer` | `gpt-5.6-sol` | high |
| `planner` | `gpt-5.6-terra` | max |

## Named overrides

### `commandcode`

| Override | Model | Reasoning |
|----------|-------|-----------|
| `mechanical-judgment` | `gpt-5.6-luna` | xhigh |
| `escalate-entry` | `gpt-5.6-luna` | max |
| `escalate-sol-medium` | `gpt-5.6-luna` | max |
| `escalate-sol-high` | `moonshotai/Kimi-K3` | max |
| `escalate-sol-max` | `moonshotai/Kimi-K3` | max |

Kimi K3 is reachable **only** through `escalate-sol-high`/`escalate-sol-max`, and
only with a terminal/triaged worker result proving the need. `escalate-sol-low` is
unavailable in this profile (Luna never runs below `xhigh`).

### `openai-codex`

| Override | Model | Reasoning |
|----------|-------|-----------|
| `mechanical-judgment` | `gpt-5.6-sol` | low |
| `escalate-entry` | `gpt-5.6-sol` | medium |
| `escalate-sol-medium` | `gpt-5.6-sol` | medium |
| `escalate-sol-high` | `gpt-5.6-sol` | high |
| `escalate-sol-max` | `gpt-5.6-sol` | max |

### `github-copilot`

| Override | Model | Reasoning |
|----------|-------|-----------|
| `mechanical-judgment` | `gpt-5.6-terra` | max |
| `escalate-entry` | `gpt-5.6-sol` | high |
| `escalate-sol-medium` | `gpt-5.6-sol` | medium |
| `escalate-sol-high` | `gpt-5.6-sol` | high |
| `escalate-sol-max` | `gpt-5.6-sol` | max |

Every spawn pins provider, model, and effort. A user-requested model may override the
model for the next batch only; it must exist under the captured provider. Model-ID
validation is provider/catalog-driven: `openai/...`, `deepseek/...`, `meta/...`,
`moonshotai/...`, and `xai/...` IDs are all valid when authorized. The runtime
derives this authorization from raw user input and audits/downgrades any unauthorized
`modelOverride` to the normal role route. Muse/Grok/Kimi overrides are explicit user
requests only and never change automatic routing.

Normal dispatch omits every override field. `mechanical-judgment` requires a
mechanical merge-conflict or GitHub judgment reason. Every escalation requires a
failure-class reason and the ID of a terminal, triaged worker whose recorded result
proves it; complexity alone is never an escalation.
