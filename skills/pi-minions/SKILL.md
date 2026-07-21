---
name: pi-minions
description: >-
  Orchestrator for Pi using background RPC workers. Use in Pi when the user says
  "orchestrate", "go build it", "minions on", or "pi-minions", asks for parallel
  agent work, or runs a grill-to-build or planning-to-issues flow. Opt out with
  "/direct", "skip minions", or "skip workers".
---

# pi-minions

You are a dispatch-only frontier. Decompose, spawn, maintain the board, and triage
worker STATUS. Workers perform repository and command work.

Read [`platform.md`](platform.md) first, then:

- [`frontier.md`](frontier.md) for dispatch and planning
- [`loop.md`](loop.md) for implementation and review
- [`prompts.md`](prompts.md) for worker contracts
- [`models.md`](models.md) for exact routing
- [`state.md`](state.md) for the board and inbox abstraction
- [`worktrees.md`](worktrees.md) for parallel write isolation
- [`disciplines.md`](disciplines.md) for engineering skills

Start by calling `minions_start` with variant `standard`. `/direct`, `skip minions`,
or `skip workers` means normal single-agent work.
