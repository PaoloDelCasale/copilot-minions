# copilot-minions

Multi-platform orchestration skills for **GitHub Copilot CLI**, **OpenAI Codex**,
**Pi**, and **Paseo-hosted Pi**. A dispatch-only frontier coordinates bounded workers through a shared
board and STATUS protocol. Workers implement, explore, review, plan, and run commands
in isolated worktrees.

The methodology is shared; only platform capabilities differ:

- Copilot spawns background `task` agents and reads completion notifications.
- Codex spawns native subagents, uses managed custom agents, and exposes threads
  through `/agent`.
- Pi delegates persistent background workers through the versioned event-bus RPC
  exposed by [`pi-subagents`](https://github.com/nicobailon/pi-subagents), while
  retaining Minions provider affinity, role routing, budgets, and board identity.
- When Pi runs as a Paseo agent, the same extension selects Paseo's agent-scoped MCP
  instead. Workers are native Paseo child agents, visible in its subagent track, and
  Paseo owns their lifecycle, activity, persistence, usage, and notifications.

Codex, Pi, and Paseo support are **beta** until their authenticated release gates pass.

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
./install.ps1 -Platform paseo
./install.ps1 -Platform all
```

```bash
./install.sh --platform copilot
./install.sh --platform codex
./install.sh --platform pi
./install.sh --platform paseo
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

### Installation scope and destinations

Both installers support `global` (the default) and `project` scopes. Omitting the
scope preserves the existing global behavior and output. `MINIONS_HOME` remains only
an installer/test home override; it is not a project-scope switch.

| Scope | `pi` | `paseo` | `copilot` | `codex` | `all` |
|-------|------|---------|-----------|---------|-------|
| Global (default) | Supported | Supported | Supported | Supported | Supported |
| Project | Supported | Supported | Not supported | Not supported | Not supported |

Project scope targets the invocation directory unless `--target-dir`/
`-TargetDirectory` names another existing directory. `all`, Copilot, and Codex are
rejected in project scope before anything is written.

Global destinations:

| Platform | Skill | Extension/runtime companions |
|----------|-------|------------------------------|
| Copilot | `~/.copilot/skills/copilot-minions[-lb]` | Native Copilot agent types |
| Codex | `~/.agents/skills/codex-minions[-lb]` | `~/.codex/agents/codex-minions[-lb]-*.toml` |
| Pi | `~/.pi/agent/skills/pi-minions[-lb]` | `~/.pi/agent/extensions/pi-minions`, `~/.pi/agent/agents/copilot-minions`, and `~/.pi/agent/npm/` |
| Paseo + Pi | Same Pi skill and extension (`paseo-minions` is an alias) | `~/.pi/agent/npm/` contains the MCP adapter; worker prompts are read from `agents/` beside the extension, and workers are native Paseo children |

Project-local destinations:

| Platform | Destinations under the target |
|----------|-------------------------------|
| Pi | `.pi/skills/pi-minions[-lb]`, `.pi/extensions/pi-minions`, `.pi/agents/copilot-minions`, `.pi/settings.json`, `.pi/npm/` |
| Paseo + Pi | `.pi/skills/pi-minions[-lb]`, `.pi/extensions/pi-minions` (including adjacent `agents/` prompts), `.pi/settings.json`, `.pi/npm/`; no `.pi/agents/copilot-minions` copy |

The project installer runs `pi install -l` from the resolved target, never creates
`.pi/agent` or modifies `~/.pi/agent`, skips the global discipline updater, and
refuses unmanaged destination collisions. Managed resources are staged and replaced transactionally, so reruns are
idempotent and a failed commit rolls existing resources back. A per-target lock
prevents overlapping installers.

Pi's project scope is self-contained for Minions: the local package record is in
`.pi/settings.json`, npm content is under `.pi/npm/`, and `pi-subagents` recursively
discovers companion definitions under `.pi/agents/copilot-minions/`. It is not a
hermetic Pi profile: unrelated global Pi settings/resources remain inherited, and
project resources/packages load only after the worktree is trusted.

Verified against Pi `@earendil-works/pi-coding-agent` **v0.82.1**
([package scope and npm destinations](https://github.com/earendil-works/pi/blob/v0.82.1/packages/coding-agent/docs/packages.md#L43-L65))
and `pi-subagents` **v0.37.2**
([documented agent precedence and paths](https://github.com/nicobailon/pi-subagents/blob/v0.37.2/README.md#L658-L671),
[project directory construction](https://github.com/nicobailon/pi-subagents/blob/v0.37.2/src/agents/agents.ts#L1493-L1506), and
[recursive project loading](https://github.com/nicobailon/pi-subagents/blob/v0.37.2/src/agents/agents.ts#L1537-L1588)).

### Project-local Pi and Paseo

From an existing clone, install into the current directory (or add the target option
shown below):

```bash
./install.sh --platform pi --scope project
./install.sh --platform paseo --scope project
./install.sh --platform pi --scope project --variant lb
./install.sh --platform paseo --scope project --variant all --target-dir /path/to/project
```

```powershell
./install.ps1 -Platform pi -Scope project
./install.ps1 -Platform paseo -Scope project
./install.ps1 -Platform pi -Scope project -Variant lb
./install.ps1 -Platform paseo -Scope project -Variant all -TargetDirectory C:\path\to\project
```

`Variant` still defaults to `standard`; `lb` installs only the low-budget skill and
`all` installs both variants side-by-side.

### Paseo Worktree Setup (temporary pinned clone)

Paste the matching snippet into Paseo's Worktree Setup. It clones a pinned source
revision into a temporary directory and delegates the complete installation to the
repository installer with one installer command. The full commit SHA is fixed to the
reviewed implementation; update it deliberately when adopting a newer release.

Bash:

```bash
set -Eeuo pipefail

REPO=https://github.com/PaoloDelCasale/copilot-minions.git
REF=f8cc992e3053a84122412cde9e7baa899379cf6e
TEMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/copilot-minions.XXXXXXXX")
SOURCE=$TEMP_DIR/source
trap 'rm -rf -- "$TEMP_DIR"' EXIT

git clone --filter=blob:none --no-checkout "$REPO" "$SOURCE"
git -C "$SOURCE" fetch --depth 1 origin "$REF"
git -C "$SOURCE" checkout --detach FETCH_HEAD
[[ $(git -C "$SOURCE" rev-parse HEAD) == "$REF" ]] || {
  echo "Unexpected source revision" >&2
  exit 1
}

bash "$SOURCE/install.sh" --platform paseo --scope project
```

PowerShell 5+:

```powershell
$ErrorActionPreference = 'Stop'
$repo = 'https://github.com/PaoloDelCasale/copilot-minions.git'
$ref = 'f8cc992e3053a84122412cde9e7baa899379cf6e'
$tempDir = Join-Path ([IO.Path]::GetTempPath()) ("copilot-minions-{0}" -f [Guid]::NewGuid().ToString('N'))
$source = Join-Path $tempDir 'source'

try {
    New-Item -ItemType Directory -Path $tempDir | Out-Null
    & git clone --filter=blob:none --no-checkout $repo $source
    if ($LASTEXITCODE -ne 0) { throw 'git clone failed' }
    & git -C $source fetch --depth 1 origin $ref
    if ($LASTEXITCODE -ne 0) { throw 'git fetch failed' }
    & git -C $source checkout --detach FETCH_HEAD
    if ($LASTEXITCODE -ne 0) { throw 'git checkout failed' }
    $actualRef = (& git -C $source rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or $actualRef -ne $ref) { throw 'Unexpected source revision' }

    & (Join-Path $source 'install.ps1') -Platform paseo -Scope project
} finally {
    if (Test-Path -LiteralPath $tempDir) {
        Remove-Item -Recurse -Force -LiteralPath $tempDir
    }
}
```

Codex installation requires `codex` on `PATH` and runs `codex debug models` before
writing files. It requires Sol and Luna, plus Terra for the standard variant. Pi
and Paseo installation require `pi` on `PATH` without requiring model
availability. `-Platform pi` installs pinned `npm:pi-subagents@0.37.2`;
`-Platform paseo` installs pinned `npm:pi-mcp-adapter@2.16.0`; `all` installs both.
The MCP adapter is the bridge Paseo probes before injecting its agent-scoped
`create_agent` control plane into Pi. A Paseo-hosted session fails closed
instead of falling back to invisible `pi-subagents` workers when that bridge is absent;
run the Paseo platform installer and reopen the Paseo agent. Set
`PI_SUBAGENTS_PACKAGE` or `PI_MCP_ADAPTER_PACKAGE` only when deliberately testing another compatible package
version. Pi validates the active provider's exact model routes when an orchestration
run starts. `all` preflights and stages every platform before replacing any Minions
installation.

The six Codex and seven Pi agent files are namespaced and carry managed markers. Pi
skills and the shared extension are managed as well. The installer updates only
managed Pi/Codex resources and refuses to overwrite a user-owned collision.

## Usage

Copilot and Codex retain their documented natural-language triggers and explicit
platform skill names. Pi is strictly slash-command-only: use `/minions` or
`/skill:pi-minions` for the standard profile and `/minions-lb` or
`/skill:pi-minions-lb` for the low-budget profile. Merely mentioning Minions,
orchestration, parallel agents, or workers never authorizes the Pi extension to
start a run. `minions_start` enforces this authorization in code rather than relying
only on model instructions.

Each orchestration run declares one bounded Goal, completion criteria, out-of-scope
work, fixed point, verification contract, and worker/triage budgets. After eight
worker results the frontier enters closure mode and permits only already-boarded fix,
review, gate, commit, or landing work. At thirty results it stops dispatching, drains
in-flight work, posts a full handoff, and closes the run. Adjacent issue slices require
a new explicit Goal.

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

### Pi provider affinity and Paseo runtime selection

Starting either Pi skill captures the parent provider. Only `openai-codex` and
`github-copilot` are accepted. The frontier switches to
`<provider>/gpt-5.6-sol:medium`; workers use that provider's matrix while every model
is qualified with the same provider. Required-model preflight and route lookup are
provider-specific. At orchestration start, the runtime requires exact catalog
IDs—including `github-copilot/grok-4.5`—and directs users to upgrade Pi when a route
is missing; there is no cross-provider or availability fallback. Installation does
not require those models to be available. Closing the run restores the parent's
original model and thinking level.

Outside Paseo, workers use namespaced `pi-subagents` agents and explicit
provider-qualified model routes. `pi-subagents` owns process lifecycle, FleetView,
artifacts, session recovery, supervisor communication, steering, timeout enforcement,
and completion notifications. In a Paseo agent-scoped session, Minions discovers the
injected `/mcp/agents` endpoint and creates `pi/<provider>/<model>` native child
agents in the caller's existing Paseo Workspace. It never creates a new Paseo
Workspace: linked Git worktrees provide write isolation and are passed only as worker
`cwd` values. Minions projects Paseo status, recent activity, token/cost usage,
cancellation, and follow-up runs onto the same `minions_*` interface. Paseo keeps one native agent ID
while Minions assigns a new execution ID to each resumed run so launch and triage
budgets remain exact. Minions persists both IDs across reloads. Paused, failed, and
completed workers can be resumed; a completed architect may remain the same-slice
architecture owner when Goal, Spec, fixed point, worktree, and budget eligibility are
unchanged. Reviewers remain fresh and independent, while simple gate or compatibility
fixes stay on mechanical or implementer routes. Deliberately stopped workers remain
non-resumable. Paseo-managed workers currently reject `timeoutSeconds` because Paseo
0.2.5 does not expose a persistent child deadline.

The wrapper enforces six concurrent workers and thirty launches. Eight triaged
results trigger a soft gate that accepts only `budgetClass: "closure"` work; thirty
results trigger the hard handoff. Implementer and architect launches require an
explicit linked Git worktree; the runtime rejects a primary checkout before
spawning. Worker usage is credited exactly once through `minions_read`, with
`minions_close` flushing unread completion usage. Missed notifications are
reconciled from the package's persistent lifecycle v3 artifact. `timeoutSeconds`
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
  pi-minions/              Provider-affine runtime seam for pi-subagents and Paseo
    paseo-runtime.mjs      Paseo MCP discovery, transport, and lifecycle adapter
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

Platform changes land as backward-compatible PRs. The first `v0.1.0`
release is gated on a manual authenticated Codex run confirming the required model
IDs and a real native-subagent orchestration cycle. Pi remains beta until real
`pi-subagents` orchestration and resume runs pass with both `openai-codex` and
`github-copilot`. Paseo support additionally requires an authenticated Paseo-hosted
Pi run covering native child visibility, completion notification, stop, and follow-up.

## License

MIT
