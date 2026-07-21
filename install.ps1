#Requires -Version 5.0
# Installs copilot-minions into the Copilot CLI user skills directory.
# Copies skills/copilot-minions -> ~/.agents/skills/copilot-minions
# Re-run after `git pull`.

$ErrorActionPreference = 'Stop'

$root   = Split-Path -Parent $MyInvocation.MyCommand.Path
$src    = Join-Path $root 'skills\copilot-minions'
$skills = Join-Path $HOME '.agents\skills'
$dest   = Join-Path $skills 'copilot-minions'

if (-not (Test-Path $src)) {
    Write-Error "Source not found: $src"
    exit 1
}

New-Item -ItemType Directory -Force -Path $skills | Out-Null

if (Test-Path $dest) {
    Remove-Item -Recurse -Force $dest
}
Copy-Item -Recurse -Force $src $dest

# Bundle the updater into the install dir so a scheduled workflow has a stable path.
$scriptsSrc = Join-Path $root 'scripts'
if (Test-Path $scriptsSrc) {
    Copy-Item -Recurse -Force $scriptsSrc (Join-Path $dest 'scripts')
}

Write-Host "Installed copilot-minions:"
Write-Host "  $dest"
Write-Host ""

# Register/update the discipline skills (implement, to-spec, to-tickets) from
# mattpocock/skills. Non-fatal: the orchestrator still runs on inline fallbacks.
$updater = Join-Path $root 'scripts\update-disciplines.ps1'
if (Test-Path $updater) {
    Write-Host "Updating discipline skills..."
    try { & $updater } catch { Write-Warning "Discipline update skipped: $($_.Exception.Message)" }
    Write-Host ""
}

Write-Host "Opt in with 'orchestrate', 'minions on', or 'go build it' in any project."
