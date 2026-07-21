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

Copies `skills/copilot-minions/` into `~/.copilot/skills/copilot-minions`. Re-run
after `git pull`. Restart / reload your Copilot session afterwards so the skill
appears in the `/` menu.

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
| `disciplines.md` | Discipline-skill wiring + fallbacks |
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

## Discipline layer

copilot-minions only **dispatches**. How workers implement, test, review, and spec
comes from **discipline skills** — mostly from
[`mattpocock/skills`](https://github.com/mattpocock/skills): `grilling`, `tdd`,
`code-review`, `implement`, `to-spec`, `to-tickets`, plus `codebase-design` /
`domain-modeling` / `diagnosing-bugs`. Each worker loads its discipline if
installed, else falls back to inline constraints. copilot-minions **references**
these skills (never forks them) and can keep them updated from upstream — see
[Keeping disciplines updated](#keeping-disciplines-updated) and
`skills/copilot-minions/disciplines.md`.

## Keeping disciplines updated

Three disciplines aren't in Copilot's default set — `implement`, `to-spec`,
`to-tickets` (Matt renamed the last two from `to-prd` / `to-issues`). The bundled
updater clones/pulls `mattpocock/skills` `main` into a portable cache and registers
them as **custom skills** (directory references), so a plain `git pull` refreshes
their content:

```powershell
scripts/update-disciplines.ps1        # Windows / PowerShell
```
```bash
scripts/update-disciplines.sh         # macOS / Linux
```

`install.ps1` / `install.sh` call this automatically (non-fatal if offline).

**Weekly auto-update (Copilot workflow).** Create a scheduled workflow that runs the
updater once a week — e.g. a weekly workflow with the prompt:

> Run `scripts/update-disciplines.ps1` (or `scripts/update-disciplines.sh`) from the
> copilot-minions repo to refresh the discipline skills, then report what changed.

Because registrations are directory references, the workflow only needs to pull and
re-run the script; no re-install of copilot-minions itself is required.

## License

MIT
