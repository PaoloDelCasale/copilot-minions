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
    $disciplineFixtures = @(
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
    foreach ($entry in $disciplineFixtures) {
        $discipline = $entry.Name
        $directory = Join-Path $cache "skills\$($entry.Path)"
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
if "%1"=="--list-models" (
  echo openai-codex gpt-5.6-sol
  echo openai-codex gpt-5.6-terra
  echo openai-codex gpt-5.6-luna
  echo github-copilot gpt-5.6-sol
  echo github-copilot gpt-5.6-terra
  if "%MINIONS_TEST_PI_MODELS%"=="near-grok" (
    echo github-copilot grok-4x5
  ) else if not "%MINIONS_TEST_PI_MODELS%"=="missing-grok" (
    echo github-copilot grok-4.5
  )
)
if "%1"=="install" (
  echo %2>>"%MINIONS_TEST_PI_INSTALL_LOG%"
)
exit /b 0
'@ | Set-Content -LiteralPath (Join-Path $bin 'pi.cmd')

    @'
@echo off
echo abc123
exit /b 0
'@ | Set-Content -LiteralPath (Join-Path $bin 'git.cmd')

    $env:MINIONS_HOME = $testHome
    $env:LOCALAPPDATA = $temp
    $env:PATH = "$bin;$oldPath"
    $env:MINIONS_TEST_MODELS = 'complete'
    $env:MINIONS_TEST_PI_INSTALL_LOG = Join-Path $temp 'pi-install.log'
    $expectedCache = Join-Path $temp 'copilot-minions\mattpocock-skills'
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $expectedCache) | Out-Null
    Move-Item -LiteralPath $cache -Destination $expectedCache

    & (Join-Path $root 'install.ps1') -Platform all | Out-Null

    $copilotSkill = Join-Path $testHome '.copilot\skills\copilot-minions'
    $codexSkill = Join-Path $testHome '.agents\skills\codex-minions'
    $piSkill = Join-Path $testHome '.pi\agent\skills\pi-minions'
    $piExtension = Join-Path $testHome '.pi\agent\extensions\pi-minions'
    $piAgents = Join-Path $testHome '.pi\agent\agents\copilot-minions'
    Assert-True (Test-Path (Join-Path $copilotSkill 'frontier.md')) 'Copilot contains shared core'
    Assert-True (Test-Path (Join-Path $codexSkill 'frontier.md')) 'Codex contains shared core'
    Assert-True (Test-Path (Join-Path $piSkill 'frontier.md')) 'Pi contains shared core'
    Assert-True (Test-Path (Join-Path $copilotSkill 'control.md')) 'Copilot contains control gate'
    Assert-True (Test-Path (Join-Path $codexSkill 'control.md')) 'Codex contains control gate'
    Assert-True (Test-Path (Join-Path $piSkill 'control.md')) 'Pi contains control gate'
    $piControl = Get-Content (Join-Path $piSkill 'control.md') -Raw
    Assert-True ($piControl.Contains('Triage: 8/12')) 'Control gate contains soft closure budget'
    Assert-True ($piControl.Contains('Triage: 12/12')) 'Control gate contains hard handoff budget'
    Assert-True (Test-Path (Join-Path $piSkill 'platform.md')) 'Pi contains adapter'
    Assert-True ((Get-Content (Join-Path $piSkill 'platform.md') -Raw).Contains('budgetClass: "closure"')) 'Pi adapter labels closure-only dispatch'
    Assert-True (Test-Path (Join-Path $piExtension 'index.ts')) 'Pi extension is installed'
    Assert-True (Test-Path (Join-Path $piAgents 'pi-minions-reviewer.md')) 'Pi reviewer agent is installed'
    Assert-True (Test-Path (Join-Path $piAgents 'pi-minions-review-axis.md')) 'Pi two-axis leaf reviewer is installed'
    Assert-True (@(Get-ChildItem -LiteralPath $piAgents -Filter 'pi-minions-*.md').Count -eq 7) 'Seven Pi custom agents are installed'
    Assert-True ((Get-Content -LiteralPath $env:MINIONS_TEST_PI_INSTALL_LOG -Raw).Contains('npm:pi-subagents@0.37.2')) 'Pinned pi-subagents runtime is installed'
    Assert-True ((Get-Content -LiteralPath $env:MINIONS_TEST_PI_INSTALL_LOG -Raw).Contains('npm:pi-mcp-adapter@2.16.0')) 'Pinned Paseo MCP bridge is installed'
    Clear-Content -LiteralPath $env:MINIONS_TEST_PI_INSTALL_LOG
    & (Join-Path $root 'install.ps1') -Platform paseo | Out-Null
    $paseoInstallLog = Get-Content -LiteralPath $env:MINIONS_TEST_PI_INSTALL_LOG -Raw
    Assert-True ($paseoInstallLog.Contains('npm:pi-mcp-adapter@2.16.0')) 'Paseo platform installs its MCP bridge'
    Assert-True (-not $paseoInstallLog.Contains('pi-subagents')) 'Paseo platform does not install the ordinary Pi worker runtime'
    Assert-True (Test-Path (Join-Path $copilotSkill 'platform.md')) 'Copilot contains adapter'
    Assert-True (Test-Path (Join-Path $codexSkill 'platform.md')) 'Codex contains adapter'
    Assert-True ((Get-Content (Join-Path $copilotSkill 'models.md') -Raw) -match 'mechanical.*grok-4\.5.*high') 'Copilot gets its provider matrix'
    Assert-True ((Get-Content (Join-Path $codexSkill 'models.md') -Raw) -match 'mechanical.*gpt-5\.6-luna.*low') 'Codex keeps its provider matrix'
    $piModels = Get-Content (Join-Path $piSkill 'models.md') -Raw
    Assert-True ($piModels.Contains('## `openai-codex`')) 'Pi documents the Codex matrix'
    Assert-True ($piModels.Contains('## `github-copilot`')) 'Pi documents the Copilot matrix'
    Assert-True (-not (Test-Path (Join-Path $codexSkill 'custom-agents'))) 'Agent sources are not copied into the skill'

    $agentDirectory = Join-Path $testHome '.codex\agents'
    $agents = @(Get-ChildItem -LiteralPath $agentDirectory -Filter 'codex-minions-*.toml')
    Assert-True ($agents.Count -eq 6) 'Six Codex custom agents are installed'
    Assert-True (Test-Path (Join-Path $agentDirectory '.codex-minions-manifest')) 'Agent manifest is installed'

    foreach ($discipline in @('implement', 'to-spec', 'to-tickets', 'tdd', 'code-review', 'diagnosing-bugs', 'codebase-design', 'domain-modeling', 'grilling')) {
        $link = Get-Item -LiteralPath (Join-Path $testHome ".agents\skills\$discipline") -Force
        Assert-True ([bool]$link.LinkType) "$discipline is linked for Codex"
        $piLink = Get-Item -LiteralPath (Join-Path $testHome ".pi\agent\skills\$discipline") -Force
        Assert-True ([bool]$piLink.LinkType) "$discipline is linked for Pi"
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
    Assert-True (Test-Path (Join-Path $testHome '.pi\agent\skills\pi-minions-lb')) 'LB Pi skill is installed'
    Assert-True (Test-Path (Join-Path $testHome '.pi\agent\skills\pi-minions-lb\control.md')) 'LB Pi contains control gate'
    $copilotLbModels = Get-Content (Join-Path $testHome '.copilot\skills\copilot-minions-lb\models.md') -Raw
    Assert-True ($copilotLbModels -match 'architect.*grok-4\.5.*high') 'LB Copilot gets Grok high routes'
    $piLbModels = Get-Content (Join-Path $testHome '.pi\agent\skills\pi-minions-lb\models.md') -Raw
    Assert-True ($piLbModels.Contains('gpt-5.6-luna:xhigh')) 'LB Pi documents Codex Luna overrides'
    Assert-True ($piLbModels.Contains('grok-4.5:high')) 'LB Pi documents Copilot Grok overrides'
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

    $piCatalogSentinel = Join-Path $piExtension 'catalog-sentinel'
    Set-Content -LiteralPath $piCatalogSentinel -Value 'keep'
    $env:MINIONS_TEST_PI_MODELS = 'missing-grok'
    & (Join-Path $root 'install.ps1') -Platform pi | Out-Null
    Assert-True (-not (Test-Path $piCatalogSentinel)) 'Incomplete Pi catalog does not block installation'
    Assert-True (Test-Path (Join-Path $piSkill 'SKILL.md')) 'Pi skill is installed with an incomplete model catalog'
    Remove-Item Env:MINIONS_TEST_PI_MODELS

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

    $piMarker = Join-Path $piExtension '.managed-by-copilot-minions'
    Remove-Item -LiteralPath $piMarker
    $failed = $false
    try {
        & (Join-Path $root 'install.ps1') -Platform pi | Out-Null
    } catch {
        $failed = $true
    }
    Assert-True $failed 'Unmanaged Pi extension collision fails installation'
    Set-Content -LiteralPath $piMarker -Value 'managed-by: copilot-minions'

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
    Remove-Item Env:MINIONS_TEST_PI_MODELS -ErrorAction SilentlyContinue
    Remove-Item Env:MINIONS_TEST_PI_INSTALL_LOG -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $temp) {
        Remove-Item -Recurse -Force -LiteralPath $temp
    }
}
