# copilot-minions

Multi-platform orchestration skills for **GitHub Copilot CLI**, **OpenAI Codex**,
and **Pi**. A dispatch-only frontier coordinates bounded workers through a shared
board and STATUS protocol. Workers implement, explore, review, plan, and run commands
in isolated worktrees.

The methodology is shared; only platform capabilities differ:

- Copilot spawns background `task` agents and reads completion notifications.
- Codex spawns native subagents, uses managed custom agents, and exposes threads
  through `/agent`.
- Pi runs managed background `pi --mode rpc` subprocesses with the provider selected
  by the parent session.

Codex and Pi support are **beta** until their authenticated release gates pass.

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
./install.ps1 -Platform pi
./install.ps1 -Platform all
```

```bash
./install.sh --platform copilot
./install.sh --platform codex
./install.sh --platform pi
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
| Pi | `~/.pi/agent/skills/pi-minions` | Shared extension in `~/.pi/agent/extensions/pi-minions` |
| Pi LB | `~/.pi/agent/skills/pi-minions-lb` | Shared extension in `~/.pi/agent/extensions/pi-minions` |

Codex installation requires `codex` on `PATH` and runs `codex debug models` before
writing files. Installation fails if `gpt-5.6-sol`, `gpt-5.6-terra`, or
`gpt-5.6-luna` is unavailable. Pi installation requires `pi` on `PATH`; its provider
catalog is validated at orchestration start because availability depends on the
active authenticated provider. `all` preflights and stages every platform before
replacing any installation.

The six Codex agent files are namespaced and carry a managed marker. Pi skills and
the shared extension also carry managed markers. The installer updates only managed
Pi/Codex resources and refuses to overwrite a user-owned collision.

## Usage

Standard triggers: `orchestrate`, `go build it`, `minions on`, and planning-to-build
flows. Platform names are explicit: `copilot-minions`, `codex-minions`, and
`pi-minions`.
Low-budget variants trigger on `orchestrate low budget`, `minions lb`, or their
explicit names.

Opt out with `/direct`, `skip minions`, or `skip workers`.

Each orchestration run declares one bounded Goal, completion criteria, out-of-scope
work, fixed point, verification contract, and worker/triage budgets. After eight
worker results the frontier stops dispatching, drains in-flight work, posts a full
handoff, and closes the run. Adjacent issue slices require a new explicit Goal.

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

### Pi provider affinity

Starting either Pi skill captures the parent provider. Only `openai-codex` and
`github-copilot` are accepted. The frontier switches to
`<provider>/gpt-5.6-sol:medium`; workers keep the existing role routing while every
model is qualified with that same provider. Missing required models fail preflight;
there is no cross-provider or availability fallback. Closing the run restores the
parent's original model and thinking level.

Pi renders a live worker widget above the editor with role, status, routed model,
elapsed time, and current RPC tool. Worker lifecycle snapshots survive reloads so
interrupted work remains visible, while the worker subprocesses themselves stay
ephemeral. Completion notifications interrupt a busy frontier; the frontier ends its
turn after spawning instead of polling. Spawn tasks may also set `timeoutSeconds` for
an orchestrator-enforced hard deadline.

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
  core/                    shared control gate, workflow, prompts, board, models, worktrees
  lb/                      low-budget model overlay
  copilot-minions/         Copilot entrypoint and capability adapter
  copilot-minions-lb/      Copilot low-budget entrypoint and adapter
  codex-minions/           Codex entrypoint, adapter, and custom-agent sources
  codex-minions-lb/        Codex low-budget entrypoint, adapter, and agents
  pi-minions/              Pi entrypoint and RPC adapter
  pi-minions-lb/           Pi low-budget entrypoint and RPC adapter
extensions/
  pi-minions/              Shared provider-affine RPC worker runtime
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
links under `~/.agents/skills`; Pi uses managed links under `~/.pi/agent/skills`.
External discipline updates are non-fatal because
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
IDs and a real native-subagent orchestration cycle. Pi remains beta until real RPC
orchestration runs pass with both `openai-codex` and `github-copilot`.

## License

MIT
