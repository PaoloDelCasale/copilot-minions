# OpenAI Codex low-budget model routing

| Role | Model | Reasoning |
|------|-------|-----------|
| Frontier | `gpt-5.6-sol` | medium |
| `mechanical` | `gpt-5.6-luna` | high |
| `explorer` | `gpt-5.6-luna` | max |
| `implementer` | `gpt-5.6-luna` | max |
| `architect` | `gpt-5.6-luna` | max |
| `reviewer` | `gpt-5.6-sol` | low |
| `planner` | `gpt-5.6-luna` | max |

## Named route overrides

| Override | Model | Reasoning |
|----------|-------|-----------|
| `mechanical-judgment` | `gpt-5.6-luna` | max |
| `escalate-entry` | `gpt-5.6-luna` | xhigh |
| `escalate-sol-low` | `gpt-5.6-sol` | low |
| `escalate-sol-medium` | `gpt-5.6-sol` | medium |

The role routes mirror the GitHub Copilot low-budget profile. Codex retains Luna
`xhigh` for `escalate-entry` instead of the Copilot-only Grok override.

Terra, Grok, Sol high, and Sol max escalation routes are unavailable in this profile. Pin
model and effort on every spawn; named overrides replace both values. There is no
cross-provider fallback.

Normal dispatch omits every override field. `mechanical-judgment` requires a
mechanical merge-conflict or GitHub judgment reason. Every escalation requires a
failure-class reason and the ID of a terminal, triaged worker whose recorded result
proves it; complexity alone is never an escalation.
