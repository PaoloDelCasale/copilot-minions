# Implement loop

Record `fixed:` (`git rev-parse HEAD` in the task worktree) before implementation.

1. **Implement** - role `implementer` or `architect`; pass the verify gate and commit.
2. **Review** - fresh role `reviewer`; review commits since `fixed:` without rerunning
   verification. Increment `round:` on the board.
3. `REVIEW_APPROVED` - run the gate, then role `mechanical` commits review fixes or
   reports the unchanged HEAD.
4. `REVIEW_CHANGES_REQUIRED` - if `round:` is below five, respawn an implementer for
   fix-review, then use a fresh reviewer. At round five, stop and ask the user.

Never resume a worker after `BLOCKED`, `NEEDS_CONTEXT`, environment repair, steering,
or a changed spec. Spawn a fresh worker with the delta folded into the prompt and mark
the previous worker superseded.

## Repository discovery

The frontier supplies `Spec`, `Files`, issue references, and the absolute worktree.
An implementer may use at most one `explorer` for cross-module gaps. If context is
still insufficient, return `STATUS: NEEDS_CONTEXT` with the exact missing path or fact.

One worktree per write task is mandatory; see [`worktrees.md`](worktrees.md).

