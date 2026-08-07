# GitHub Copilot low-budget model routing

The profile uses Grok 4.5 high for ordinary worker roles and retains Sol low as an
independent review gate. See the
[research note](https://github.com/PaoloDelCasale/copilot-minions/blob/main/docs/research/copilot-low-budget-model-routing.md)
for benchmark and pricing evidence.

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

Normal dispatch omits every override field. `mechanical-judgment` requires a
mechanical merge-conflict or GitHub judgment reason. Every escalation requires a
failure-class reason and the ID of a terminal, triaged worker whose recorded result
proves it; complexity alone is never an escalation.
