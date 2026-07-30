# Pi workers use the pi-subagents RPC contract

## Status

Accepted on the experimental `agent/use-pi-subagents-runtime` branch. This
supersedes ADR 0001 for Pi.

## Context

The original Pi adapter directly launched and supervised ephemeral
`pi --mode rpc --no-session` processes. That proved provider-qualified routing but
made Minions responsible for JSONL framing, cancellation races, usage accounting,
reload shutdown, and an unrecoverable session lifecycle.

`pi-subagents` exposes a versioned in-process RPC v1 contract for other Pi extensions.
Its async runs provide persistent artifacts, recovery, resume, steering, stop
control, supervisor communication, FleetView, process-terminal evidence, and
completion events.

## Decision

Keep the public `minions_*` tools and all shared orchestration policy. Replace direct
process ownership with RPC calls to the pinned `npm:pi-subagents@0.37.2` runtime.

Minions continues to own:

- provider affinity and exact role/model/thinking matrices;
- worker IDs, board mapping, six-worker concurrency, twelve launches, and the
  eight-result triage budget;
- explicit discipline selection with inline fallback;
- linked-worktree validation for implementation writers;
- parent frontier model locking and restoration.

`pi-subagents` owns:

- child process and session lifecycle;
- persistence, recovery, resume, timeouts, and stop confirmation;
- completion and attention events, supervisor communication, artifacts, and UI.

Role agents are installed under `~/.pi/agent/agents/copilot-minions`. The reviewer
may translate Matt Pocock's two `Agent` calls into one nested `subagent` parallel run
using the read-only `pi-minions-review-axis` leaf. Other roles cannot perform nested
fan-out.

## Consequences

Pi installation gains a pinned external package dependency and requires RPC v1
capability preflight. Reload no longer aborts active workers. Worker token and cost
totals are projected from package completion events or the persistent lifecycle v1
artifact and credited once when read or closed. Cache-token cost categories are
unavailable in the public completion contract, so only total cost is credited until
RPC exposes a richer usage DTO.
