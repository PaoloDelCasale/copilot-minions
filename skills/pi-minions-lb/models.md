# Pi low-budget model routing

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
| `explorer` | `gpt-5.6-luna` | medium |
| `implementer` | `gpt-5.6-luna` | high |
| `architect` | `gpt-5.6-luna` | high |
| `reviewer` | `gpt-5.6-sol` | low |
| `planner` | `gpt-5.6-luna` | high |

Overrides: `mechanical-judgment` and `escalate-entry` use `gpt-5.6-luna:xhigh`;
`escalate-sol-low` uses `gpt-5.6-sol:low`; `escalate-sol-medium` uses
`gpt-5.6-sol:medium`.

## `github-copilot`

| Role | Model | Reasoning |
|------|-------|-----------|
| Frontier | `gpt-5.6-sol` | medium |
| `mechanical` | `gpt-5.6-luna` | high |
| `explorer` | `gpt-5.6-luna` | max |
| `implementer` | `gpt-5.6-luna` | max |
| `architect` | `gpt-5.6-luna` | max |
| `reviewer` | `gpt-5.6-sol` | low |
| `planner` | `gpt-5.6-luna` | max |

Overrides: `mechanical-judgment` uses `gpt-5.6-luna:max`; `escalate-entry`
uses `grok-4.5:high`; `escalate-sol-low` uses `gpt-5.6-sol:low`;
`escalate-sol-medium` uses `gpt-5.6-sol:medium`.

Terra, Sol high, and Sol max escalation routes are unavailable in this profile.
Every spawn pins provider, model, and effort.

Normal dispatch omits every override field. `mechanical-judgment` requires a
mechanical merge-conflict or GitHub judgment reason. Every escalation requires a
failure-class reason and the ID of a terminal, triaged worker whose recorded result
proves it; complexity alone is never an escalation.
