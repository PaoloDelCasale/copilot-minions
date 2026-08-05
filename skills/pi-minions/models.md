# Pi standard model routing

Pi selects exactly one matrix from the captured parent provider. Required-model
preflight and route lookup use only that provider's catalog; there is no fallback.
Run start requires every exact route ID for the active provider; installation does
not. If Pi does not expose every model in the selected matrix, the run is rejected
rather than substituting another model.

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
model for the next batch only; it must exist under the captured provider. The runtime
derives this authorization from raw user input and audits/downgrades any unauthorized
`modelOverride` to the normal role route.

Normal dispatch omits every override field. `mechanical-judgment` requires a
mechanical merge-conflict or GitHub judgment reason. Every escalation requires a
failure-class reason and the ID of a terminal, triaged worker whose recorded result
proves it; complexity alone is never an escalation.
