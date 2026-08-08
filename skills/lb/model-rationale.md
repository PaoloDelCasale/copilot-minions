# Low-budget model rationale

This profile is inspired by the economical role routing in
`nsEytgXm/subagents_configs`, with provider-specific matrices:

- OpenAI Codex remains Luna-first: Luna high for mechanical work and Luna max for
  exploration, implementation, architecture, and planning;
- GitHub Copilot uses Grok 4.5 high for all ordinary worker roles except review;
- both providers use Sol low for an independent review family;
- GitHub Copilot retains Grok high for `mechanical-judgment` and `escalate-entry`,
  while OpenAI Codex uses Luna max and Luna xhigh respectively.

Artificial Analysis reports Grok 4.5 high at 64.44% on its Coding Agent Index,
48.12% on SWE-Atlas-QnA, and 85.32% on Terminal-Bench v2. The Copilot matrix favors
those broader repository-understanding and terminal-agency results despite Grok's
higher observed cost and latency. Mandatory verification and independent Sol review
remain unchanged.

The frontier remains Sol medium because it owns decomposition and user decisions.
Unlike the source configuration, this profile does not split validation into a
separate agent or make review selective.

## CommandCode low-budget

CommandCode lb (GOAT plan, `CMD_API_KEY`) maximizes throughput for small/medium
tasks while keeping independent judgment where it matters. DeepSeek V4 Flash 0731
does most of the work and always runs at `max`; GPT-5.6 Luna provides the minimum
independent judgment and never runs below `xhigh`.

| Role | Model | Effort |
|------|-------|--------|
| Frontier | `gpt-5.6-luna` | xhigh |
| `mechanical` | `deepseek/deepseek-v4-flash` | max |
| `explorer` | `deepseek/deepseek-v4-flash` | max |
| `implementer` | `deepseek/deepseek-v4-flash` | max |
| `architect` | `gpt-5.6-luna` | xhigh |
| `reviewer` | `gpt-5.6-luna` | xhigh |
| `planner` | `deepseek/deepseek-v4-flash` | max |

Escalation: Luna `max`, then Kimi K3 (`moonshotai/Kimi-K3`) `max` only after a
terminal/triaged worker result proves the need. Kimi, Muse Contributor, and Grok
are never used by automatic routes; Muse and Grok remain manual/experimental
overrides while their GOAT allowance and reliability make automatic routing
unattractive. See
[`../docs/research/commandcode-goat-routing.md`](../docs/research/commandcode-goat-routing.md).

