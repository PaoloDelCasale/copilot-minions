# Implement loop

Record `fixed:` (`git rev-parse HEAD` in the task worktree) before implementation.

## Verification contract

Before implementation, discover and record one canonical gate: interpreter/environment,
commands, required external integrations, expected duration, and a sharding plan when
the full suite can exceed worker timeout. Reuse that contract for every slice.

Unavailable required integration tests are not passes. Implementation reports
`DONE_WITH_CONCERNS`; the final post-review gate is `BLOCKED` unless the run contract
explicitly delegates the missing check to a named CI gate and the user accepts it.

## Integration review gate

When work starts from two or more pre-existing branches or partially reviewed commits,
reconcile them first, then run a fresh integrated review before adding functionality.
The reviewer compares the cumulative diff with the complete issue acceptance criteria,
including migrations, authorization invariants, compatibility, rollback, and cross-slice
interactions. Repeat an integrated review before landing the final stack.

1. **Implement** - role `implementer` or `architect`; pass the verify gate and commit.
2. **Review** - fresh role `reviewer`; review commits since `fixed:` without rerunning
   verification. Increment `round:` on the board.
3. `REVIEW_APPROVED` - run the gate, then role `mechanical` commits review fixes or
   reports the unchanged HEAD.
4. `REVIEW_CHANGES_REQUIRED` - if `round:` is below five, respawn an implementer for
   fix-review, then use a fresh reviewer. After the second changes-required result on
   one slice, the next fix uses role `architect` and receives the cumulative findings,
   invariants, and a complete regression-test matrix. At round five, stop and ask the
   user instead of dispatching another fix.

Never resume a worker after `BLOCKED`, `NEEDS_CONTEXT`, environment repair, steering,
or a changed spec. Spawn a fresh worker with the delta folded into the prompt and mark
the previous worker superseded.

## Repository discovery

The frontier supplies `Spec`, `Files`, issue references, and the absolute worktree.
An implementer may use at most one `explorer` for cross-module gaps. If context is
still insufficient, return `STATUS: NEEDS_CONTEXT` with the exact missing path or fact.

One worktree per write task is mandatory; see [`worktrees.md`](worktrees.md).

