# GitHub Copilot model routing

The standard profile is quality-first, but assigns each role the least expensive
model that remains strong on its relevant coding-agent benchmark. See the
[research and pricing snapshot](https://github.com/PaoloDelCasale/copilot-minions/blob/main/docs/research/copilot-standard-model-routing.md)
for the supporting evidence.

| Role | Model | Reasoning |
|------|-------|-----------|
| Frontier | `gpt-5.6-sol` | medium |
| `mechanical` | `gpt-5.6-luna` | high |
| `explorer` | `claude-opus-5` | high |
| `implementer` | `gpt-5.6-terra` | max |
| `architect` | `claude-opus-5` | xhigh |
| `reviewer` | `gpt-5.6-sol` | high |
| `planner` | `gpt-5.6-terra` | max |

## Named route overrides

| Override | Model | Reasoning |
|----------|-------|-----------|
| `mechanical-judgment` | `gpt-5.6-terra` | max |
| `escalate-entry` | `gpt-5.6-sol` | high |
| `escalate-sol-medium` | `gpt-5.6-sol` | medium |
| `escalate-sol-high` | `gpt-5.6-sol` | high |
| `escalate-sol-max` | `gpt-5.6-sol` | max |

Pin model and effort on every spawn. A user-requested model overrides the matrix for
that batch. Named overrides replace both values and never change role permissions.
There is no cross-provider fallback.

Normal dispatch omits every override field. `mechanical-judgment` requires a
mechanical merge-conflict or GitHub judgment reason. Every escalation requires a
failure-class reason and the ID of a terminal, triaged worker whose recorded result
proves it; complexity alone is never an escalation.
