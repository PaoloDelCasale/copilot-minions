#Requires -Version 5.0
<#
.SYNOPSIS
  Keep the copilot-minions discipline skills current with mattpocock/skills.

.DESCRIPTION
  copilot-minions references (never forks) Matt Pocock's engineering skills. This
  script clones/pulls mattpocock/skills into a portable cache and registers the
  three disciplines that are not in Copilot's default personal set — implement,
  to-spec, to-tickets — as custom skills (directory references). Because they are
  directory references to the cache, a weekly pull refreshes their content.

  Idempotent: safe to run repeatedly. Run manually, from install.ps1, or from a
  weekly Copilot scheduled workflow.

.PARAMETER CacheDir
  Where to keep the mattpocock/skills checkout. Defaults to
  %LOCALAPPDATA%\copilot-minions\mattpocock-skills.

.PARAMETER Ref
  Git ref/branch to track. Defaults to main.
#>
param(
    [string]$CacheDir,
    [string]$Ref = 'main'
)

$ErrorActionPreference = 'Stop'

$RepoUrl     = 'https://github.com/mattpocock/skills.git'
$Disciplines = @('implement', 'to-spec', 'to-tickets')

if (-not $CacheDir) {
    $base = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { Join-Path $HOME '.cache' }
    $CacheDir = Join-Path $base 'copilot-minions\mattpocock-skills'
}

function Require-Command($name) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
        Write-Error "$name not found on PATH."
        exit 1
    }
}
Require-Command git
Require-Command copilot

# --- 1. Clone or update the source ---------------------------------------------
if (Test-Path (Join-Path $CacheDir '.git')) {
    Write-Host "Updating source: $CacheDir"
    git -C $CacheDir fetch --quiet origin
    git -C $CacheDir reset --hard --quiet "origin/$Ref"
} else {
    Write-Host "Cloning source into: $CacheDir"
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $CacheDir) | Out-Null
    git clone --quiet --depth 1 --branch $Ref $RepoUrl $CacheDir
}
$rev = (git -C $CacheDir rev-parse --short HEAD).Trim()
Write-Host "Source at $Ref @ $rev"

# --- 2. Register each discipline from the cache --------------------------------
$list = & copilot skill list --json 2>$null | ConvertFrom-Json

foreach ($d in $Disciplines) {
    $dir = Join-Path $CacheDir "skills\engineering\$d"
    if (-not (Test-Path $dir)) {
        Write-Warning "Upstream no longer provides '$d' at skills/engineering/$d — skipping."
        continue
    }
    $canonical = (Resolve-Path $dir).Path

    # Drop any stale custom registration of this skill that points elsewhere.
    $stale = $list | Where-Object { $_.name -eq $d -and $_.source -eq 'custom' -and $_.path -ne $canonical }
    foreach ($s in $stale) {
        Write-Host "Removing stale registration: $($s.path)"
        & copilot skill remove $s.path 2>$null | Out-Null
    }

    # Register from the cache (idempotent — re-adding the same dir is harmless).
    & copilot skill add $dir | Out-Null
    Write-Host "  registered $d -> $canonical"
}

Write-Host ""
Write-Host "Disciplines updated. Verify with: copilot skill list"
