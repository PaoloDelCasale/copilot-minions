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
At scope completion, default to `dispose-on-close`: after all final results are read,
close/stop only terminal agent IDs owned by the current run when the native client
exposes that lifecycle control. Preserve only exact IDs recorded for handoff. Copilot
may host a terminal agent without a dedicated local process, so thread persistence
alone does not prove Paseo's resident-memory leak. If terminal disposal is unavailable,
report the exact IDs as disposal failures/unsupported rather than claiming cleanup or
targeting unrelated agents. Report disposed, preserved, and failed counts.
After the soft triage gate, add `Budget class: closure` to each permitted worker
prompt and reject every normal or newly scoped task; stop all dispatch at the hard gate.

The frontier uses `ask_user` for exactly one decision at a time. Workers never call
`ask_user`; they return `STATUS: NEEDS_USER_INPUT`.

Use `powershell` or other available command tools only inside workers. Every worker
scopes commands to the absolute worktree from its prompt.

