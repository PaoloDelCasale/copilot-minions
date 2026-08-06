# Orchestration control gate

This is the mandatory pre-spawn and lifecycle gate. Apply it before every worker
spawn; a board row alone does not authorize dispatch.

## Run contract

Before the first spawn, post a full run contract:

```text
Goal: <one bounded deliverable>
Done when: <observable completion criteria>
Out of scope: <adjacent work not authorized>
Fixed point: <branch/SHA or discovery pending>
Verify contract: <canonical commands or discovery pending>
Triage budget: 0/8 soft; 0/30 hard
Worker budget: 0/30 launches
Cost budget: $0 / model-aware worker ceiling; $0 / run ceiling
Worker retention: dispose-on-close
Lifecycle: active
```

Broad requests such as "continue" or "go on" complete the current Goal; they do
not silently replace it with the whole issue or project. Ask one user question
before adding acceptance criteria or replacing the Goal.

Discovery and worktree setup may start while the fixed point or verify contract is
pending. No source-writing implementation, review, or gate task may start until its
fixed point is known. No implementation may report `DONE` until the verify contract
is known.

## Pre-spawn gate

Spawn a task only when every applicable check passes:

1. **Scope** - the task is necessary for the current `Done when`.
2. **Dependency** - every blocker is complete and its branch/commit is recorded.
3. **Isolation** - a source-writing task has its own worktree; setup tasks may create it.
4. **Fixed point** - source-writing and review tasks have an exact base SHA.
5. **Verification** - implementation and gate tasks have canonical commands and
   known environment requirements.
6. **Routing** - role and route override match [`models.md`](models.md).
7. **Runtime safety** - no writer lease conflict exists; provisional Paseo failures
   remain live for isolation, stop, and budget purposes.
8. **Budget** - fewer than thirty worker results have been triaged and fewer than
   thirty workers have been launched. At eight or more triaged results, the task must
   be already-boarded closure work and be marked as closure through the platform adapter.
9. **Payload** - omit every optional field that is not intentionally used. On Paseo,
   never set `timeoutSeconds`; use only `maxDurationSeconds`. Do not send empty model,
   route, evidence, deadline, or budget values.
10. **Slice size** - an implementation task is one reviewable, commit-sized slice with
    explicit acceptance criteria. A broad issue range must be decomposed before a
    writer starts, even when all writes will later be serialized in one worktree.

If a check fails, do not spawn. Update the board, ask one user question when needed,
or prepare a handoff.

### Named route evidence

Normal dispatch omits `routeOverride`, `overrideReason`, and
`overrideFromWorkerId`; the runtime applies the role matrix. A named override is
applied only when its structured evidence is valid:

- `mechanical-judgment` requires role `mechanical`, an `overrideReason` of
  `merge-conflict` or `github-judgment`, and no source worker;
- every `escalate-*` route requires a failure-class `overrideReason` plus
  `overrideFromWorkerId` naming a terminal, already-triaged worker whose recorded
  result proves that exact failure, verification failure, `BLOCKED`,
  `REVIEW_CHANGES_REQUIRED`, or `DONE_WITH_CONCERNS` condition;
- initial discovery, implementation, review, setup, and gates always use their normal
  role routes. Complexity alone is not escalation evidence.

An invalid named override is recorded on the worker, explained in the spawn result,
and downgraded to the normal role route instead of failing the spawn. Correct the next
payload; do not repeat the override or reinterpret its rejection as worker failure.
This preserves the requested semantic role and prevents retry loops from converting
implementers or reviewers into mechanical workers. A user-requested model is
separate: use `modelOverride` only when the user explicitly requests that exact model.
The runtime derives a one-batch authorization from raw user input; an unauthorized
override is audited, explained, and downgraded to the normal role route. Omit
`modelOverride` otherwise.

## Counters

- Increment `Workers` once for each worker launched.
- Increment `Triage` once for each worker result read, including `BLOCKED`,
  `NEEDS_CONTEXT`, `NEEDS_USER_INPUT`, and review statuses.
- Show both counters in every full board and status response.
- Batching results never collapses multiple workers into one triage event.

## Soft closure gate

At `Triage: 8/30`, mark the lifecycle `closure` and stop expanding the run. Do not
start discovery, planning, setup, a new implementation slice, or adjacent work.
Only already-boarded tasks in `fix`, `review`, `gate`, `commit`, or `landing` may
continue, and every spawn must use the platform adapter's closure classification.

Closure routing is deliberately narrow:

- `fix` -> `implementer` or `architect`;
- `review` -> `reviewer`;
- `gate`, `commit`, or `landing` -> `mechanical`.

Platform adapters reject or prohibit normal spawns and resumes after the soft gate.
A resumed worker inherits the class recorded at its original spawn. The six-worker
concurrency and thirty-launch limits remain unchanged.

## Hard handoff

At `Triage: 30/30`, stop dispatching. Do not start a thirty-first post-triage task in
the same parent session.

1. Let already in-flight workers finish, or stop them if the user requests it.
2. Read and triage their results without dispatching replacements.
3. Post the full run contract, full board, and a handoff packet.
4. Set `Worker retention: preserve-for-handoff` only for workers intentionally
   listed as resumable in the handoff packet; record the reason, worker ID, worktree,
   branch, fixed point, and next action for each one. All other terminal workers remain
   `dispose-on-close`.
5. Invoke adapter close controls with the matching retention policy, report partial
   disposal explicitly, and tell the user that continuation requires a new session and
   orchestration run.

The handoff packet contains Goal, decisions, all board rows, branches, worktrees,
`based-on:` and `fixed:` SHAs, commits, verification results, unresolved concerns,
and the next unblocked task. Counters may exceed thirty only while draining workers
that were already in flight.

## Scope completion

`dispose-on-close` is the default. Use `preserve-for-handoff` only when the board
explicitly names workers expected to be resumed; preservation is never an implicit
convenience or a way to keep every completed worker resident.

When `Done when` is satisfied:

1. drain every in-flight worker;
2. call `minions_read` and triage every final result;
3. verify no worker has an active turn or pending permission;
4. persist the final full board and any handoff packet;
5. call `minions_close` with the board's worker retention policy and, for handoff,
   only the exact listed worker IDs;
6. record every worker as `disposed`, `preserved`, or `disposal-failed` and report:
   `Workers disposed: N`, `Workers preserved: N`, and `Disposal failures: N`.

Disposal is run-scoped and idempotent: an already stopped or archived worker counts
as disposed. Never target the parent, an unrelated agent, or a worker from another
Minions run. A disposal failure does not authorize broad cleanup; report the partial
close and its exact worker ID. Do not automatically start an adjacent slice. Present
the next bounded options and obtain one explicit choice before a new run contract.
