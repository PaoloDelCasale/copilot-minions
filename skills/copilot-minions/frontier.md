# Frontier

**Branch:** planning | orchestration (dispatch rules apply to both)

**Dispatch-only frontier** — recommended session model `gpt-5.6-sol` medium. **Tight**
turns: board, spawn specs, STATUS triage, short user Q&A.

> In Copilot CLI the frontier is the **main session agent** (the one reading this
> skill and calling `task`). A skill cannot change the session's model, so
> `gpt-5.6-sol` medium is a *recommendation* — run the orchestrator session with it.
> The skill still works with any capable session model.

## Frontier may do (only these)

| Work | Behaviour |
|------|-----------|
| **Grilling** | One question at a time (via `ask_user`, skill `grilling`); workers cannot see the thread |
| **User Q&A** | Confirm seams, slice granularity, approve/reject drafts — one question per turn |
| **Relay worker questions** | A worker `STATUS: NEEDS_USER_INPUT` → ask the user (via `ask_user`, one line), then respawn the worker with the answer folded into `Spec`. Workers never call `ask_user` themselves — only the frontier does |
| **Dispatch** | Decompose, write spawn specs, triage STATUS + one line, post board |

The frontier spawns workers only — no direct `view`, `grep`, `powershell`, or repo
reads for task work. Paths go in the spawn `Files:`; issue bodies via a shell
worker or an issue ref in the spec.

## Workers handle everything else

Files, explore, CLI, synthesis, implement, review, commit, publish → spawn per
[`models.md`](models.md) [`prompts.md`](prompts.md) [`shell.md`](shell.md).

PRD / issues synthesis → `gpt-5.6-terra` high worker (`general-purpose`) when
context fits the spawn prompt ([`prompts.md`](prompts.md)). Frontier quizzes
drafts; a shell worker publishes after approval.

## Planning workflow

```
grill (frontier, tight, via ask_user)
  → explore worker (`gpt-5.6-luna` high) if PRD/issues need repo facts
  → prd worker (gpt-5.6-terra high) — context in prompt
  → frontier: confirm seams / PRD (short)
  → issues worker (gpt-5.6-terra high) — approved PRD in prompt
  → frontier: confirm granularity / deps (short)
  → shell worker (`gpt-5.6-luna` low): publish
  → orchestrate
```

**Keep on the frontier** only when live back-and-forth cannot batch (mid-grill,
first-pass slice quiz).

## Orchestration dispatch

Frontier writes spawn specs; workers explore if needed ([`loop.md`](loop.md)). Do
not spawn a separate explore from the frontier for implement work — the
implementer does its own bounded discovery.

Worktree spawns: absolute path + **scoped** shell cwd
([`worktrees.md`](worktrees.md) Scoped cwd).

## Mode detection

**Planning** — deliverable is a PRD or issues, not shipped code.

**Orchestration** — user wants code built. Published issues become worker specs.

"Go build it" / "orchestrate" → orchestration.
