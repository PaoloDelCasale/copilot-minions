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
Triage budget: 0/8 soft; 0/12 hard
Worker budget: 0/12 launches
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
7. **Budget** - fewer than twelve worker results have been triaged and fewer than
   twelve workers have been launched. At eight or more triaged results, the task must
   be already-boarded closure work and be marked as closure through the platform adapter.

If a check fails, do not spawn. Update the board, ask one user question when needed,
or prepare a handoff.

## Counters

- Increment `Workers` once for each worker launched.
- Increment `Triage` once for each worker result read, including `BLOCKED`,
  `NEEDS_CONTEXT`, `NEEDS_USER_INPUT`, and review statuses.
- Show both counters in every full board and status response.
- Batching results never collapses multiple workers into one triage event.

## Soft closure gate

At `Triage: 8/12`, mark the lifecycle `closure` and stop expanding the run. Do not
start discovery, planning, setup, a new implementation slice, or adjacent work.
Only already-boarded tasks in `fix`, `review`, `gate`, `commit`, or `landing` may
continue, and every spawn must use the platform adapter's closure classification.

Closure routing is deliberately narrow:

- `fix` -> `implementer` or `architect`;
- `review` -> `reviewer`;
- `gate`, `commit`, or `landing` -> `mechanical`.

Platform adapters reject or prohibit normal spawns and resumes after the soft gate.
A resumed worker inherits the class recorded at its original spawn. The six-worker
concurrency and twelve-launch limits remain unchanged.

## Hard handoff

At `Triage: 12/12`, stop dispatching. Do not start a thirteenth post-triage task in
the same parent session.

1. Let already in-flight workers finish, or stop them if the user requests it.
2. Read and triage their results without dispatching replacements.
3. Post the full run contract, full board, and a handoff packet.
4. Mark the orchestration run closed and invoke adapter close controls when provided.
5. Tell the user that continuation requires a new session and orchestration run.

The handoff packet contains Goal, decisions, all board rows, branches, worktrees,
`based-on:` and `fixed:` SHAs, commits, verification results, unresolved concerns,
and the next unblocked task. Counters may exceed twelve only while draining workers
that were already in flight.

## Scope completion

When `Done when` is satisfied, close the orchestration run. Do not automatically
start an adjacent slice. Present the next bounded options and obtain one explicit
choice before a new run contract.
