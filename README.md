# copilot-minions

Multi-platform orchestration skills for **GitHub Copilot CLI**, **OpenAI Codex**,
and **Pi**. A dispatch-only frontier coordinates bounded workers through a shared
board and STATUS protocol. Workers implement, explore, review, plan, and run commands
in isolated worktrees.

The methodology is shared; only platform capabilities differ:

- Copilot spawns background `task` agents and reads completion notifications.
- Codex spawns native subagents, uses managed custom agents, and exposes threads
  through `/agent`.
- Pi delegates persistent background workers through the versioned event-bus RPC
  exposed by [`pi-subagents`](https://github.com/nicobailon/pi-subagents), while
  retaining Minions provider affinity, role routing, budgets, and board identity.

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
| Pi | `~/.pi/agent/skills/pi-minions` | Extension plus agents under `~/.pi/agent/{extensions,agents}` |
| Pi LB | `~/.pi/agent/skills/pi-minions-lb` | Same shared extension and agents |

Codex installation requires `codex` on `PATH` and runs `codex debug models` before
writing files. It requires Sol and Luna, plus Terra for the standard variant. Pi
installation requires `pi` on `PATH`; it installs the pinned
`npm:pi-subagents@0.37.2` package and validates the provider-specific model catalog.
Set `PI_SUBAGENTS_PACKAGE` only when deliberately testing another compatible
package version. Runtime model availability is checked again at orchestration start
because it depends on the active authenticated provider. `all` preflights and stages
every platform before replacing any Minions installation.

The six Codex and seven Pi agent files are namespaced and carry managed markers. Pi
skills and the shared extension are managed as well. The installer updates only
managed Pi/Codex resources and refuses to overwrite a user-owned collision.

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

## Standard model stacks

Routing is provider-specific. OpenAI Codex (native and Pi) keeps its existing routes:

| Role | Model | Reasoning |
|------|-------|-----------|
| Frontier | `gpt-5.6-sol` | medium |
| Mechanical | `gpt-5.6-luna` | low |
| Explorer | `gpt-5.6-luna` | high |
| Implementer | `gpt-5.6-luna` | xhigh |
| Architect | `gpt-5.6-sol` | medium |
| Reviewer | `gpt-5.6-sol` | low |
| Planner | `gpt-5.6-terra` | high |

GitHub Copilot (native and Pi) uses Grok high wherever the old route used Luna;
Sol and Terra routes stay unchanged:

| Role | Model | Reasoning |
|------|-------|-----------|
| Frontier | `gpt-5.6-sol` | medium |
| Mechanical / explorer / implementer | `grok-4.5` | high |
| Architect | `gpt-5.6-sol` | medium |
| Reviewer | `gpt-5.6-sol` | low |
| Planner | `gpt-5.6-terra` | high |

See each platform overlay's `models.md` and `skills/core/model-rationale.md`.

### Pi provider affinity

Starting either Pi skill captures the parent provider. Only `openai-codex` and
`github-copilot` are accepted. The frontier switches to
`<provider>/gpt-5.6-sol:medium`; workers use that provider's matrix while every model
is qualified with the same provider. Required-model preflight and route lookup are
provider-specific. The installers and runtime require exact catalog IDs—including
`github-copilot/grok-4.5`—and direct users to upgrade Pi when a route is missing;
there is no cross-provider or availability fallback. Closing the run restores the
parent's original model and thinking level.

Workers use namespaced `pi-subagents` agents and explicit provider-qualified model
routes. `pi-subagents` owns process lifecycle, FleetView, artifacts, session recovery,
supervisor communication, steering, timeout enforcement, and completion
notifications. Minions persists its mapping from board worker IDs to package run IDs,
so reloads do not abort live work. `minions_resume` revives a paused, failed, or
completed worker while preserving its board identity; deliberately stopped workers
remain non-resumable.

The wrapper enforces six concurrent workers, twelve launches, and a hard handoff
after eight triaged results per run. Implementer and architect launches require an
explicit linked Git worktree; the runtime rejects a primary checkout before
spawning. Worker usage is credited exactly once through `minions_read`, with
`minions_close` flushing unread completion usage. Missed notifications are
reconciled from the package's persistent lifecycle v1 artifact. `timeoutSeconds`
maps to the package-owned persistent deadline.

### Low-budget stack

Inspired by the model routing in
[`nsEytgXm/subagents_configs`](https://github.com/nsEytgXm/subagents_configs), while
preserving the existing minions flow:

OpenAI Codex (native and Pi):

| Role | Model | Reasoning |
|------|-------|-----------|
| Frontier | `gpt-5.6-sol` | medium |
| Mechanical | `gpt-5.6-luna` | low |
| Explorer | `gpt-5.6-luna` | medium |
| Implementer / architect / planner | `gpt-5.6-luna` | high |
| Reviewer | `gpt-5.6-sol` | low |

GitHub Copilot (native and Pi):

| Role | Model | Reasoning |
|------|-------|-----------|
| Frontier | `gpt-5.6-sol` | medium |
| Mechanical / explorer / implementer / architect / planner | `grok-4.5` | high |
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
  pi-minions/              Provider-affine adapter over pi-subagents RPC v1
    agents/                Managed Pi role agents and two-axis review leaf
```

Installers create autosufficient skill directories by copying the core and selected
overlay. They do not generate or template Markdown.

## Discipline skills

The frontier dispatches; discipline skills define how workers engineer:
`grilling`, `implement`, `tdd`, `code-review`, `to-spec`, `to-tickets`,
`codebase-design`, `domain-modeling`, and `diagnosing-bugs`.

The platform-aware updater installs all nine referenced disciplines from a pinned,
reviewed `mattpocock/skills` revision: `grilling`, `implement`, `tdd`, `code-review`,
`to-spec`, `to-tickets`, `codebase-design`, `domain-modeling`, and
`diagnosing-bugs`:

```powershell
scripts/update-disciplines.ps1 -Platform all
```

```bash
scripts/update-disciplines.sh --platform all
```

Copilot registers cache directories with `copilot skill add`. Codex uses managed
links under `~/.agents/skills`; Pi uses managed links under `~/.pi/agent/skills`.
The pinned revision is `2ab958093e83e0ec752e6c1c5932da465bf23e0c`; pass an
explicit `REF`/`-Ref` to test an upgrade. Pi workers receive a detected discipline
explicitly through `pi-subagents`; missing disciplines remain non-fatal because
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
IDs and a real native-subagent orchestration cycle. Pi remains beta until real
`pi-subagents` orchestration and resume runs pass with both `openai-codex` and
`github-copilot`.

## License

MIT
