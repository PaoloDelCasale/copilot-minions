$ErrorActionPreference = 'Stop'

function Assert-True([bool]$condition, [string]$message) {
    if (-not $condition) {
        throw "Assertion failed: $message"
    }
}

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$temp = Join-Path ([System.IO.Path]::GetTempPath()) "copilot-minions-tests-$([Guid]::NewGuid().ToString('N'))"
$testHome = Join-Path $temp 'home'
$bin = Join-Path $temp 'bin'
$cache = Join-Path $temp 'cache'
$oldPath = $env:PATH
$oldHome = $env:MINIONS_HOME
$oldLocalAppData = $env:LOCALAPPDATA

try {
    New-Item -ItemType Directory -Force -Path $testHome, $bin, (Join-Path $cache '.git') | Out-Null
    foreach ($discipline in @('implement', 'to-spec', 'to-tickets')) {
        $directory = Join-Path $cache "skills\engineering\$discipline"
        New-Item -ItemType Directory -Force -Path $directory | Out-Null
        Set-Content -LiteralPath (Join-Path $directory 'SKILL.md') -Value "---`nname: $discipline`n---"
    }

    @'
@echo off
if "%MINIONS_TEST_MODELS%"=="missing" (
  echo {"models":[{"slug":"gpt-5.6-sol"},{"slug":"gpt-5.6-terra"}]}
) else if "%MINIONS_TEST_MODELS%"=="lb" (
  echo {"models":[{"slug":"gpt-5.6-sol"},{"slug":"gpt-5.6-luna"}]}
) else if "%MINIONS_TEST_MODELS%"=="preview" (
  echo {"models":[{"slug":"gpt-5.6-sol-preview"},{"slug":"gpt-5.6-luna-preview"}]}
) else (
  echo {"models":[{"slug":"gpt-5.6-sol"},{"slug":"gpt-5.6-terra"},{"slug":"gpt-5.6-luna"}]}
)
'@ | Set-Content -LiteralPath (Join-Path $bin 'codex.cmd')

    @'
@echo off
if "%2"=="list" (
  echo []
)
exit /b 0
'@ | Set-Content -LiteralPath (Join-Path $bin 'copilot.cmd')

    @'
@echo off
echo abc123
exit /b 0
'@ | Set-Content -LiteralPath (Join-Path $bin 'git.cmd')

    $env:MINIONS_HOME = $testHome
    $env:LOCALAPPDATA = $temp
    $env:PATH = "$bin;$oldPath"
    $env:MINIONS_TEST_MODELS = 'complete'
    $expectedCache = Join-Path $temp 'copilot-minions\mattpocock-skills'
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $expectedCache) | Out-Null
    Move-Item -LiteralPath $cache -Destination $expectedCache

    & (Join-Path $root 'install.ps1') -Platform all | Out-Null

    $copilotSkill = Join-Path $testHome '.copilot\skills\copilot-minions'
    $codexSkill = Join-Path $testHome '.agents\skills\codex-minions'
    Assert-True (Test-Path (Join-Path $copilotSkill 'frontier.md')) 'Copilot contains shared core'
    Assert-True (Test-Path (Join-Path $codexSkill 'frontier.md')) 'Codex contains shared core'
    Assert-True (Test-Path (Join-Path $copilotSkill 'platform.md')) 'Copilot contains adapter'
    Assert-True (Test-Path (Join-Path $codexSkill 'platform.md')) 'Codex contains adapter'
    Assert-True (-not (Test-Path (Join-Path $codexSkill 'custom-agents'))) 'Agent sources are not copied into the skill'

    $agentDirectory = Join-Path $testHome '.codex\agents'
    $agents = @(Get-ChildItem -LiteralPath $agentDirectory -Filter 'codex-minions-*.toml')
    Assert-True ($agents.Count -eq 6) 'Six Codex custom agents are installed'
    Assert-True (Test-Path (Join-Path $agentDirectory '.codex-minions-manifest')) 'Agent manifest is installed'

    foreach ($discipline in @('implement', 'to-spec', 'to-tickets')) {
        $link = Get-Item -LiteralPath (Join-Path $testHome ".agents\skills\$discipline") -Force
        Assert-True ([bool]$link.LinkType) "$discipline is linked for Codex"
    }

    & (Join-Path $root 'install.ps1') -Platform all | Out-Null
    Assert-True (@(Get-ChildItem -LiteralPath $agentDirectory -Filter 'codex-minions-*.toml').Count -eq 6) 'Reinstall is idempotent'
    & (Join-Path $root 'scripts\update-disciplines.ps1') -Platform all | Out-Null

    $env:MINIONS_TEST_MODELS = 'lb'
    & (Join-Path $root 'install.ps1') -Platform codex -Variant lb | Out-Null
    $codexLbSkill = Join-Path $testHome '.agents\skills\codex-minions-lb'
    Assert-True (Test-Path $codexLbSkill) 'LB Codex installs without Terra'
    Assert-True ((Get-Content (Join-Path $codexLbSkill 'models.md') -Raw) -match 'explorer.*gpt-5.6-luna.*medium') 'LB model overlay replaces standard routing'

    $env:MINIONS_TEST_MODELS = 'complete'
    & (Join-Path $root 'install.ps1') -Platform all -Variant all | Out-Null
    Assert-True (Test-Path (Join-Path $testHome '.copilot\skills\copilot-minions-lb')) 'LB Copilot skill is installed'
    Assert-True (@(Get-ChildItem -LiteralPath $agentDirectory -Filter 'codex-minions*.toml').Count -eq 12) 'Both Codex variants install twelve agents'
    Assert-True (Test-Path (Join-Path $agentDirectory '.codex-minions-lb-manifest')) 'LB agent manifest is installed'

    $codexRollbackSentinel = Join-Path $codexSkill 'rollback-sentinel'
    $copilotRollbackSentinel = Join-Path $copilotSkill 'rollback-sentinel'
    $untouchedLbSentinel = Join-Path $testHome '.copilot\skills\copilot-minions-lb\untouched-sentinel'
    Set-Content -LiteralPath $codexRollbackSentinel -Value 'keep'
    Set-Content -LiteralPath $copilotRollbackSentinel -Value 'keep'
    Set-Content -LiteralPath $untouchedLbSentinel -Value 'keep'
    $global:MinionsFailMoveOnce = $true
    $global:MinionsFailMoveDestination = $codexSkill
    function global:Move-Item {
        [CmdletBinding()]
        param(
            [Parameter(Mandatory)][string]$LiteralPath,
            [Parameter(Mandatory)][string]$Destination
        )
        if ($global:MinionsFailMoveOnce -and $Destination -eq $global:MinionsFailMoveDestination) {
            $global:MinionsFailMoveOnce = $false
            throw 'Injected Move-Item failure'
        }
        Microsoft.PowerShell.Management\Move-Item -LiteralPath $LiteralPath -Destination $Destination
    }
    $failed = $false
    try {
        & (Join-Path $root 'install.ps1') -Platform all | Out-Null
    } catch {
        $failed = $true
    } finally {
        Remove-Item Function:\global:Move-Item -ErrorAction SilentlyContinue
        Remove-Variable MinionsFailMoveOnce -Scope Global -ErrorAction SilentlyContinue
        Remove-Variable MinionsFailMoveDestination -Scope Global -ErrorAction SilentlyContinue
    }
    Assert-True $failed 'Injected mid-commit failure is surfaced'
    Assert-True (Test-Path $codexRollbackSentinel) 'Codex installation is restored after rollback'
    Assert-True (Test-Path $copilotRollbackSentinel) 'Copilot installation is restored after rollback'
    Assert-True (Test-Path $untouchedLbSentinel) 'Untouched LB installation survives standard rollback'

    $global:MinionsFailMoveOnce = $true
    $global:MinionsFailMovePattern = '.copilot\skills\copilot-minions.backup.'
    function global:Move-Item {
        [CmdletBinding()]
        param(
            [Parameter(Mandatory)][string]$LiteralPath,
            [Parameter(Mandatory)][string]$Destination
        )
        if ($global:MinionsFailMoveOnce -and
            $Destination -like "*$($global:MinionsFailMovePattern)*") {
            $global:MinionsFailMoveOnce = $false
            throw 'Injected backup Move-Item failure'
        }
        Microsoft.PowerShell.Management\Move-Item -LiteralPath $LiteralPath -Destination $Destination
    }
    $failed = $false
    try {
        & (Join-Path $root 'install.ps1') -Platform all | Out-Null
    } catch {
        $failed = $true
    } finally {
        Remove-Item Function:\global:Move-Item -ErrorAction SilentlyContinue
        Remove-Variable MinionsFailMoveOnce -Scope Global -ErrorAction SilentlyContinue
        Remove-Variable MinionsFailMovePattern -Scope Global -ErrorAction SilentlyContinue
    }
    Assert-True $failed 'Injected backup failure is surfaced'
    Assert-True (Test-Path $copilotRollbackSentinel) 'Failed backup leaves original installation untouched'
    Assert-True (Test-Path $codexRollbackSentinel) 'Later destination remains untouched after backup failure'
    Assert-True (Test-Path $untouchedLbSentinel) 'LB installation remains untouched after backup failure'

    Set-Content -LiteralPath (Join-Path $copilotSkill 'sentinel.txt') -Value 'keep'
    $env:MINIONS_TEST_MODELS = 'missing'
    $failed = $false
    try {
        & (Join-Path $root 'install.ps1') -Platform all | Out-Null
    } catch {
        $failed = $true
    }
    Assert-True $failed 'Missing Codex model fails installation'
    Assert-True (Test-Path (Join-Path $copilotSkill 'sentinel.txt')) 'Failed all preflight leaves Copilot untouched'

    $env:MINIONS_TEST_MODELS = 'complete'
    Set-Content -LiteralPath $agents[0].FullName -Value '# user-owned'
    $failed = $false
    try {
        & (Join-Path $root 'install.ps1') -Platform codex | Out-Null
    } catch {
        $failed = $true
    }
    Assert-True $failed 'Unmanaged agent collision fails installation'

    $failed = $false
    try {
        & (Join-Path $root 'install.ps1') -Platform invalid | Out-Null
    } catch {
        $failed = $true
    }
    Assert-True $failed 'Invalid platform is rejected'

    $failed = $false
    try {
        & (Join-Path $root 'install.ps1') -Variant invalid | Out-Null
    } catch {
        $failed = $true
    }
    Assert-True $failed 'Invalid variant is rejected'

    $env:MINIONS_TEST_MODELS = 'preview'
    $failed = $false
    try {
        & (Join-Path $root 'install.ps1') -Platform codex -Variant lb | Out-Null
    } catch {
        $failed = $true
    }
    Assert-True $failed 'Near-match model IDs are rejected'

    Write-Host 'PowerShell installer smoke tests passed.'
} finally {
    $env:PATH = $oldPath
    $env:MINIONS_HOME = $oldHome
    $env:LOCALAPPDATA = $oldLocalAppData
    Remove-Item Env:MINIONS_TEST_MODELS -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $temp) {
        Remove-Item -Recurse -Force -LiteralPath $temp
    }
}
