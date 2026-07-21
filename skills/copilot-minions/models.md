# Models

Copilot-CLI model routing. Cursor-only models from the original skill are
remapped to Copilot models; rationale in [`model-rationale.md`](model-rationale.md).

| Role | Model |
|------|-------|
| **Frontier** | `gpt-5.6-sol` high — dispatch-only session model (recommendation; a skill cannot change the running session model) — see [`frontier.md`](frontier.md) |
| **Worker** | Per routing below |

Record the worker model in the board `Notes`.

## Route workers

| Work | Model | `task` agent_type |
|------|-------|-------------------|
| Bulk / mechanical implement | `kimi-k2.7-code` | `general-purpose` |
| Complex implement / user-facing UI | `claude-sonnet-5` high | `general-purpose` |
| Review | `claude-opus-4.8` | `code-review` |
| PRD / issues synthesis | `gpt-5.6-terra` high | `general-purpose` |
| Commit | `kimi-k2.7-code` | `task` |
| Shell — PR / `gh` / worktrees / push / issue fetch | `kimi-k2.7-code` | `task` |
| Explore (delegated) | `kimi-k2.7-code` | `explore` |
| Shell — merge conflicts, `gh` judgment | `gpt-5.6-terra` high | `task` |

Notes:
- `kimi-k2.7-code` does **not** support the `reasoning_effort` parameter and runs
  at context tier `default` — fine for mechanical work.
- The `code-review` agent type is Copilot's dedicated reviewer; pin it to
  `claude-opus-4.8` for strict, high-signal review.
- Every spawn uses `mode: "background"` (async inbox).

**Verify gate** — implementers and fix-review run lint / test / typecheck before
`DONE`; reviewers do not. No separate verify spawn.

## Escalation

One tier on mediocre output, verify failure, or `BLOCKED`:

`kimi-k2.7-code` → `claude-sonnet-5` high → `claude-opus-4.8` → split or ask user.

Complex implement starts on `claude-sonnet-5` high; on trouble escalate to
`claude-opus-4.8`; respawn fresh — never resume ([`loop.md`](loop.md) Respawn).

Never escalate the frontier — `gpt-5.6-sol` is dispatch-only.

User says "use X" → override for that batch.
