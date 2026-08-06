# OpenAI Codex low-budget adapter

Use native Codex subagents only; never launch nested `codex exec` processes.

| Core role | Custom agent |
|-----------|--------------|
| `mechanical` | `codex-minions-lb-mechanical` |
| `explorer` | `codex-minions-lb-explorer` |
| `implementer` | `codex-minions-lb-implementer` |
| `architect` | `codex-minions-lb-architect` |
| `reviewer` | `codex-minions-lb-reviewer` |
| `planner` | `codex-minions-lb-planner` |

Spawn named agents for independent tasks and wait for the batch. Never exceed six
in-flight workers. Triage STATUS, update the board, and launch newly unblocked work.
After the soft triage gate, add `Budget class: closure` to each permitted worker
prompt and reject normal or newly scoped tasks; stop all dispatch at the hard gate.
Use `/agent` for user-facing thread inspection.

At scope completion, default to `dispose-on-close`: after reading every final result,
close only current-run native agents. Preserve only exact handoff-listed IDs. A Codex
thread is not evidence of a dedicated resident process; if the client exposes no
terminal disposal control, report the exact IDs as disposal failures/unsupported
instead of claiming cleanup or touching unrelated threads. Report disposed,
preserved, and failed counts.

The frontier asks one decision at a time through the current client's structured
interaction mechanism or one plain-text question. Workers never interview the user.

