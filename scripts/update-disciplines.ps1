#Requires -Version 5.0
param(
    [ValidateSet('copilot', 'codex', 'pi', 'all')]
    [string]$Platform = 'copilot',
    [string]$CacheDir,
    [string]$Ref = '2ab958093e83e0ec752e6c1c5932da465bf23e0c'
)

$ErrorActionPreference = 'Stop'
$repoUrl = 'https://github.com/mattpocock/skills.git'
$disciplines = @(
    [pscustomobject]@{ Name = 'implement'; Path = 'engineering\implement' },
    [pscustomobject]@{ Name = 'to-spec'; Path = 'engineering\to-spec' },
    [pscustomobject]@{ Name = 'to-tickets'; Path = 'engineering\to-tickets' },
    [pscustomobject]@{ Name = 'tdd'; Path = 'engineering\tdd' },
    [pscustomobject]@{ Name = 'code-review'; Path = 'engineering\code-review' },
    [pscustomobject]@{ Name = 'diagnosing-bugs'; Path = 'engineering\diagnosing-bugs' },
    [pscustomobject]@{ Name = 'codebase-design'; Path = 'engineering\codebase-design' },
    [pscustomobject]@{ Name = 'domain-modeling'; Path = 'engineering\domain-modeling' },
    [pscustomobject]@{ Name = 'grilling'; Path = 'productivity\grilling' }
)
$installHome = if ($env:MINIONS_HOME) { $env:MINIONS_HOME } else { $HOME }

if (-not $CacheDir) {
    $base = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { Join-Path $HOME '.cache' }
    $CacheDir = Join-Path $base 'copilot-minions\mattpocock-skills'
}

function Test-Selected([string]$name) {
    return $Platform -eq $name -or $Platform -eq 'all'
}

function Require-Command([string]$name) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
        throw "$name not found on PATH."
    }
}

Require-Command git
if (Test-Selected 'copilot') {
    Require-Command copilot
}

if (Test-Path -LiteralPath (Join-Path $CacheDir '.git')) {
    Write-Host "Updating source: $CacheDir"
    & git -C $CacheDir fetch --quiet --depth 1 origin $Ref
    if ($LASTEXITCODE -ne 0) {
        throw 'Unable to fetch the discipline source.'
    }
    & git -C $CacheDir reset --hard --quiet FETCH_HEAD
    if ($LASTEXITCODE -ne 0) {
        throw 'Unable to reset the discipline source.'
    }
} else {
    Write-Host "Cloning source into: $CacheDir"
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $CacheDir) | Out-Null
    & git clone --quiet --filter=blob:none --no-checkout $repoUrl $CacheDir
    if ($LASTEXITCODE -ne 0) {
        throw 'Unable to clone the discipline source.'
    }
    & git -C $CacheDir fetch --quiet --depth 1 origin $Ref
    if ($LASTEXITCODE -ne 0) {
        throw 'Unable to fetch the pinned discipline source.'
    }
    & git -C $CacheDir checkout --quiet --detach FETCH_HEAD
    if ($LASTEXITCODE -ne 0) {
        throw 'Unable to check out the pinned discipline source.'
    }
}

$revision = (& git -C $CacheDir rev-parse --short HEAD).Trim()
if ($LASTEXITCODE -ne 0) {
    throw 'Unable to resolve the discipline source revision.'
}
Write-Host "Source at $Ref @ $revision"

$copilotSkills = @()
if (Test-Selected 'copilot') {
    $json = (& copilot skill list --json 2>$null | Out-String)
    if ($LASTEXITCODE -eq 0 -and $json.Trim()) {
        $copilotSkills = @($json | ConvertFrom-Json)
    }
}

foreach ($entry in $disciplines) {
    $discipline = $entry.Name
    $source = Join-Path $CacheDir "skills\$($entry.Path)"
    if (-not (Test-Path -LiteralPath $source -PathType Container)) {
        Write-Warning "Upstream no longer provides '$discipline'; skipping."
        continue
    }
    $canonical = (Resolve-Path -LiteralPath $source).Path

    if (Test-Selected 'copilot') {
        $stale = @($copilotSkills | Where-Object {
            $_.name -eq $discipline -and $_.source -eq 'custom' -and $_.path -ne $canonical
        })
        foreach ($entry in $stale) {
            Write-Host "Removing stale Copilot registration: $($entry.path)"
            & copilot skill remove $entry.path 2>$null | Out-Null
        }
        & copilot skill add $source | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "Unable to register Copilot discipline: $discipline"
        }
        Write-Host "  Copilot: $discipline -> $canonical"
    }

    if (Test-Selected 'codex') {
        $skillsDirectory = Join-Path $installHome '.agents\skills'
        $target = Join-Path $skillsDirectory $discipline
        New-Item -ItemType Directory -Force -Path $skillsDirectory | Out-Null

        if (Test-Path -LiteralPath $target) {
            $item = Get-Item -LiteralPath $target -Force
            if (-not $item.LinkType) {
                throw "Refusing to replace unmanaged Codex discipline: $target"
            }
            $linkTarget = @($item.Target)[0]
            if (-not [System.IO.Path]::IsPathRooted($linkTarget)) {
                $linkTarget = Join-Path (Split-Path -Parent $target) $linkTarget
            }
            $resolved = (Resolve-Path -LiteralPath $linkTarget).Path
            if ($resolved -ne $canonical) {
                throw "Codex discipline link points elsewhere: $target -> $resolved"
            }
        } else {
            $linkType = if ($PSVersionTable.Platform -eq 'Unix') { 'SymbolicLink' } else { 'Junction' }
            New-Item -ItemType $linkType -Path $target -Target $canonical | Out-Null
        }
        Write-Host "  Codex: $discipline -> $canonical"
    }

    if (Test-Selected 'pi') {
        $skillsDirectory = Join-Path $installHome '.pi\agent\skills'
        $target = Join-Path $skillsDirectory $discipline
        New-Item -ItemType Directory -Force -Path $skillsDirectory | Out-Null

        if (Test-Path -LiteralPath $target) {
            $item = Get-Item -LiteralPath $target -Force
            if (-not $item.LinkType) {
                throw "Refusing to replace unmanaged Pi discipline: $target"
            }
            $linkTarget = @($item.Target)[0]
            if (-not [System.IO.Path]::IsPathRooted($linkTarget)) {
                $linkTarget = Join-Path (Split-Path -Parent $target) $linkTarget
            }
            $resolved = (Resolve-Path -LiteralPath $linkTarget).Path
            if ($resolved -ne $canonical) {
                throw "Pi discipline link points elsewhere: $target -> $resolved"
            }
        } else {
            $linkType = if ($PSVersionTable.Platform -eq 'Unix') { 'SymbolicLink' } else { 'Junction' }
            New-Item -ItemType $linkType -Path $target -Target $canonical | Out-Null
        }
        Write-Host "  Pi: $discipline -> $canonical"
    }
}

Write-Host ''
Write-Host "Disciplines updated for platform: $Platform"
