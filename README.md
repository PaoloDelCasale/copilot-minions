# copilot-minions

Dual-platform orchestration skill for **GitHub Copilot CLI** and **OpenAI Codex**.
A dispatch-only frontier coordinates bounded workers through a shared board and
STATUS protocol. Workers implement, explore, review, plan, and run commands in
isolated worktrees.

The methodology is shared; only platform capabilities differ:

- Copilot spawns background `task` agents and reads completion notifications.
- Codex spawns native subagents, uses managed custom agents, and exposes threads
  through `/agent`.

Codex support is **beta** until the shared Sol/Terra/Luna model stack is confirmed
against an authenticated Codex catalog.

## Install

The existing no-argument commands remain Copilot-compatible:

```powershell
./install.ps1
```

```bash
./install.sh
```

Select a platform explicitly:

```powershell
./install.ps1 -Platform copilot
./install.ps1 -Platform codex
./install.ps1 -Platform all
```

```bash
./install.sh --platform copilot
./install.sh --platform codex
./install.sh --platform all
```

Install the additional low-budget variants:

```powershell
./install.ps1 -Platform all -Variant lb
./install.ps1 -Platform all -Variant all
```

```bash
./install.sh --platform all --variant lb
./install.sh --platform all --variant all
```

`Variant` defaults to `standard`. `all` installs standard and low-budget skills
side-by-side.

Destinations:

| Platform | Skill | Companion agents |
|----------|-------|------------------|
| Copilot | `~/.copilot/skills/copilot-minions` | Native Copilot agent types |
| Copilot LB | `~/.copilot/skills/copilot-minions-lb` | Native Copilot agent types |
| Codex | `~/.agents/skills/codex-minions` | `~/.codex/agents/codex-minions-*.toml` |
| Codex LB | `~/.agents/skills/codex-minions-lb` | `~/.codex/agents/codex-minions-lb-*.toml` |

Codex installation requires `codex` on `PATH` and runs `codex debug models` before
writing files. Installation fails if `gpt-5.6-sol`, `gpt-5.6-terra`, or
`gpt-5.6-luna` is unavailable. `all` preflights and stages both platforms before
replacing either installation.

The six Codex agent files are namespaced and carry a managed marker. The installer
updates only managed files and refuses to overwrite a user-owned collision.

## Usage

Standard triggers: `orchestrate`, `go build it`, `minions on`, and planning-to-build
flows. Platform names are explicit: `copilot-minions` and `codex-minions`.
Low-budget variants trigger on `orchestrate low budget`, `minions lb`, or their
explicit names.

Opt out with `/direct`, `skip minions`, or `skip workers`.

## Model stack

Both platforms use the same routing:

| Role | Model | Reasoning |
|------|-------|-----------|
| Frontier | `gpt-5.6-sol` | medium |
| Mechanical | `gpt-5.6-luna` | low |
| Explorer | `gpt-5.6-luna` | high |
| Implementer | `gpt-5.6-luna` | xhigh |
| Architect | `gpt-5.6-sol` | medium |
| Reviewer | `gpt-5.6-sol` | low |
| Planner | `gpt-5.6-terra` | high |

See `skills/core/models.md` and `skills/core/model-rationale.md`.

### Low-budget stack

Inspired by the model routing in
[`nsEytgXm/subagents_configs`](https://github.com/nsEytgXm/subagents_configs), while
preserving the existing minions flow:

| Role | Model | Reasoning |
|------|-------|-----------|
| Frontier | `gpt-5.6-sol` | medium |
| Mechanical | `gpt-5.6-luna` | low |
| Explorer | `gpt-5.6-luna` | medium |
| Implementer / architect / planner | `gpt-5.6-luna` | high |
| Reviewer | `gpt-5.6-sol` | low |

Unlike the source configuration, LB does not add a separate validator or make review
selective. Verify and mandatory review gates remain unchanged.

## Source layout

```text
skills/
  core/                    shared workflow, prompts, board, models, worktrees
  lb/                      low-budget model overlay
  copilot-minions/         Copilot entrypoint and capability adapter
  copilot-minions-lb/      Copilot low-budget entrypoint and adapter
  codex-minions/           Codex entrypoint, adapter, and custom-agent sources
  codex-minions-lb/        Codex low-budget entrypoint, adapter, and agents
```

Installers create autosufficient skill directories by copying the core and selected
overlay. They do not generate or template Markdown.

## Discipline skills

The frontier dispatches; discipline skills define how workers engineer:
`grilling`, `implement`, `tdd`, `code-review`, `to-spec`, `to-tickets`,
`codebase-design`, `domain-modeling`, and `diagnosing-bugs`.

The platform-aware updater tracks `mattpocock/skills` for `implement`, `to-spec`, and
`to-tickets`:

```powershell
scripts/update-disciplines.ps1 -Platform all
```

```bash
scripts/update-disciplines.sh --platform all
```

Copilot registers cache directories with `copilot skill add`. Codex uses managed
links under `~/.agents/skills`. External discipline updates are non-fatal because
worker prompts include complete inline fallbacks.

## Tests

Smoke tests use temporary homes and mocked CLI catalogs; no account is required:

```powershell
./tests/install.Tests.ps1
```

```bash
bash ./tests/install-tests.sh
```

GitHub Actions runs the PowerShell suite on Windows and the Bash suite on Ubuntu and
macOS.

## Release

The dual-platform change lands as one backward-compatible PR. The first `v0.1.0`
release is gated on a manual authenticated Codex run confirming the required model
IDs and a real native-subagent orchestration cycle.

## License

MIT
