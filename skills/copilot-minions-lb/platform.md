# GitHub Copilot low-budget adapter

Map core roles to the `task` tool:

| Core role | `agent_type` |
|-----------|--------------|
| `mechanical` | `task` for commands, otherwise `general-purpose` |
| `explorer` | `explore` |
| `implementer` | `general-purpose` |
| `architect` | `general-purpose` |
| `reviewer` | `code-review` |
| `planner` | `general-purpose` |

Pin the low-budget model and reasoning effort from [`models.md`](models.md). Every
spawn uses `mode: "background"`. Launch at most six independent workers.

After launching, end the turn. On notification, call `read_agent`, triage STATUS,
update the board, and dispatch the next phase. At scope completion, default to
`dispose-on-close`: after reading every final result, close/stop only terminal agent
IDs owned by the current run when the native client exposes that control. Preserve
only exact handoff-listed IDs. Hosted thread persistence does not itself prove a local
resident-process leak; unsupported disposal is reported by exact ID rather than
claimed as cleanup. Report disposed, preserved, and failed counts. After the soft
triage gate, add `Budget class: closure` to each permitted worker prompt and reject normal or newly
scoped tasks; stop all dispatch at the hard gate. The frontier uses `ask_user` for
one decision at a time; workers return `NEEDS_USER_INPUT` instead.

