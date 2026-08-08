# Pi low-budget model routing

Pi selects exactly one matrix from the captured parent provider. Required-model
preflight and route lookup use only that provider's catalog; there is no fallback
across providers. Run start requires every `requiredModels` ID; `optionalModels`
are available for explicit override/escalation only and missing optional models never
block startup.

## `commandcode`

CommandCode low-budget keeps the minimum reasoning quality constraints: **DeepSeek
V4 Flash 0731 always runs at `max`** and **GPT-5.6 Luna never runs below `xhigh`**.
The philosophy: DeepSeek does most of the work; Luna provides the minimum
independent judgment needed to keep quality high.

| Role | Model | Reasoning |
|------|-------|-----------|
| Frontier | `openai/gpt-5.6-luna` | xhigh |
| `mechanical` | `deepseek/deepseek-v4-flash` | max |
| `explorer` | `deepseek/deepseek-v4-flash` | max |
| `implementer` | `deepseek/deepseek-v4-flash` | max |
| `architect` | `openai/gpt-5.6-luna` | xhigh |
| `reviewer` | `openai/gpt-5.6-luna` | xhigh |
| `planner` | `deepseek/deepseek-v4-flash` | max |

- **Muse Spark 1.2 Contributor** is not an automatic route: normalized for the GOAT
  meter its effective consumption is worse than DeepSeek's while the benchmark gain
  is modest, and it still shows intermittent upstream availability errors. It is a
  manual/experimental override only.
- **Kimi K3** is escalation-only (never a normal route); its `$20` GOAT allowance
  (~980 requests/month) makes it too expensive for routine use.
- **Grok 4.5** is a manual override only, never automatic.

Overrides: `mechanical-judgment` uses `deepseek/deepseek-v4-flash` at `max`;
`escalate-entry` uses `openai/gpt-5.6-luna` at `xhigh`; `escalate-sol-low` uses
`openai/gpt-5.6-luna` at `xhigh`; `escalate-sol-medium` uses `openai/gpt-5.6-luna`
at `max`; `escalate-sol-high`/`escalate-sol-max` use `moonshotai/kimi-k3` at `max`
(escalation-only).

## `openai-codex`

| Role | Model | Reasoning |
|------|-------|-----------|
| Frontier | `gpt-5.6-sol` | medium |
| `mechanical` | `gpt-5.6-luna` | high |
| `explorer` | `gpt-5.6-luna` | max |
| `implementer` | `gpt-5.6-luna` | max |
| `architect` | `gpt-5.6-luna` | max |
| `reviewer` | `gpt-5.6-sol` | low |
| `planner` | `gpt-5.6-luna` | max |

These role routes mirror the GitHub Copilot low-budget profile. Overrides:
`mechanical-judgment` uses `gpt-5.6-luna:max`; `escalate-entry` retains
`gpt-5.6-luna:xhigh` instead of the Copilot-only Grok route;
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

Overrides: `mechanical-judgment` and `escalate-entry` use `grok-4.5:high`; `escalate-sol-low` uses `gpt-5.6-sol:low`;
`escalate-sol-medium` uses `gpt-5.6-sol:medium`.

Terra, Sol high, and Sol max escalation routes are unavailable in this profile.
Every spawn pins provider, model, and effort. A user-requested model may override the
model for the next batch only; it must exist under the captured provider. Model-ID
validation is provider/catalog-driven (including `openai/...`, `deepseek/...`,
`meta/...`, `moonshotai/...`, and `xai/...`). The runtime derives this authorization
from raw user input and audits/downgrades any unauthorized `modelOverride` to the
normal role route. Muse/Grok/Kimi overrides are explicit user requests only.

Normal dispatch omits every override field. `mechanical-judgment` requires a
mechanical merge-conflict or GitHub judgment reason. Every escalation requires a
failure-class reason and the ID of a terminal, triaged worker whose recorded result
proves it; complexity alone is never an escalation.
