# GitHub Copilot low-budget model routing

| Role | Model | Reasoning |
|------|-------|-----------|
| Frontier | `gpt-5.6-sol` | medium |
| `mechanical` | `grok-4.5` | high |
| `explorer` | `grok-4.5` | high |
| `implementer` | `grok-4.5` | high |
| `architect` | `grok-4.5` | high |
| `reviewer` | `gpt-5.6-sol` | low |
| `planner` | `grok-4.5` | high |

## Named route overrides

| Override | Model | Reasoning |
|----------|-------|-----------|
| `mechanical-judgment` | `grok-4.5` | high |
| `escalate-entry` | `grok-4.5` | high |
| `escalate-sol-low` | `gpt-5.6-sol` | low |
| `escalate-sol-medium` | `gpt-5.6-sol` | medium |

Terra, Sol high, and Sol max escalation routes are unavailable in this profile. Pin
model and effort on every spawn; named overrides replace both values. There is no
cross-provider fallback.

`mechanical-judgment` is valid only for a mechanical merge-conflict or GitHub
judgment task. Escalation overrides require a recorded mediocre result,
verification failure, or `BLOCKED`; never use them as a general quality upgrade.
