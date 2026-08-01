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

The installers above are **global-only**; they have no scope switch. `MINIONS_HOME`
is an installer/test home override, not a project-scope mode. Scope support is:

| Scope | `pi` | `paseo` | `copilot` | `codex` | `all` |
|-------|------|---------|-----------|---------|-------|
| Global installer | Supported | Supported | Supported | Supported | Supported |
| Project-local Worktree Setup below | Supported | Supported | Not implemented | Not implemented | Not supported |

Therefore `--platform all`/`-Platform all` is global-only. Do not substitute the
current worktree for `MINIONS_HOME`: that would create user-layout paths such as
`.pi/agent/...`, not Pi's project paths. Project-local Copilot and Codex layouts are
not claimed until their native discovery and companion-agent behavior are verified.

Global destinations:

| Platform | Skill | Extension/runtime companions |
|----------|-------|------------------------------|
| Copilot | `~/.copilot/skills/copilot-minions[-lb]` | Native Copilot agent types |
| Codex | `~/.agents/skills/codex-minions[-lb]` | `~/.codex/agents/codex-minions[-lb]-*.toml` |
| Pi | `~/.pi/agent/skills/pi-minions[-lb]` | `~/.pi/agent/extensions/pi-minions`, `~/.pi/agent/agents/copilot-minions`, and `~/.pi/agent/npm/` |
| Paseo + Pi | Same Pi skill and extension (`paseo-minions` is an alias) | `~/.pi/agent/npm/` contains the MCP adapter; worker prompts are read from `agents/` beside the extension, and workers are native Paseo children |

Project-local Pi/Paseo destinations created by the Worktree Setup snippets:

| Platform | Destinations in the current worktree |
|----------|--------------------------------------|
| Pi | `.pi/skills/pi-minions`, `.pi/extensions/pi-minions`, `.pi/agents/copilot-minions`, `.pi/settings.json`, `.pi/npm/` |
| Paseo + Pi | `.pi/skills/pi-minions`, `.pi/extensions/pi-minions` (including its adjacent `agents/` prompts), `.pi/settings.json`, `.pi/npm/`; no `.pi/agents/copilot-minions` copy is needed |

Pi's project scope is self-contained for Minions: `pi install -l` records the pinned
runtime in `.pi/settings.json`, installs npm content under `.pi/npm/`, and
`pi-subagents` recursively discovers companion definitions under
`.pi/agents/copilot-minions/`. It does not write Minions resources to the user home.
It is not a hermetic Pi profile: unrelated global Pi settings/resources remain
inherited, and project resources/packages load only after the worktree is trusted.

