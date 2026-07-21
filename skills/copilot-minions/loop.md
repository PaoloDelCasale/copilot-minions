# Loop

**Branch:** orchestration

Per **implement** task: `task` with `agent_type: general-purpose`, pinned `model`,
`mode: "background"`. Worker discipline comes from skills
([`disciplines.md`](disciplines.md)): implement→`implement`, fix-review→`tdd`,
review→`code-review` agent, prd→`to-spec`, issues→`to-tickets` — each with an
inline fallback if not installed.

Record `fixed:` (`git rev-parse HEAD` in the **worktree**) in board Notes before
the first implement spawn.

## Cycle

1. **Implement** — model per [`models.md`](models.md); prompt
   [`prompts.md`](prompts.md) implement. Implementer passes the **verify gate**
   (lint / test / typecheck) and **commits** before `DONE`.
2. **Review** — fresh worker; `agent_type: code-review`, `claude-opus-4.8`; prompt
   [`prompts.md`](prompts.md) review. Diff commits since `fixed:`
   (`git diff <fixed-point>...HEAD`). Reviewer does not re-run verify — trust the
   implementer's one-liner ([`models.md`](models.md)). Increment `round:` on board
   (1-based; first review is `round: 1`).
3. `REVIEW_APPROVED` → gate → **commit** ([`prompts.md`](prompts.md) commit) —
   second commit for fix-review changes, or noop if clean.
4. `REVIEW_CHANGES_REQUIRED` → if `round:` < 5: **fix-review**
   ([`prompts.md`](prompts.md) fix-review) → step 2; if `round:` ≥ 5: escalate to
   user — stop the loop.

**Max 5 reviews** per task. Fresh reviewer each round — never resume the
implementer for review.

## Respawn

After `BLOCKED`, `NEEDS_CONTEXT`, env repair, or `steer` — **respawn** a fresh
worker with the delta in `Spec`. Do not resume a background agent for a pivot; a
fresh spawn keeps the frontier context tight and gives the worker a clean brief.

**Done when:** new spawn ID on board; old spawn marked superseded in Notes.

One worktree per task before step 1 — [`worktrees.md`](worktrees.md). Board Notes:
absolute `worktree:` path before the first implement spawn.

## Repo discovery

Frontier puts context in the spawn spec (`Spec`, `Files`, issue ref). The worker
discovers gaps:

| Implement Model | Rule |
|-----------------|------|
| `kimi-k2.7-code` | Read/Grep on Files first; one explore (`kimi-k2.7-code`) for cross-module gaps |
| `claude-sonnet-5` high | May delegate discovery to one explore (`kimi-k2.7-code`) before editing |

Max 1 explore per task. `NEEDS_CONTEXT` → frontier respawns with the gap in
`Spec` / `Files`.

Prompt: [`prompts.md`](prompts.md) explore.
