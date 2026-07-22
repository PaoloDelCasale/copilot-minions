# Model routing

Use this exact model matrix on every supported platform. Record model and reasoning
effort in board Notes. A user-requested model overrides the matrix for that batch.

| Role | Work | Model | Reasoning |
|------|------|-------|-----------|
| Frontier | Dispatch and triage | `gpt-5.6-sol` | medium |
| `mechanical` | Shell, git, commit, worktree, bulk wiring | `gpt-5.6-luna` | low |
| `explorer` | Read-only repository facts | `gpt-5.6-luna` | high |
| `implementer` | Default feature or bug fix | `gpt-5.6-luna` | xhigh |
| `architect` | Architecture, auth, payments, migrations, tricky logic | `gpt-5.6-sol` | medium |
| `reviewer` | Independent review | `gpt-5.6-sol` | low |
| `planner` | PRD and issue synthesis | `gpt-5.6-terra` | high |
| `mechanical` | Merge conflict or GitHub judgment | `gpt-5.6-sol` | low |

Every spawn pins both model and effort. The platform adapter maps the semantic role to
its native agent type or custom agent.

## Named route overrides

| Override | Model | Reasoning | Use |
|----------|-------|-----------|-----|
| `mechanical-judgment` | `gpt-5.6-sol` | low | Mechanical work requiring merge-conflict or GitHub judgment |
| `escalate-entry` | `gpt-5.6-sol` | medium | First fresh retry after mediocre output, verification failure, or `BLOCKED` |
| `escalate-sol-medium` | `gpt-5.6-sol` | medium | Explicit Sol-medium escalation entry |
| `escalate-sol-high` | `gpt-5.6-sol` | high | High-effort escalation |
| `escalate-sol-max` | `gpt-5.6-sol` | max | Last model escalation before splitting or asking the user |

A named route override replaces both the role's default model and reasoning effort. It
does not change the worker's role, responsibilities, or tool permissions.

## Route discipline

- `mechanical-judgment` is valid only with role `mechanical` and only for its documented
  merge-conflict or GitHub judgment use.
- Escalation overrides require a recorded mediocre result, verification failure, or
  `BLOCKED`; never use one as a general quality upgrade.
- Before spawn, record the expected model and effort. When the adapter exposes the
  actual runtime route, compare it and record it in the board.
- A reported role/route mismatch is a protocol error: stop dispatching and report it
  instead of silently continuing on a different cost profile.

## Escalation

On mediocre output, verify failure, or `BLOCKED`, respawn fresh:

```text
gpt-5.6-sol medium
  -> gpt-5.6-sol high/max
  -> split or ask the user
```

Start at `architect` for work that is clearly complex. Never escalate the frontier
automatically.
