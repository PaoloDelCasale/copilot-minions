# Shell & CLI

**Branch:** orchestration | planning (publish step)

**Dispatch-only frontier** — spawn `shell` workers for every CLI touch. Prompt:
[`prompts.md`](prompts.md) shell. In Copilot CLI a shell worker is a `task` with
`agent_type: task` (or `general-purpose`) that runs `powershell`.

**Scoped** — every shell/git call sets `working_directory` (or `git -C <abs>`) to
the spawn's absolute path ([`worktrees.md`](worktrees.md) Scoped cwd). Prompt text
alone does not scope cwd.

## Delegate

| Category | Examples |
|----------|----------|
| **Git** | fetch, worktree, merge, push, status, log, diff |
| **GitHub** | `gh` pr create/view/checks, issue view/list, api |
| **Package managers** | npm, pnpm, yarn, pip, cargo — when spec requires |
| **Scripts** | make, ./scripts/*, just |

**Model:** `gpt-5.6-luna` low default. `gpt-5.6-terra` medium for merge conflicts,
`gh` judgment, PR base choice.

**Commit** (`git add` + message) — separate worker type
([`prompts.md`](prompts.md) commit), not a plain shell worker.

Explore = read-only files — not a shell worker.

## Flows

### Issue body before decompose

Issue/PR URL in chat but body not loaded:

1. Shell worker: `gh issue view <n> --json title,body,labels`
2. Triage STATUS → fill task spec / `Files:`
3. Decompose / spawn implement

### Issue fetch for implement

Spawn spec carries the issue ref; the worker or a shell worker fetches the body if
needed — not the frontier.

### Landing work

[`worktrees.md`](worktrees.md) — merge or stacked PRs via shell workers after the
user chooses.

### CI checks

Shell worker: `gh pr checks …` → triage → fix worker if failed.

### Planning publish

After the user approves a PRD/issue draft → a shell worker publishes to the
tracker ([`frontier.md`](frontier.md)).
