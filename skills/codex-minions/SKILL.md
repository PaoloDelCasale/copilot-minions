---
name: codex-minions
description: >-
  Orchestrator for OpenAI Codex. Use when the user says "orchestrate", "go build
  it", "minions on", or "codex-minions", asks for parallel subagent work, or runs
  a grill-to-build or planning-to-issues flow. A dispatch-only frontier coordinates
  native Codex subagents, a board, and STATUS triage. Opt out with "/direct",
  "skip minions", or "skip workers".
---

# codex-minions

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

`/direct`, `skip minions`, or `skip workers` means normal single-agent work.

