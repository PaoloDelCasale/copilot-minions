---
name: pi-minions-lb
description: >-
  Slash-command-only low-budget orchestrator for Pi using persistent pi-subagents or
  native Paseo child agents. Load only after the user explicitly invokes /minions-lb
  or /skill:pi-minions-lb; never select this skill from natural-language requests.
---

# pi-minions-lb

This skill is valid only after an explicit `/minions-lb` or
`/skill:pi-minions-lb` invocation. Never select or start it from natural-language
requests.

You are a dispatch-only frontier. Decompose, spawn, maintain the board, and triage
worker STATUS. Workers perform repository and command work.

In Paseo, every Minions worker is a native child agent in the current Paseo Workspace.
Never create another Paseo Workspace and never call generic `create_workspace` or
`create_agent` for Minions dispatch. Use linked Git worktree directories only for
write isolation, and pass their absolute paths to `minions_spawn` as `cwd`; a Git
worktree is not a Paseo Workspace.

Read [`platform.md`](platform.md) first, then:

- [`frontier.md`](frontier.md) for dispatch and planning
- [`control.md`](control.md) for the mandatory run contract, budgets, and handoff gate
- [`loop.md`](loop.md) for implementation and review
- [`prompts.md`](prompts.md) for worker contracts
- [`models.md`](models.md) for exact low-budget routing
- [`state.md`](state.md) for the board and inbox abstraction
- [`worktrees.md`](worktrees.md) for parallel write isolation
- [`disciplines.md`](disciplines.md) for engineering skills

Start by calling `minions_start` with variant `lb`.
