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
Use `/agent` for user-facing thread inspection.

The frontier asks one decision at a time through the current client's structured
interaction mechanism or one plain-text question. Workers never interview the user.

