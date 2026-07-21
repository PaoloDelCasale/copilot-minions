# GitHub Copilot adapter

Map core roles to the `task` tool:

| Core role | `agent_type` |
|-----------|--------------|
| `mechanical` | `task` for commands, otherwise `general-purpose` |
| `explorer` | `explore` |
| `implementer` | `general-purpose` |
| `architect` | `general-purpose` |
| `reviewer` | `code-review` |
| `planner` | `general-purpose` |

Pin `model` and `reasoning_effort` from [`models.md`](models.md). Every spawn uses
`mode: "background"`. Launch independent workers in one response, never exceeding
six in-flight workers.

After launching background work, end the turn. On completion notification, call
`read_agent`, read the STATUS and concise result, update the board, and dispatch the
next phase. Use the returned agent ID for board Notes, steering, and stopping.

The frontier uses `ask_user` for exactly one decision at a time. Workers never call
`ask_user`; they return `STATUS: NEEDS_USER_INPUT`.

Use `powershell` or other available command tools only inside workers. Every worker
scopes commands to the absolute worktree from its prompt.