Verified against Pi `@earendil-works/pi-coding-agent` **v0.82.1**
([package scope and npm destinations](https://github.com/earendil-works/pi/blob/v0.82.1/packages/coding-agent/docs/packages.md#L43-L65))
and `pi-subagents` **v0.37.2**
([documented agent precedence and paths](https://github.com/nicobailon/pi-subagents/blob/v0.37.2/README.md#L658-L671),
[project directory construction](https://github.com/nicobailon/pi-subagents/blob/v0.37.2/src/agents/agents.ts#L1493-L1506), and
[recursive project loading](https://github.com/nicobailon/pi-subagents/blob/v0.37.2/src/agents/agents.ts#L1537-L1588)).

### Paseo Worktree Setup (project-local Pi)

Paste one of these into Paseo's Worktree Setup. It installs into the **current
worktree** without invoking the global-only installers. It defaults to ordinary Pi;
set `MINIONS_PLATFORM=paseo` to install the Paseo MCP adapter instead. This repository
has no release tag yet, so `13e5813bcc4a3c6b80c83f45cc1451b80e1601f2` is an
explicit placeholder pin; replace it only with a reviewed release tag or commit.
Existing Minions destination directories are refused rather than overwritten.

Bash:

```bash
set -Eeuo pipefail

TARGET=$PWD
REPO=https://github.com/PaoloDelCasale/copilot-minions.git
REF=13e5813bcc4a3c6b80c83f45cc1451b80e1601f2
PLATFORM=${MINIONS_PLATFORM:-pi} # pi | paseo
TEMP_ROOT=${TMPDIR:-/tmp}
TEMP_ROOT=${TEMP_ROOT%/}
TEMP_DIR=$(mktemp -d "$TEMP_ROOT/copilot-minions.XXXXXXXX")
SOURCE=$TEMP_DIR/source

cleanup() {
  [[ -n ${TEMP_DIR:-} && -d $TEMP_DIR && $TEMP_DIR == "$TEMP_ROOT"/copilot-minions.* ]] &&
    rm -rf -- "$TEMP_DIR"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

case "$PLATFORM" in pi|paseo) ;; *) echo "MINIONS_PLATFORM must be pi or paseo" >&2; exit 2 ;; esac
command -v pi >/dev/null || { echo "pi not found on PATH" >&2; exit 1; }
git clone --filter=blob:none --no-checkout "$REPO" "$SOURCE"
git -C "$SOURCE" fetch --depth 1 origin "$REF"
git -C "$SOURCE" checkout --detach FETCH_HEAD
[[ $(git -C "$SOURCE" rev-parse HEAD) == "$REF" ]] || { echo "Unexpected source revision" >&2; exit 1; }

SKILL=$TARGET/.pi/skills/pi-minions
EXTENSION=$TARGET/.pi/extensions/pi-minions
AGENTS=$TARGET/.pi/agents/copilot-minions
for destination in "$SKILL" "$EXTENSION"; do
  [[ ! -e $destination ]] || { echo "Refusing to overwrite $destination" >&2; exit 1; }
done
[[ $PLATFORM == paseo || ! -e $AGENTS ]] || { echo "Refusing to overwrite $AGENTS" >&2; exit 1; }

PACKAGE=npm:pi-subagents@0.37.2
[[ $PLATFORM == paseo ]] && PACKAGE=npm:pi-mcp-adapter@2.16.0
pi install -l "$PACKAGE"

mkdir -p "$SKILL" "$(dirname "$EXTENSION")"
cp -R "$SOURCE/skills/core/." "$SKILL/"
cp "$SOURCE/skills/pi-minions/SKILL.md" "$SOURCE/skills/pi-minions/platform.md" \
  "$SOURCE/skills/pi-minions/models.md" "$SKILL/"
cp -R "$SOURCE/scripts" "$SKILL/scripts"
printf '%s\n' 'managed-by: copilot-minions' > "$SKILL/.managed-by-copilot-minions"
cp -R "$SOURCE/extensions/pi-minions" "$EXTENSION"
if [[ $PLATFORM == pi ]]; then
  mkdir -p "$(dirname "$AGENTS")"
  cp -R "$SOURCE/extensions/pi-minions/agents" "$AGENTS"
fi
```

PowerShell 5+:

```powershell
$ErrorActionPreference = 'Stop'
$target = (Get-Location).ProviderPath
$repo = 'https://github.com/PaoloDelCasale/copilot-minions.git'
$ref = '13e5813bcc4a3c6b80c83f45cc1451b80e1601f2'
$platform = if ($env:MINIONS_PLATFORM) { $env:MINIONS_PLATFORM } else { 'pi' } # pi | paseo
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$tempDir = Join-Path $tempRoot ("copilot-minions-{0}" -f [Guid]::NewGuid().ToString('N'))
$source = Join-Path $tempDir 'source'

try {
    if ($platform -notin @('pi', 'paseo')) { throw 'MINIONS_PLATFORM must be pi or paseo' }
    if (-not (Get-Command pi -ErrorAction SilentlyContinue)) { throw 'pi not found on PATH' }
    New-Item -ItemType Directory -Path $tempDir | Out-Null
    & git clone --filter=blob:none --no-checkout $repo $source
    if ($LASTEXITCODE -ne 0) { throw 'git clone failed' }
    & git -C $source fetch --depth 1 origin $ref
    if ($LASTEXITCODE -ne 0) { throw 'git fetch failed' }
    & git -C $source checkout --detach FETCH_HEAD
    if ($LASTEXITCODE -ne 0) { throw 'git checkout failed' }
    $actualRef = (& git -C $source rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or $actualRef -ne $ref) { throw 'Unexpected source revision' }

    $skill = Join-Path $target '.pi\skills\pi-minions'
    $extension = Join-Path $target '.pi\extensions\pi-minions'
    $agents = Join-Path $target '.pi\agents\copilot-minions'
    $destinations = @($skill, $extension)
    if ($platform -eq 'pi') { $destinations += $agents }
    foreach ($destination in $destinations) {
        if (Test-Path -LiteralPath $destination) { throw "Refusing to overwrite $destination" }
    }

    $package = if ($platform -eq 'paseo') { 'npm:pi-mcp-adapter@2.16.0' } else { 'npm:pi-subagents@0.37.2' }
    & pi install -l $package
    if ($LASTEXITCODE -ne 0) { throw "pi install failed for $package" }

    New-Item -ItemType Directory -Force -Path $skill, (Split-Path -Parent $extension) | Out-Null
    Copy-Item -Recurse -Force (Join-Path $source 'skills\core\*') $skill
    Copy-Item -Force (Join-Path $source 'skills\pi-minions\SKILL.md'), `
        (Join-Path $source 'skills\pi-minions\platform.md'), `
        (Join-Path $source 'skills\pi-minions\models.md') $skill
    Copy-Item -Recurse -LiteralPath (Join-Path $source 'scripts') -Destination (Join-Path $skill 'scripts')
    Set-Content -LiteralPath (Join-Path $skill '.managed-by-copilot-minions') -Value 'managed-by: copilot-minions'
    Copy-Item -Recurse -LiteralPath (Join-Path $source 'extensions\pi-minions') -Destination $extension
    if ($platform -eq 'pi') {
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $agents) | Out-Null
        Copy-Item -Recurse -LiteralPath (Join-Path $source 'extensions\pi-minions\agents') -Destination $agents
    }
} finally {
    $resolvedTemp = [IO.Path]::GetFullPath($tempDir)
    if ($resolvedTemp.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and
        (Split-Path -Leaf $resolvedTemp) -like 'copilot-minions-*' -and
        (Test-Path -LiteralPath $resolvedTemp)) {
        Remove-Item -Recurse -Force -LiteralPath $resolvedTemp
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

Standard triggers: `orchestrate`, `go build it`, `minions on`, and planning-to-build
flows. Platform names are explicit: `copilot-minions`, `codex-minions`, and
`pi-minions`; Paseo-hosted Pi also accepts the `paseo-minions` alias.
Low-budget variants trigger on `orchestrate low budget`, `minions lb`, or their
explicit names.

Opt out with `/direct`, `skip minions`, or `skip workers`.

Each orchestration run declares one bounded Goal, completion criteria, out-of-scope
work, fixed point, verification contract, and worker/triage budgets. After eight
worker results the frontier enters closure mode and permits only already-boarded fix,
review, gate, commit, or landing work. At twelve results it stops dispatching, drains
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
injected `/mcp/agents` endpoint, creates `pi/<provider>/<model>` native child agents,
and projects Paseo status, recent activity, token/cost usage, cancellation, and
follow-up runs onto the same `minions_*` interface. Paseo keeps one native agent ID
while Minions assigns a new execution ID to each resumed run so launch and triage
budgets remain exact. Minions persists both IDs across reloads. Deliberately stopped
workers remain non-resumable. Paseo-managed workers currently reject
`timeoutSeconds` because Paseo 0.2.5 does not expose a persistent child deadline.

The wrapper enforces six concurrent workers and twelve launches. Eight triaged
results trigger a soft gate that accepts only `budgetClass: "closure"` work; twelve
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
