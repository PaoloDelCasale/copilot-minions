# Models

Copilot-CLI model routing. Cursor-only models from the original skill are
remapped to Copilot models; rationale in [`model-rationale.md`](model-rationale.md).

Copilot-CLI model routing. **All-GPT-5.6 single-family stack** — Cursor-only models
from the original skill, and the earlier Sonnet/Opus/Kimi choices, are remapped to
the GPT-5.6 family (Sol / Terra / Luna). Rationale in
[`model-rationale.md`](model-rationale.md).

| Role | Model |
|------|-------|
| **Frontier** | `gpt-5.6-sol` medium — dispatch-only session model (recommendation; a skill cannot change the running session model) — see [`frontier.md`](frontier.md) |
| **Worker** | Per routing below |

Record the worker model **and reasoning effort** in the board `Notes`.

## Route workers

| Work | Model | Reasoning | `task` agent_type |
|------|-------|-----------|-------------------|
| Mechanical / bulk (commit, rename, spacing, wiring) | `gpt-5.6-luna` | low | `general-purpose` |
| Explore (delegated repo facts) | `gpt-5.6-luna` | high | `explore` |
| Quick implement (small, well-defined, 1–2 files) | `gpt-5.6-luna` | high | `general-purpose` |
| **Default implement** (feature / bug fix with tests + validation) | `gpt-5.6-luna` | **xhigh** | `general-purpose` |
| Complex up-front (architecture, auth, payments, migrations, tricky logic) | `gpt-5.6-sol` | medium | `general-purpose` |
| Review | `gpt-5.6-sol` | low | `code-review` |
| PRD / issues synthesis | `gpt-5.6-terra` | high | `general-purpose` |
| Commit / shell — PR / `gh` / worktrees / push / issue fetch | `gpt-5.6-luna` | low | `task` |
| Shell — merge conflicts, `gh` judgment | `gpt-5.6-terra` | medium | `task` |

Notes:
- **Reasoning effort is mandatory** on every spawn (Luna/Sol/Terra all accept it) —
  pass `reasoning_effort` on the `task` call. Getting effort right is the main cost
  lever: too low → verify-fail → escalate → pay twice; too high → wasted tokens.
- The `code-review` agent type is Copilot's dedicated reviewer; pin it to
  `gpt-5.6-sol` low — Sol's judgment at low effort is strong and cheap enough for
  a diff pass (an independent Sol reviewer over a Luna implementer catches the
  cheap-model slips).
- Every spawn uses `mode: "background"` (async inbox).

**Verify gate** — implementers and fix-review run lint / test / typecheck before
`DONE`; reviewers do not. No separate verify spawn.

## Escalation

One tier on mediocre output, verify failure, or `BLOCKED`. The ladder climbs by
**model and effort together**:

`gpt-5.6-luna` xhigh → `gpt-5.6-terra` medium → `gpt-5.6-sol` medium → `gpt-5.6-sol` high/max → split or ask user.

Default implement starts on `gpt-5.6-luna` xhigh (cost-optimized daily driver — see
[`model-rationale.md`](model-rationale.md)); on verify-fail / mediocre output escalate
to `gpt-5.6-terra` medium, then `gpt-5.6-sol` medium, then `gpt-5.6-sol` high/max;
respawn fresh — never resume ([`loop.md`](loop.md) Respawn).

**Start higher up-front** when the frontier judges a task complex before spawning —
architecture, auth, payments, migrations, cross-cutting logic go **straight to
`gpt-5.6-sol` medium** (don't pay a throwaway Luna attempt on work that clearly needs
Sol). Luna's sweet spot is well-scoped, clearly-specified slices — which good
tracer-bullet decomposition + a tight spawn spec provide.

Never escalate the frontier — `gpt-5.6-sol` medium is dispatch-only (bump to
high/max manually only for an unusually hard decomposition).

User says "use X" → override for that batch.
