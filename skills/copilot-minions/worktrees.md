# Worktrees

**Branch:** orchestration

One **worktree** per implement task. Parallel tasks never share a directory —
critical in Copilot CLI because background `task` sub-agents share the session
filesystem, so two implementers on the same checkout would collide.

## Dependencies

Spawn only **unblocked** tasks. Independent tasks batch in one turn.

**Stacked base** — when `Blocked by` points at a task with its own worktree, the
new worktree branches from **that task's branch** (after the blocker is `done` and
committed), not from `origin/<base>`.

| Blocked by | Base ref for `git worktree add` |
|------------|----------------------------------|
| — (none) | `origin/<default-branch>` |
| T1 (has `branch:` on board) | T1's `branch:` (local branch name) |

Frontier copies the blocker's `branch:` into the worktree-setup spawn as
`Base ref:`. Record `based-on: T1` in Notes.

```
# Independent
git worktree add .worktrees/<slug> -b <slug> origin/<base-branch>

# Depends on T1 (T1 done, committed on branch issue-138-foo)
git worktree add .worktrees/<slug> -b <slug> <T1-branch>
```

Do not base a dependent task on `origin/main` when the blocker already advanced
the branch in its worktree.

## Setup

Before the first implement: a shell worktree-setup worker
([`prompts.md`](prompts.md) worktree-setup). Pick the base ref per the table
above. Record in board Notes.

**Slug** (lowercase, hyphens): issue title slug, else task ID (`T3` → `t3`).

Frontier resolves the **absolute** worktree path (`<repo-root>/.worktrees/<slug>`)
and passes it in every task spawn. Record on board Notes.

## Scoped cwd

The session working directory is the main checkout. Prompt text alone does not
change a worker's shell cwd; `git status` / `git diff` would run against the wrong
branch.

**Scoped** — every `powershell` call for task work sets `working_directory` to the
spawn's absolute worktree path. If `working_directory` is unavailable, prefix git:
`git -C <abs-worktree> …`.

Read/Grep may use paths under `.worktrees/<slug>/` from the session root; still
run **scoped** git for status, diff, log, commit.

**Preflight** (first shell call per spawn): `pwd; git branch --show-current;
git rev-parse HEAD` with `working_directory` set. **Done when** pwd is the worktree
and the branch matches board `branch:`.

Implementers **commit** before `DONE`. Reviewers diff commits since `fixed:`
(`git diff <fixed>...HEAD`). Fix-review leaves changes uncommitted; the
post-review **commit** is the second commit — see [`loop.md`](loop.md).

## Notes fields

- `worktree: <abs>/.worktrees/<slug>`
- `branch: <slug>`
- `based-on: <blocker-id>` (if stacked)
- `issue: #123`

## Landing (after close)

Ask the user:

1. **Merge** — integration branch, merge in dependency order
2. **Stacked PRs** — one PR per task, stacked bases

Then shell workers ([`shell.md`](shell.md)) — push, `gh pr create`, merge. Frontier
dispatches only.
