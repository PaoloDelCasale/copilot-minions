# GitHub Copilot low-budget model routing

The profile tries inexpensive Luna first, retains Sol low as an independent review
gate, and permits Grok only as an evidence-backed first escalation. See the
[research note](https://github.com/PaoloDelCasale/copilot-minions/blob/main/docs/research/copilot-low-budget-model-routing.md)
for benchmark and pricing evidence.

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
