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
| `mechanical` | Merge conflict or GitHub judgment | `gpt-5.6-luna` | xhigh |

Pin model and effort on every spawn. Record both in board Notes. A user-requested
model overrides the profile for that batch.

## Named route overrides

| Override | Model | Reasoning | Use |
|----------|-------|-----------|-----|
| `mechanical-judgment` | `gpt-5.6-luna` | xhigh | Mechanical work requiring merge-conflict or GitHub judgment |
| `escalate-entry` | `gpt-5.6-luna` | xhigh | First fresh retry after mediocre output, verification failure, or `BLOCKED` |
| `escalate-sol-low` | `gpt-5.6-sol` | low | First Sol escalation |
| `escalate-sol-medium` | `gpt-5.6-sol` | medium | Last model escalation before splitting or asking the user |

Terra, Sol high, and Sol max escalation routes are intentionally unavailable in the
low-budget profile. A named route override replaces both the role's default model and
reasoning effort. It does not change the worker's role, responsibilities, or tool
permissions.

## Escalation

```text
gpt-5.6-luna xhigh
  -> gpt-5.6-sol low
  -> gpt-5.6-sol medium
  -> split or ask the user
```

