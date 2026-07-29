# OpenAI Codex model routing

| Role | Model | Reasoning |
|------|-------|-----------|
| Frontier | `gpt-5.6-sol` | medium |
| `mechanical` | `gpt-5.6-luna` | low |
| `explorer` | `gpt-5.6-luna` | high |
| `implementer` | `gpt-5.6-luna` | xhigh |
| `architect` | `gpt-5.6-sol` | medium |
| `reviewer` | `gpt-5.6-sol` | low |
| `planner` | `gpt-5.6-terra` | high |

## Named route overrides

| Override | Model | Reasoning |
|----------|-------|-----------|
| `mechanical-judgment` | `gpt-5.6-sol` | low |
| `escalate-entry` | `gpt-5.6-sol` | medium |
| `escalate-sol-medium` | `gpt-5.6-sol` | medium |
| `escalate-sol-high` | `gpt-5.6-sol` | high |
| `escalate-sol-max` | `gpt-5.6-sol` | max |

Pin model and effort on every spawn. A user-requested model overrides the matrix for
that batch. Named overrides replace both values and never change role permissions.
There is no cross-provider fallback.

`mechanical-judgment` is valid only for a mechanical merge-conflict or GitHub
judgment task. Escalation overrides require a recorded mediocre result,
verification failure, or `BLOCKED`; never use them as a general quality upgrade.
