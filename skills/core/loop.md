# Implement loop

Record `fixed:` (`git rev-parse HEAD` in the task worktree) before implementation.

## Verification contract

Before implementation, discover and record one canonical gate: interpreter/environment,
commands, required external integrations, expected duration, and a sharding plan when
the full suite can exceed worker timeout. Reuse that contract for every slice.

Run the canonical gate for the initial implementation and once more after final review.
A review fix runs its new regression plus the affected deterministic shards; do not
repeat an unchanged full gate after every fix. Record baseline environment failures once
and compare later results against that baseline. Any fix that changes the verification
contract, crosses a subsystem seam, or invalidates the baseline triggers the full gate
before its next review.

Unavailable required integration tests are not passes. Implementation reports
`DONE_WITH_CONCERNS`; the final post-review gate is `BLOCKED` unless the run contract
explicitly delegates the missing check to a named CI gate and the user accepts it.

## Integration review gate

When work starts from two or more pre-existing branches or partially reviewed commits,
reconcile them first, then run a fresh integrated review before adding functionality.
The reviewer compares the cumulative diff with the complete issue acceptance criteria,
including migrations, authorization invariants, compatibility, rollback, and cross-slice
interactions. Repeat an integrated review before landing the final stack.

## Review lineage

Assign every implementation slice a stable `review-lineage:` before its first review.
The lineage follows the same deliverable across task renames, worktree moves, handoffs,
new orchestration runs, and corrective slices. Its review round and ledger never reset
because the frontier renamed or re-dispatched the work. A new lineage is valid only for
a genuinely independent acceptance criterion starting from a clean approved commit;
when that distinction is ambiguous, ask the user.

Keep the acceptance contract frozen during review. A blocker must trace to an acceptance
criterion, a regression introduced by the lineage, an existing security/fail-closed
invariant, or a direct consequence of a prior fix. Record useful hardening outside that
contract as a landing task or follow-up instead of silently broadening the review.

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

1. **Implement** - role `implementer` or `architect`; pass the canonical verify gate,
   commit, assign `review-lineage:`, and initialize its review ledger. Whenever the
   writer is an architect, record it as `architecture-owner`.
2. **Review** - fresh role `reviewer`; review committed changes since `fixed:` without
   rerunning verification. Increment the lineage's cumulative `round:` on the board.
   The reviewer completes the full review, groups blockers by violated invariant, and
   inspects sibling paths governed by each invariant instead of stopping at the first
   defect.
3. `REVIEW_APPROVED` - run the canonical post-review gate. The tree must already contain
   checkpoint commits for every review fix; a dirty tree is a gate failure, not work for
   an automatic final commit.
4. First `REVIEW_CHANGES_REQUIRED` - spawn a fresh `implementer` for a bounded local fix;
   do not resume the original implementer. Give it the unresolved root findings, review
   ledger, preserved invariants, focused verify delta, and slice-growth budget. The fix
   worker reproduces the issue, commits one local checkpoint, and a fresh reviewer checks
   the cumulative lineage.
5. Second `REVIEW_CHANGES_REQUIRED` - freeze edits and enter **redesign**. Use an
   `architect`; resume an eligible `architecture-owner` only when it has not consumed its
   continuation, otherwise spawn a fresh architect. Before editing, consolidate every
   prior finding by root invariant, inspect sibling paths, map the complete state/
   transaction/boundedness matrix, and decide whether the slice still fits its ownership
   and growth budget. If not, stop and ask the user to approve a re-slice. If it fits,
   implement the redesign, commit a checkpoint, and use a fresh reviewer.
6. At round three, stop and ask the user after any further
   `REVIEW_CHANGES_REQUIRED`. Do not create a corrective task, handoff, worktree, or new
   run to reset the lineage. Report the ledger, commits, unresolved root findings, and
   the smallest re-slice or rollback options.

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

