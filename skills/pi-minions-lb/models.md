# Pi low-budget model routing

Pi selects exactly one matrix from the captured parent provider. Required-model
preflight and route lookup use only that provider's catalog; there is no fallback.

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
| `mechanical` | `grok-4.5` | high |
| `explorer` | `grok-4.5` | high |
| `implementer` | `grok-4.5` | high |
| `architect` | `grok-4.5` | high |
| `reviewer` | `gpt-5.6-sol` | low |
| `planner` | `grok-4.5` | high |

Overrides: `mechanical-judgment` and `escalate-entry` use `grok-4.5:high`;
`escalate-sol-low` uses `gpt-5.6-sol:low`; `escalate-sol-medium` uses
`gpt-5.6-sol:medium`.

Terra, Sol high, and Sol max escalation routes are unavailable in this profile.
Every spawn pins provider, model, and effort.

`mechanical-judgment` is valid only for a mechanical merge-conflict or GitHub
judgment task. Escalation overrides require a recorded mediocre result,
verification failure, or `BLOCKED`; never use them as a general quality upgrade.
