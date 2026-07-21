---
name: copilot-minions
description: >-
  Orchestrator for GitHub Copilot CLI — a dispatch-only frontier coordinates
  background workers through an async inbox. Use when the user says "orchestrate",
  "go build it", "minions on", "copilot-minions", asks to decompose and dispatch
  work across parallel agents, or runs a grill→build / planning→issues flow.
  The frontier decomposes, spawns Copilot `task` sub-agents in the background with
  pinned models, keeps a board, and triages STATUS from the inbox. Opt out with
  "/direct", "skip minions", or "skip workers" → normal single agent, no spawns.
---

# copilot-minions

**Dispatch-only frontier** (recommended session model `gpt-5.6-sol` medium):
decompose, spawn, **board**, triage **inbox** STATUS. Workers execute; you dispatch.

Port of [`minion-orchestrator`](https://github.com/lenniii/minion-orchestrator)
(a Cursor skill) to GitHub Copilot CLI. Cursor `Task` spawns → Copilot `task`
sub-agents; Cursor-only models → Copilot models ([`models.md`](models.md)).

**Tight** frontier turns — STATUS + one line per triage; spawn specs ≤15 lines;
issue/spec by reference. Frontier rules: [`frontier.md`](frontier.md).

**Disciplines.** The frontier only dispatches; *how* workers implement, test,
review, and spec comes from **discipline skills** (grilling, tdd, code-review,
implement, to-spec, to-tickets) — [`disciplines.md`](disciplines.md). Each worker
loads its discipline if installed, else uses an inline fallback.

## Branch

| Mode | Trigger | Load |
|------|---------|------|
| **Orchestration** | "orchestrate", "go build it", "minions on", implement work | steps below + [`loop.md`](loop.md) [`worktrees.md`](worktrees.md) |
| **Planning** | "to prd", "to issues", "grill", planning arc | [`frontier.md`](frontier.md) |
| **Steering** | "what's running?", "steer", "stop task" | [`state.md`](state.md) |

`/direct` | `skip minions` | `skip workers` → normal agent, no spawns.

Models: [`models.md`](models.md). Prompts: [`prompts.md`](prompts.md). Shell: [`shell.md`](shell.md). Disciplines: [`disciplines.md`](disciplines.md).

## Inbox

Every spawn: `mode: "background"`. After launching background work, end the turn
and wait for the completion notification. On notification → `read_agent` →
triage → update **board** → spawn next phase. This is the async inbox.

## 1. Decompose

Split the request into tasks. Post initial **board** ([`state.md`](state.md)). Put
paths in `Files:`, issue refs in spec — the worker discovers the rest
([`loop.md`](loop.md) repo discovery).

**Done when:** every task has ID, type, spec, `Blocked by`, issue link (if any);
board posted.

## 2. Spawn

Spawn only **unblocked** tasks. Batch independent tasks in one turn (multiple
`task` calls in a single response).

Before first implement: worktree per [`worktrees.md`](worktrees.md) — **stacked**
tasks base off the blocker's branch, not `origin/main`. Pin model per
[`models.md`](models.md). Prompt per [`prompts.md`](prompts.md). Delta-update
board ([`state.md`](state.md)).

**Done when:** every unblocked task is `in-flight` or waiting on a blocker; or you
escalated / asked the user.

## 3. Triage inbox

On each notification — **STATUS** line only; one board Notes line. Worker body
stays unread beyond the STATUS/summary.

| STATUS | Next |
|--------|------|
| `DONE` (implement) | commit SHA on board → spawn review per [`loop.md`](loop.md) |
| `DONE` (implement, no SHA) | respawn implement — commit before `DONE` |
| `DONE_WITH_CONCERNS` | accept or respawn |
| `NEEDS_CONTEXT` | respawn implement with gap in `Spec` / `Files` |
| `NEEDS_USER_INPUT` | frontier asks the user (one line via `ask_user`) → respawn worker with the answer in `Spec` — the worker must never ask the user directly |
| `BLOCKED` | respawn (escalate tier per [`models.md`](models.md)), split, or ask user — never resume |
| `REVIEW_APPROVED` | gate → final commit |
| `REVIEW_CHANGES_REQUIRED` | fix-review → review again (max 5 reviews) |
| `BLOCKED` (review, empty log) | respawn review with worktree path + `fixed:` from board |
| `DONE` (commit) | task `done` |

Fix-review loops until `REVIEW_APPROVED`, **max 5 reviews** per task (track
`round:` on board). On a 5th `REVIEW_CHANGES_REQUIRED`: escalate to user — do not
spawn another fix. After 8 inbox notifications: post full board, tell user to
continue in a **new chat/session** (context budget).

**Done when:** every notification has STATUS on board and next phase spawned or
escalated.

When a task is `done`, spawn newly unblocked tasks (worktree first).

## 4. Close

When nothing `in-flight`: close summary (bullets — done, blocked, SHAs,
branches). Ask user how to land ([`worktrees.md`](worktrees.md)).

**Done when:** user has summary and chose landing (or declined).

## Steering

`what's running?` → delta or full board. `steer <id>: <instruction>` → respawn
with instruction in `Spec` ([`loop.md`](loop.md) Respawn). `stop task <id>` →
`cancelled` (stop the background agent, mark the row).
