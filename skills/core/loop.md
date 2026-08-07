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

## Architecture owner

When an `architect` writes a slice, record its worker ID as the slice's current
`architecture-owner`. Keep every reviewer fresh and independent, but prefer resuming
that completed architect for a later architectural fix when Goal, Spec, `fixed:`, and
worktree are unchanged. Send only the current HEAD, verbatim new findings, cumulative
invariants, regression matrix, and verify delta; the retained worker context already
contains the original discovery and design history.

A continuation still consumes one launch and one triage result. Each worker may receive
at most one continuation; after that, rotate to a fresh worker with a compact handoff.
Resumed workers retain their original budget class, so a normal architecture owner can
be resumed only before the soft closure gate; if it is ineligible, already continued,
or carrying stale context, spawn a fresh closure architect. Never retain an owner merely
to avoid a justified fresh context.

1. **Implement** - role `implementer` or `architect`; pass the verify gate and commit.
   Whenever the writer is an architect, record it as `architecture-owner`.
2. **Review** - fresh role `reviewer`; review commits since `fixed:` without rerunning
   verification. Increment `round:` on the board.
3. `REVIEW_APPROVED` - run the gate, then role `mechanical` commits review fixes or
   reports the unchanged HEAD.
4. `REVIEW_CHANGES_REQUIRED` - if `round:` is below five, spawn a fresh `implementer`
   for a bounded local fix; do not resume the original implementer. Use an `architect`
   when the findings require cross-cutting design, concurrency, transaction, rollback,
   recovery, or security-invariant changes, and always after the second changes-required
   result on one slice. Resume an eligible `architecture-owner` only when it has not yet
   received its single continuation; otherwise spawn a fresh architect. Give it a compact
   handoff containing current HEAD, verbatim findings, cumulative invariants, regression
   matrix, and verify delta—not the prior transcript. Then use a fresh reviewer. At round
   five, stop and ask the user instead of dispatching another fix.

Route post-review gate repairs to the least expensive capable role: environment and
command repair is `mechanical`; assertion, fixture, or compatibility fixes against an
already-established contract are `implementer`; use `architect` only if the product
contract or a cross-cutting invariant must change.

Never resume a worker after `BLOCKED`, `NEEDS_CONTEXT`, environment repair, steering,
or a changed Goal, Spec, fixed point, or worktree. A reviewer delta against the same
slice is not a changed spec. A paused or failed run may consume the worker's one
continuation only when the failure is transient and no contract changed. For every
ineligible or already-continued worker, spawn a fresh worker with a compact delta folded
into the prompt and mark the previous worker superseded.

## Context rotation

Persistent context is a bounded optimization, not durable project memory. Use one
initial execution plus at most one continuation. A fresh worker handoff contains only:
current HEAD and dirty state, Goal/Spec/fixed point, unresolved verbatim findings,
preserved invariants, focused verify commands, and known risks. Keep it under 15 lines
before Constraints, store durable facts on the board, and never paste the old transcript
or repeated command logs. Save full test output outside the repository and return only
the failing excerpts and final summary. Reviewers are always fresh.

## Repository discovery

The frontier supplies `Spec`, `Files`, issue references, and the absolute worktree.
An implementer may use at most one `explorer` for cross-module gaps. If context is
still insufficient, return `STATUS: NEEDS_CONTEXT` with the exact missing path or fact.

One worktree per write task is mandatory; see [`worktrees.md`](worktrees.md).

