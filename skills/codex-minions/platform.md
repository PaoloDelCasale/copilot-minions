# OpenAI Codex adapter

Use Codex native subagent workflows only. Never launch nested `codex exec` processes.
Map core roles to installed custom agents:

| Core role | Custom agent |
|-----------|--------------|
| `mechanical` | `codex-minions-mechanical` |
| `explorer` | `codex-minions-explorer` |
| `implementer` | `codex-minions-implementer` |
| `architect` | `codex-minions-architect` |
| `reviewer` | `codex-minions-reviewer` |
| `planner` | `codex-minions-planner` |

Ask Codex to spawn the named agents for independent tasks and wait for the batch.
Never exceed six in-flight workers. Triage the returned STATUS summaries, update the
board, and launch newly unblocked work. Use `/agent` only as a user-facing way to
inspect or switch threads; steer, stop, and close agents through native session
controls.

The frontier asks exactly one decision and waits. Use a structured interaction tool
when the current client exposes one; otherwise ask one plain-text question and end the
turn. Workers never interview the user and return `STATUS: NEEDS_USER_INPUT`.

Subagents inherit live parent approvals. The installed custom agents set read-only
defaults for explorer, reviewer, and planner, and workspace-write defaults for write
roles. Every command remains scoped to its assigned worktree.

