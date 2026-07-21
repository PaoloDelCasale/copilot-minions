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
update the board, and dispatch the next phase. The frontier uses `ask_user` for one
decision at a time; workers return `NEEDS_USER_INPUT` instead.

