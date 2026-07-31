# Pi standard model routing

Pi selects exactly one matrix from the captured parent provider. Required-model
preflight and route lookup use only that provider's catalog; there is no fallback.
Run start requires every exact route ID for the active provider; installation does
not. If Pi does not yet expose `github-copilot/grok-4.5`, the run is rejected rather
than substituting another model.

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
| `mechanical` | `grok-4.5` | high |
| `explorer` | `grok-4.5` | high |
| `implementer` | `grok-4.5` | high |
| `architect` | `gpt-5.6-sol` | medium |
| `reviewer` | `gpt-5.6-sol` | low |
| `planner` | `gpt-5.6-terra` | high |

## Named overrides (both providers)

| Override | Model | Reasoning |
|----------|-------|-----------|
| `mechanical-judgment` | `gpt-5.6-sol` | low |
| `escalate-entry` | `gpt-5.6-sol` | medium |
| `escalate-sol-medium` | `gpt-5.6-sol` | medium |
| `escalate-sol-high` | `gpt-5.6-sol` | high |
| `escalate-sol-max` | `gpt-5.6-sol` | max |

Every spawn pins provider, model, and effort. A user-requested model may override the
model for that batch only; it must exist under the captured provider.

`mechanical-judgment` is valid only for a mechanical merge-conflict or GitHub
judgment task. Escalation overrides require a recorded mediocre result,
verification failure, or `BLOCKED`; never use them as a general quality upgrade.
