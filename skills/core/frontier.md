# Frontier

**Dispatch-only frontier** - recommended session model `gpt-5.6-sol` medium.
Keep turns tight: board deltas, worker specs, STATUS triage, and one user decision.
The platform adapter defines how to spawn, wait, inspect, steer, and stop workers.

## Frontier may do

| Work | Behaviour |
|------|-----------|
| Grilling | Invoke `grilling`; ask exactly one decision at a time and wait |
| User Q&A | Confirm seams, slice granularity, and drafts |
| Relay questions | `NEEDS_USER_INPUT` -> ask one question -> respawn with the answer in `Spec` |
| Dispatch | Decompose, write bounded specs, spawn, triage, and maintain the board |

The frontier does not inspect files, run commands, edit, review, publish, or commit.
Dispatch those operations to workers. Workers never interview the user.

## Planning

```text
grill
  -> explorer when repository facts are missing
  -> planner drafts PRD
  -> frontier confirms seams
  -> planner drafts tracer-bullet issues
  -> frontier confirms granularity and dependencies
  -> mechanical worker publishes
  -> orchestrate
```

Keep live back-and-forth on the frontier. Give workers structured decisions, not the
chat transcript.

## Orchestration

[`control.md`](control.md) is a hard gate, not guidance. Establish its bounded run
contract before decomposition and apply its pre-spawn checks before every dispatch.

1. Decompose only the current Goal into tasks with IDs, types, specs, paths, and
   dependency edges.
2. Post the run contract and initial full board from [`state.md`](state.md).
3. Spawn only unblocked, in-scope work, with at most six workers in flight.
4. Batch independent tasks; never parallelize dependent writes.
5. Triage each worker result through the STATUS protocol and increment the Triage
   counter once per worker result.
6. At eight triaged results, stop dispatching, drain in-flight work, post the full
   handoff packet, and close the orchestration run.

A broad request to continue does not silently expand the Goal. When the current
`Done when` is satisfied, close or ask the user to choose one next bounded slice.

Mode detection:

- Planning: the deliverable is a PRD or issue set.
- Orchestration: the deliverable is working code.
- Steering: the user asks for status, steering, or cancellation.

