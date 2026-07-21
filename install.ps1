#Requires -Version 5.0
param(
    [ValidateSet('copilot', 'codex', 'pi', 'all')]
    [string]$Platform = 'copilot',
    [ValidateSet('standard', 'lb', 'all')]
    [string]$Variant = 'standard'
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$installHome = if ($env:MINIONS_HOME) { $env:MINIONS_HOME } else { $HOME }
$core = Join-Path $root 'skills\core'
$lbProfile = Join-Path $root 'skills\lb'
$managedMarker = '# managed-by: copilot-minions'
$transactionId = [Guid]::NewGuid().ToString('N')
$stagedSkills = @()
$agentStages = @()
$skillBackups = @()
$touchedSkillDestinations = @()
$agentBackups = @()
$newAgentPaths = @()
$obsoleteAgentPaths = @()
$transactionStarted = $false

function Test-Platform([string]$name) {
    return $Platform -eq $name -or $Platform -eq 'all'
}

function Test-Variant([string]$name) {
    return $Variant -eq $name -or $Variant -eq 'all'
}

function Assert-Directory([string]$path) {
    if (-not (Test-Path -LiteralPath $path -PathType Container)) {
        throw "Source directory not found: $path"
    }
}

function Assert-PiAvailable {
    if (-not (Get-Command pi -ErrorAction SilentlyContinue)) {
        throw 'pi not found on PATH; Pi installation requires the Pi coding agent.'
    }
}

function Assert-CodexModels {
    if (-not (Get-Command codex -ErrorAction SilentlyContinue)) {
        throw 'codex not found on PATH; Codex installation requires a model-catalog preflight.'
    }
    $catalog = (& codex debug models 2>&1 | Out-String)
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to read the Codex model catalog:`n$catalog"
    }

    try {
        $parsedCatalog = $catalog | ConvertFrom-Json
    } catch {
        throw "Codex returned an invalid model catalog: $($_.Exception.Message)"
    }
    function Get-JsonStringValues($value) {
        if ($null -eq $value) { return }
        if ($value -is [string]) { $value; return }
        if ($value -is [System.Collections.IDictionary]) {
            foreach ($entry in $value.GetEnumerator()) { Get-JsonStringValues $entry.Value }
            return
        }
        if ($value -is [System.Collections.IEnumerable] -and
            -not ($value -is [pscustomobject])) {
            foreach ($entry in $value) { Get-JsonStringValues $entry }
            return
        }
        foreach ($property in $value.PSObject.Properties) {
            Get-JsonStringValues $property.Value
        }
    }
    $catalogValues = @(Get-JsonStringValues $parsedCatalog)

    $required = @('gpt-5.6-sol', 'gpt-5.6-luna')
    if (Test-Variant 'standard') {
        $required += 'gpt-5.6-terra'
    }
    $missing = @($required | Sort-Object -Unique |
        Where-Object { $catalogValues -notcontains $_ })
    if ($missing.Count -gt 0) {
        throw "Codex model catalog is missing required model(s): $($missing -join ', ')"
    }
}

function Assert-ManagedFile([string]$path) {
    if ((Test-Path -LiteralPath $path) -and
        -not ((Get-Content -LiteralPath $path -TotalCount 1) -eq $managedMarker)) {
        throw "Refusing to overwrite unmanaged Codex agent file: $path"
    }
}

function Assert-ManagedPiDirectory([string]$path) {
    if ((Test-Path -LiteralPath $path) -and
        -not (Test-Path -LiteralPath (Join-Path $path '.managed-by-copilot-minions') -PathType Leaf)) {
        throw "Refusing to overwrite unmanaged Pi resource: $path"
    }
}

function New-SkillStage(
    [string]$name,
    [string]$overlay,
    [string]$profile,
    [string]$destination,
    [bool]$managed = $false
) {
    Assert-Directory $overlay
    $parent = Split-Path -Parent $destination
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    $stage = Join-Path $parent ".$name.stage.$transactionId"
    New-Item -ItemType Directory -Force -Path $stage | Out-Null

    Copy-Item -Recurse -Force (Join-Path $core '*') $stage
    if ($profile) {
        Assert-Directory $profile
        Copy-Item -Recurse -Force (Join-Path $profile '*') $stage
    }
    Copy-Item -Force (Join-Path $overlay 'SKILL.md') $stage
    Copy-Item -Force (Join-Path $overlay 'platform.md') $stage
    if (Test-Path -LiteralPath (Join-Path $root 'scripts')) {
        Copy-Item -Recurse -Force (Join-Path $root 'scripts') (Join-Path $stage 'scripts')
    }
    if ($managed) {
        Set-Content -LiteralPath (Join-Path $stage '.managed-by-copilot-minions') -Value 'managed-by: copilot-minions'
    }

    $script:stagedSkills += [pscustomobject]@{
        Name = $name
        Stage = $stage
        Destination = $destination
    }
}

function New-PiExtensionStage {
    $source = Join-Path $root 'extensions\pi-minions'
    $destination = Join-Path $installHome '.pi\agent\extensions\pi-minions'
    Assert-Directory $source
    Assert-ManagedPiDirectory $destination
    $parent = Split-Path -Parent $destination
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    $stage = Join-Path $parent ".pi-minions.stage.$transactionId"
    New-Item -ItemType Directory -Force -Path $stage | Out-Null
    Copy-Item -Recurse -Force (Join-Path $source '*') $stage
    Copy-Item -Force (Join-Path $source '.managed-by-copilot-minions') $stage
    $script:stagedSkills += [pscustomobject]@{
        Name = 'pi-minions-extension'
        Stage = $stage
        Destination = $destination
    }
}

function New-AgentStage([string]$packageName, [string]$overlay) {
    $source = Join-Path $overlay 'custom-agents'
    Assert-Directory $source
    $agentsDirectory = Join-Path $installHome '.codex\agents'
    New-Item -ItemType Directory -Force -Path $agentsDirectory | Out-Null
    $stage = Join-Path $agentsDirectory ".$packageName.stage.$transactionId"
    New-Item -ItemType Directory -Force -Path $stage | Out-Null

    $agentNames = @()
    foreach ($file in Get-ChildItem -LiteralPath $source -Filter '*.toml' -File) {
        $target = Join-Path $agentsDirectory $file.Name
        Assert-ManagedFile $target
        Copy-Item -Force $file.FullName (Join-Path $stage $file.Name)
        $agentNames += $file.Name
    }

    $manifestName = ".$packageName-manifest"
    $manifestPath = Join-Path $agentsDirectory $manifestName
    Assert-ManagedFile $manifestPath
    if (Test-Path -LiteralPath $manifestPath) {
        foreach ($oldName in @(Get-Content -LiteralPath $manifestPath | Select-Object -Skip 1)) {
            if ($oldName -and $oldName -notin $agentNames) {
                $oldPath = Join-Path $agentsDirectory $oldName
                Assert-ManagedFile $oldPath
                $script:obsoleteAgentPaths += $oldPath
            }
        }
    }
    @($managedMarker) + ($agentNames | Sort-Object) |
        Set-Content -LiteralPath (Join-Path $stage $manifestName)
    $script:agentStages += [pscustomobject]@{ Stage = $stage; Directory = $agentsDirectory }
}

function Add-VariantStages([string]$variantName) {
    $suffix = if ($variantName -eq 'lb') { '-lb' } else { '' }
    $profile = if ($variantName -eq 'lb') { $lbProfile } else { $null }

    if (Test-Platform 'copilot') {
        $name = "copilot-minions$suffix"
        $overlay = Join-Path $root "skills\$name"
        New-SkillStage $name $overlay $profile (Join-Path $installHome ".copilot\skills\$name")
    }
    if (Test-Platform 'codex') {
        $name = "codex-minions$suffix"
        $overlay = Join-Path $root "skills\$name"
        New-AgentStage $name $overlay
        New-SkillStage $name $overlay $profile (Join-Path $installHome ".agents\skills\$name")
    }
    if (Test-Platform 'pi') {
        $name = "pi-minions$suffix"
        $overlay = Join-Path $root "skills\$name"
        $destination = Join-Path $installHome ".pi\agent\skills\$name"
        Assert-ManagedPiDirectory $destination
        New-SkillStage $name $overlay $profile $destination $true
    }
}

function Commit-Transaction {
    $script:transactionStarted = $true
    foreach ($skill in $stagedSkills) {
        $backup = "$($skill.Destination).backup.$transactionId"
        if (Test-Path -LiteralPath $skill.Destination) {
            Move-Item -LiteralPath $skill.Destination -Destination $backup
            $script:skillBackups += [pscustomobject]@{
                Destination = $skill.Destination
                Backup = $backup
            }
        }
        $script:touchedSkillDestinations += $skill.Destination
        Move-Item -LiteralPath $skill.Stage -Destination $skill.Destination
    }

    foreach ($target in $obsoleteAgentPaths) {
        if (Test-Path -LiteralPath $target) {
            $backup = "$target.backup.$transactionId"
            Move-Item -LiteralPath $target -Destination $backup
            $script:agentBackups += [pscustomobject]@{ Target = $target; Backup = $backup }
        }
    }
    foreach ($agentStage in $agentStages) {
        foreach ($file in Get-ChildItem -LiteralPath $agentStage.Stage -File) {
            $target = Join-Path $agentStage.Directory $file.Name
            if (Test-Path -LiteralPath $target) {
                $backup = "$target.backup.$transactionId"
                Move-Item -LiteralPath $target -Destination $backup
                $script:agentBackups += [pscustomobject]@{ Target = $target; Backup = $backup }
            }
            Move-Item -LiteralPath $file.FullName -Destination $target
            $script:newAgentPaths += $target
        }
        Remove-Item -Recurse -Force -LiteralPath $agentStage.Stage
    }
}

function Undo-Transaction {
    foreach ($path in $newAgentPaths) {
        if (Test-Path -LiteralPath $path) {
            Remove-Item -Force -LiteralPath $path
        }
    }
    foreach ($entry in $agentBackups) {
        if (Test-Path -LiteralPath $entry.Backup) {
            Move-Item -LiteralPath $entry.Backup -Destination $entry.Target
        }
    }
    foreach ($destination in $touchedSkillDestinations) {
        if (Test-Path -LiteralPath $destination) {
            Remove-Item -Recurse -Force -LiteralPath $destination
        }
    }
    foreach ($entry in $skillBackups) {
        if (Test-Path -LiteralPath $entry.Destination) {
            Remove-Item -Recurse -Force -LiteralPath $entry.Destination
        }
        if (Test-Path -LiteralPath $entry.Backup) {
            Move-Item -LiteralPath $entry.Backup -Destination $entry.Destination
        }
    }
}

Assert-Directory $core

try {
    if (Test-Platform 'codex') {
        Assert-CodexModels
    }
    if (Test-Platform 'pi') {
        Assert-PiAvailable
        New-PiExtensionStage
    }
    if (Test-Variant 'standard') {
        Add-VariantStages 'standard'
    }
    if (Test-Variant 'lb') {
        Add-VariantStages 'lb'
    }
    Commit-Transaction
} catch {
    if ($transactionStarted) {
        Undo-Transaction
    }
    throw
} finally {
    foreach ($skill in $stagedSkills) {
        if (Test-Path -LiteralPath $skill.Stage) {
            Remove-Item -Recurse -Force -LiteralPath $skill.Stage
        }
    }
    foreach ($stage in $agentStages) {
        if (Test-Path -LiteralPath $stage.Stage) {
            Remove-Item -Recurse -Force -LiteralPath $stage.Stage
        }
    }
}

foreach ($entry in $skillBackups) {
    Remove-Item -Recurse -Force -LiteralPath $entry.Backup -ErrorAction SilentlyContinue
}
foreach ($entry in $agentBackups) {
    Remove-Item -Force -LiteralPath $entry.Backup -ErrorAction SilentlyContinue
}

Write-Host "Installed platform: $Platform; variant: $Variant"
foreach ($skill in $stagedSkills) {
    Write-Host "  $($skill.Destination)"
}
if (Test-Platform 'codex') {
    Write-Host "  $(Join-Path $installHome '.codex\agents') (managed minions agents)"
}
Write-Host ''

$updater = Join-Path $root 'scripts\update-disciplines.ps1'
if (Test-Path -LiteralPath $updater) {
    Write-Host 'Updating discipline skills...'
    try {
        & $updater -Platform $Platform
    } catch {
        Write-Warning "Discipline update skipped: $($_.Exception.Message)"
    }
    Write-Host ''
}

Write-Host "Opt in with 'orchestrate', 'minions on', or 'go build it'."
