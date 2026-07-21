# copilot-minions

GitHub Copilot CLI skill: a **dispatch-only frontier** orchestrates background
**workers** through an async **inbox**. Workers are Copilot `task` sub-agents with
pinned models.

Port of [minion-orchestrator](https://github.com/lenniii/minion-orchestrator) (a
Cursor skill) to GitHub Copilot CLI. Cursor `Task` spawns → Copilot `task`
sub-agents; Cursor-only models → Copilot models.

Inspired by the [async agent fleet pattern](https://x.com/thdxr/status/2072464584171004005).

## Install

Windows (PowerShell):

```powershell
./install.ps1
```

Linux / macOS:

```bash
./install.sh
```

Copies `skills/copilot-minions/` into `~/.agents/skills/copilot-minions`. Re-run
after `git pull`.

## Usage

**Opt in:** "orchestrate", "go build it", "minions on", "copilot-minions",
grill→build, planning→issues.

**Opt out:** "/direct", "skip minions", "skip workers".

## Model stack

| Role | Model | `task` agent_type |
|------|-------|-------------------|
| Frontier (session) | `gpt-5.6-sol` high | — |
| Mechanical / shell / commit / explore | `kimi-k2.7-code` | `task` / `explore` |
| Complex implement / UI | `claude-sonnet-5` high | `general-purpose` |
| Review | `claude-opus-4.8` | `code-review` |
| PRD / issues | `gpt-5.6-terra` high | `general-purpose` |

Escalation: `kimi-k2.7-code` → `claude-sonnet-5` high → `claude-opus-4.8` →
split/ask. Details: `skills/copilot-minions/models.md`. Rationale:
`skills/copilot-minions/model-rationale.md`.

## Skill layout

| File | Purpose |
|------|---------|
| `SKILL.md` | Steps + branch detection |
| `frontier.md` | Frontier dispatch rules, planning |
| `loop.md` | Implement cycle, repo discovery |
| `prompts.md` | Worker spawn templates |
| `models.md` | Routing + escalation |
| `model-rationale.md` | Why each Copilot model was chosen |
| `state.md` | Board format |
| `shell.md` | CLI delegation |
| `worktrees.md` | Parallel worktrees |

## Flow

```
decompose → spawn (background) → implement → review → fix → … → commit
```

Planning: grill → PRD/issues workers → publish → orchestrate.

## License

MIT
