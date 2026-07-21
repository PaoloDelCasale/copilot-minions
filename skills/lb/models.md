# Low-budget model routing

This profile changes only model cost routing. The workflow, verify gate, mandatory
review loop, board, STATUS protocol, and worktree isolation remain unchanged.

| Role | Work | Model | Reasoning |
|------|------|-------|-----------|
| Frontier | Dispatch and triage | `gpt-5.6-sol` | medium |
| `mechanical` | Shell, git, commit, worktree, bulk wiring | `gpt-5.6-luna` | low |
| `explorer` | Read-only repository facts | `gpt-5.6-luna` | medium |
| `implementer` | Default feature or bug fix | `gpt-5.6-luna` | high |
| `architect` | Complex and cross-cutting implementation | `gpt-5.6-luna` | high |
| `reviewer` | Independent mandatory review | `gpt-5.6-sol` | low |
| `planner` | PRD and issue synthesis | `gpt-5.6-luna` | high |

Pin model and effort on every spawn. Record both in board Notes. A user-requested
model overrides the profile for that batch.

## Escalation

```text
gpt-5.6-luna high
  -> gpt-5.6-sol medium
  -> gpt-5.6-sol high/max
  -> split or ask the user
```

