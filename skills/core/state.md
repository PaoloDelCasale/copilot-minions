# Board

The board is the platform-neutral source of truth and is posted in the main thread.
Use a delta board after spawn or triage. Use a full board for decomposition, steering,
close, status requests, and session handoff.

Every full board starts with the run contract from [`control.md`](control.md):

```text
## Run
Goal: <one bounded deliverable>
Done when: <observable criteria>
Out of scope: <adjacent work>
Fixed point: <branch/SHA or discovery pending>
Verify: <canonical commands or discovery pending>
Triage: <worker results>/50 (soft closure at 40)
Workers: <launched>/50
Worker retention: dispose-on-close | preserve-for-handoff
Lifecycle: active | closure | draining | handoff | closed
```

Counters are mandatory state. Increment Triage per worker result, not per read call,
and Workers per launch. A status response always includes the full Run block and the
full board.

```text
## Board
| ID | Type | Phase | Status | Blocked by | Notes |
|----|------|-------|--------|------------|-------|
| T1 | implement | review | in-flight | - | branch, worktree, model, worker |
```

Notes include worktree, branch, `based-on:`, `fixed:`, issue, model and effort,
`round:` (maximum five), native worker/thread ID, verify result, commit SHA, and final
worker disposition (`disposed`, `preserved`, or `disposal-failed`). A preserved row
also records its retention reason, worktree, branch, fixed point, and next action; a
failed disposal records the bounded error. A named route also records `overrideReason` and `overrideFromWorkerId` when applicable;
a rejected request records `requestedRouteOverride` and `routeOverrideRejection`.
When an architect writes a slice, also record it as the current
`architecture-owner: <worker ID>` and retain it across review rounds. A resumed owner
keeps that ID; record `continuations: 1/1`, and rotate to a fresh worker for any later
fix. Each execution still increments Workers and each result increments Triage. Keep
done and cancelled rows through close. The final board includes disposed,
preserved, and failed worker IDs and counts.

Phases:

```text
implement -> review -> fix -> review ... -> gate -> commit -> landing -> done
```

The inbox is an abstraction. The platform adapter explains how worker results arrive,
but every worker must end with one core STATUS value.

