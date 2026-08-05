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
  echo github-copilot claude-opus-5
  echo github-copilot gpt-5.6-luna
  echo github-copilot gpt-5.6-sol
  echo github-copilot gpt-5.6-terra
  if "%MINIONS_TEST_PI_MODELS%"=="near-grok" (
    echo github-copilot grok-4x5
  ) else if not "%MINIONS_TEST_PI_MODELS%"=="missing-grok" (
    echo github-copilot grok-4.5
  )
)
if "%1"=="install" (
  echo %CD%^|%*>>"%MINIONS_TEST_PI_INSTALL_LOG%"
  if "%MINIONS_TEST_PI_DELAY%"=="1" ping -n 2 127.0.0.1 >nul
  if "%MINIONS_TEST_PI_FAIL%"=="1" exit /b 23
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

    $globalOutput = (& (Join-Path $root 'install.ps1') -Platform all 6>&1 | Out-String)
    Assert-True ($globalOutput.Contains('Installed platform: all; variant: standard')) 'Global output keeps the historical header'
    Assert-True (-not $globalOutput.Contains('scope: global')) 'Global output does not add a scope suffix'
    $globalPiInstallLog = Get-Content -LiteralPath $env:MINIONS_TEST_PI_INSTALL_LOG -Raw
    Assert-True ($globalPiInstallLog.Contains('install npm:pi-subagents@0.37.2')) 'Global Pi package install keeps its historical command'
    Assert-True ($globalPiInstallLog.Contains('install npm:pi-mcp-adapter@2.16.0')) 'Global Paseo package install keeps its historical command'
    Assert-True (-not $globalPiInstallLog.Contains('install -l ')) 'Global package installs remain non-local'

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
    Assert-True ($piControl.Contains('Triage: 8/30')) 'Control gate contains soft closure budget'
    Assert-True ($piControl.Contains('Triage: 30/30')) 'Control gate contains hard handoff budget'
    Assert-True (Test-Path (Join-Path $piSkill 'platform.md')) 'Pi contains adapter'
    Assert-True ((Get-Content (Join-Path $piSkill 'platform.md') -Raw).Contains('budgetClass: "closure"')) 'Pi adapter labels closure-only dispatch'
    Assert-True (Test-Path (Join-Path $piExtension 'index.ts')) 'Pi extension is installed'
    Assert-True (Test-Path (Join-Path $piExtension 'orca-runtime.mjs')) 'Orca native runtime adapter is installed with Pi'
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
    $copilotModels = Get-Content (Join-Path $copilotSkill 'models.md') -Raw
    Assert-True ($copilotModels -match 'mechanical.*gpt-5\.6-luna.*high') 'Copilot gets its provider matrix'
    Assert-True ($copilotModels -match 'explorer.*claude-opus-5.*high') 'Copilot gets its quality explorer route'
    Assert-True ($copilotModels -match 'architect.*claude-opus-5.*xhigh') 'Copilot gets its quality architecture route'
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
    Assert-True ($copilotLbModels -match 'mechanical.*gpt-5\.6-luna.*high') 'LB Copilot gets Luna high mechanical routing'
    Assert-True ($copilotLbModels -match 'architect.*gpt-5\.6-luna.*max') 'LB Copilot gets Luna max architecture routing'
    Assert-True ($copilotLbModels -match 'escalate-entry.*grok-4\.5.*high') 'LB Copilot keeps Grok as evidence-backed escalation'
    $piLbModels = Get-Content (Join-Path $testHome '.pi\agent\skills\pi-minions-lb\models.md') -Raw
    Assert-True ($piLbModels.Contains('gpt-5.6-luna:xhigh')) 'LB Pi documents Codex Luna overrides'
    Assert-True ($piLbModels.Contains('gpt-5.6-luna:max')) 'LB Pi documents Copilot Luna max routes'
    Assert-True ($piLbModels.Contains('grok-4.5:high')) 'LB Pi documents Copilot Grok escalation'
    Assert-True (@(Get-ChildItem -LiteralPath $agentDirectory -Filter 'codex-minions*.toml').Count -eq 12) 'Both Codex variants install twelve agents'
    Assert-True (Test-Path (Join-Path $agentDirectory '.codex-minions-lb-manifest')) 'LB agent manifest is installed'

    # Project-scoped Paseo uses the invocation directory, keeps all resources local,
    # and carries both variants plus the Paseo role prompts without global updates.
    $projectPaseo = Join-Path $temp 'project-paseo'
    New-Item -ItemType Directory -Force -Path $projectPaseo | Out-Null
    $globalProjectSentinel = Join-Path $piExtension 'project-scope-must-not-touch-global'
    Set-Content -LiteralPath $globalProjectSentinel -Value 'keep'
    Clear-Content -LiteralPath $env:MINIONS_TEST_PI_INSTALL_LOG
    Push-Location -LiteralPath $projectPaseo
    try {
        & (Join-Path $root 'install.ps1') -Platform paseo -Variant all -Scope project | Out-Null
    } finally {
        Pop-Location
    }
    $projectPaseoPi = Join-Path $projectPaseo '.pi'
    $projectPaseoExtension = Join-Path $projectPaseoPi 'extensions\pi-minions'
    $projectPaseoSkill = Join-Path $projectPaseoPi 'skills\pi-minions'
    $projectPaseoLbSkill = Join-Path $projectPaseoPi 'skills\pi-minions-lb'
    Assert-True (Test-Path (Join-Path $projectPaseoExtension 'index.ts')) 'Project Paseo extension is installed under .pi/extensions'
    Assert-True (Test-Path (Join-Path $projectPaseoExtension 'orca-runtime.mjs')) 'Project extension carries the Orca native runtime adapter'
    Assert-True (Test-Path (Join-Path $projectPaseoExtension '.managed-by-copilot-minions')) 'Project Paseo extension has its ownership marker'
    Assert-True (Test-Path (Join-Path $projectPaseoExtension 'agents\pi-minions-reviewer.md')) 'Paseo role prompts stay beside the project extension'
    Assert-True (-not (Test-Path (Join-Path $projectPaseoPi 'agent'))) 'Project Paseo never creates the global-style .pi/agent tree'
    Assert-True (-not (Test-Path (Join-Path $projectPaseoPi 'agents'))) 'Project Paseo does not create .pi/agents'
    foreach ($skillPath in @($projectPaseoSkill, $projectPaseoLbSkill)) {
        Assert-True (Test-Path (Join-Path $skillPath 'SKILL.md')) "Project skill is installed: $skillPath"
        Assert-True (Test-Path (Join-Path $skillPath 'frontier.md')) "Project skill is self-contained: $skillPath"
        Assert-True (Test-Path (Join-Path $skillPath 'scripts\update-disciplines.ps1')) "Project skill includes helper scripts: $skillPath"
        Assert-True (Test-Path (Join-Path $skillPath '.managed-by-copilot-minions')) "Project skill has its ownership marker: $skillPath"
    }
    Assert-True (-not (Test-Path (Join-Path $projectPaseoPi 'skills\implement'))) 'Project scope skips the global discipline updater'
    Assert-True (Test-Path $globalProjectSentinel) 'Project Paseo leaves the global Pi extension untouched'
    $paseoProjectInstall = Get-Content -LiteralPath $env:MINIONS_TEST_PI_INSTALL_LOG -Raw
    Assert-True ($paseoProjectInstall.Contains('install -l npm:pi-mcp-adapter@2.16.0')) 'Project Paseo uses the pinned local MCP adapter install'
    Assert-True ($paseoProjectInstall.ToLowerInvariant().Contains($projectPaseo.ToLowerInvariant())) 'Project Paseo invokes pi from the target directory'

    Set-Content -LiteralPath (Join-Path $projectPaseoExtension 'idempotence-sentinel') -Value 'remove-me'
    Push-Location -LiteralPath $projectPaseo
    try {
        & (Join-Path $root 'install.ps1') -Platform paseo -Variant all -Scope project | Out-Null
    } finally {
        Pop-Location
    }
    Assert-True (-not (Test-Path (Join-Path $projectPaseoExtension 'idempotence-sentinel'))) 'Project Paseo reinstall atomically replaces managed resources'
    Assert-True (@(Get-ChildItem -LiteralPath (Join-Path $projectPaseoExtension 'agents') -Filter 'pi-minions-*.md').Count -eq 7) 'Project Paseo reinstall is idempotent'

    # Project-scoped ordinary Pi uses an explicit target and the verified local
    # companion-agent directory supported by pi-subagents 0.37.2.
    $projectPi = Join-Path $temp 'project-pi'
    New-Item -ItemType Directory -Force -Path $projectPi | Out-Null
    Clear-Content -LiteralPath $env:MINIONS_TEST_PI_INSTALL_LOG
    Push-Location -LiteralPath $temp
    try {
        & (Join-Path $root 'install.ps1') -Platform pi -Scope project -TargetDirectory 'project-pi' | Out-Null
    } finally {
        Pop-Location
    }
    $projectPiRoot = Join-Path $projectPi '.pi'
    $projectPiExtension = Join-Path $projectPiRoot 'extensions\pi-minions'
    $projectPiAgents = Join-Path $projectPiRoot 'agents\copilot-minions'
    $projectPiSkill = Join-Path $projectPiRoot 'skills\pi-minions'
    Assert-True (Test-Path (Join-Path $projectPiExtension 'index.ts')) 'Project Pi extension is installed'
    Assert-True (Test-Path (Join-Path $projectPiExtension 'orca-runtime.mjs')) 'Project Pi installs the Orca native runtime adapter'
    Assert-True (Test-Path (Join-Path $projectPiAgents '.managed-by-copilot-minions')) 'Project Pi companion agents have an ownership marker'
    Assert-True (Test-Path (Join-Path $projectPiAgents 'pi-minions-review-axis.md')) 'Project Pi companion agents are installed recursively under .pi/agents'
    Assert-True (@(Get-ChildItem -LiteralPath $projectPiAgents -Filter 'pi-minions-*.md').Count -eq 7) 'Project Pi installs all companion agents'
    Assert-True (-not (Test-Path (Join-Path $projectPiRoot 'agent'))) 'Project Pi never creates the global-style .pi/agent tree'
    Assert-True (Test-Path (Join-Path $projectPiSkill 'control.md')) 'Project Pi skill is self-contained'
    Assert-True (-not (Test-Path (Join-Path $projectPiRoot 'skills\implement'))) 'Project Pi also skips the global discipline updater'
    Assert-True (Test-Path $globalProjectSentinel) 'Project Pi leaves global Pi resources untouched'
    $piProjectInstall = Get-Content -LiteralPath $env:MINIONS_TEST_PI_INSTALL_LOG -Raw
    Assert-True ($piProjectInstall.Contains('install -l npm:pi-subagents@0.37.2')) 'Project Pi uses the pinned local companion runtime install'
    Assert-True ($piProjectInstall.ToLowerInvariant().Contains($projectPi.ToLowerInvariant())) 'TargetDirectory controls the pi install working directory'

    # A package failure happens before commit and leaves the previous managed tree intact.
    $projectPackageSentinel = Join-Path $projectPiSkill 'package-failure-sentinel'
    Set-Content -LiteralPath $projectPackageSentinel -Value 'keep'
    $env:MINIONS_TEST_PI_FAIL = '1'
    $failed = $false
    try {
        & (Join-Path $root 'install.ps1') -Platform pi -Scope project -TargetDirectory $projectPi | Out-Null
    } catch {
        $failed = $true
    } finally {
        Remove-Item Env:MINIONS_TEST_PI_FAIL -ErrorAction SilentlyContinue
    }
    Assert-True $failed 'Project Pi package failure is surfaced'
    Assert-True (Test-Path $projectPackageSentinel) 'Project Pi package failure commits no managed resources'
    Assert-True (@(Get-ChildItem -LiteralPath $projectPiRoot -Recurse -Force | Where-Object { $_.Name -like '*.stage.*' }).Count -eq 0) 'Project package failure cleans staging directories'

    # Inject a project commit failure after the extension has moved and verify rollback.
    $projectExtensionRollbackSentinel = Join-Path $projectPiExtension 'rollback-sentinel'
    $projectSkillRollbackSentinel = Join-Path $projectPiSkill 'rollback-sentinel'
    Set-Content -LiteralPath $projectExtensionRollbackSentinel -Value 'keep'
    Set-Content -LiteralPath $projectSkillRollbackSentinel -Value 'keep'
    $global:MinionsFailMoveOnce = $true
    $global:MinionsFailMoveDestination = $projectPiSkill
    function global:Move-Item {
        [CmdletBinding()]
        param(
            [Parameter(Mandatory)][string]$LiteralPath,
            [Parameter(Mandatory)][string]$Destination
        )
        if ($global:MinionsFailMoveOnce -and $Destination -eq $global:MinionsFailMoveDestination) {
            $global:MinionsFailMoveOnce = $false
            throw 'Injected project Move-Item failure'
        }
        Microsoft.PowerShell.Management\Move-Item -LiteralPath $LiteralPath -Destination $Destination
    }
    $failed = $false
    try {
        & (Join-Path $root 'install.ps1') -Platform pi -Scope project -TargetDirectory $projectPi | Out-Null
    } catch {
        $failed = $true
    } finally {
        Remove-Item Function:\global:Move-Item -ErrorAction SilentlyContinue
        Remove-Variable MinionsFailMoveOnce -Scope Global -ErrorAction SilentlyContinue
        Remove-Variable MinionsFailMoveDestination -Scope Global -ErrorAction SilentlyContinue
    }
    Assert-True $failed 'Injected project commit failure is surfaced'
    Assert-True (Test-Path $projectExtensionRollbackSentinel) 'Project extension is restored after rollback'
    Assert-True (Test-Path $projectSkillRollbackSentinel) 'Project skill is restored after rollback'

    # Every project resource rejects unmanaged collisions before invoking pi.
    foreach ($collision in @(
        [pscustomobject]@{ Platform = 'paseo'; RelativePath = 'extensions\pi-minions' },
        [pscustomobject]@{ Platform = 'pi'; RelativePath = 'agents\copilot-minions' },
        [pscustomobject]@{ Platform = 'pi'; RelativePath = 'skills\pi-minions' }
    )) {
        $collisionTarget = Join-Path $temp "collision-$($collision.Platform)-$([Guid]::NewGuid().ToString('N'))"
        $collisionPath = Join-Path (Join-Path $collisionTarget '.pi') $collision.RelativePath
        New-Item -ItemType Directory -Force -Path $collisionPath | Out-Null
        Set-Content -LiteralPath (Join-Path $collisionPath 'user-owned') -Value 'keep'
        Clear-Content -LiteralPath $env:MINIONS_TEST_PI_INSTALL_LOG
        $failed = $false
        try {
            & (Join-Path $root 'install.ps1') -Platform $collision.Platform -Scope project -TargetDirectory $collisionTarget | Out-Null
        } catch {
            $failed = $true
        }
        Assert-True $failed "Unmanaged project collision is rejected: $($collision.RelativePath)"
        Assert-True (Test-Path (Join-Path $collisionPath 'user-owned')) "Unmanaged project content survives: $($collision.RelativePath)"
        Assert-True ((Get-Content -LiteralPath $env:MINIONS_TEST_PI_INSTALL_LOG -Raw).Length -eq 0) "Collision is detected before pi install: $($collision.RelativePath)"
    }

    # Unsupported project combinations fail before creating .pi or touching globals.
    foreach ($unsupportedPlatform in @('copilot', 'codex', 'all')) {
        $unsupportedTarget = Join-Path $temp "unsupported-$unsupportedPlatform"
        New-Item -ItemType Directory -Force -Path $unsupportedTarget | Out-Null
        $failed = $false
        $failureMessage = ''
        try {
            & (Join-Path $root 'install.ps1') -Platform $unsupportedPlatform -Scope project -TargetDirectory $unsupportedTarget | Out-Null
        } catch {
            $failed = $true
            $failureMessage = $_.Exception.Message
        }
        Assert-True $failed "Project platform fails clearly: $unsupportedPlatform"
        Assert-True ($failureMessage -match 'not supported|select pi or paseo') "Project platform explains the supported selection: $unsupportedPlatform"
        Assert-True (-not (Test-Path (Join-Path $unsupportedTarget '.pi'))) "Unsupported project platform creates nothing: $unsupportedPlatform"
    }
    $failed = $false
    try {
        & (Join-Path $root 'install.ps1') -Platform paseo -Scope global -TargetDirectory $projectPaseo | Out-Null
    } catch {
        $failed = $true
    }
    Assert-True $failed 'TargetDirectory is rejected for global scope'
    $failed = $false
    try {
        & (Join-Path $root 'install.ps1') -Platform paseo -Scope project -TargetDirectory (Join-Path $temp 'missing-project') | Out-Null
    } catch {
        $failed = $true
    }
    Assert-True $failed 'A missing project target is rejected'

    # Two installers for one target serialize through the named install lock.
    if (Get-Command Start-Job -ErrorAction SilentlyContinue) {
        $concurrentProject = Join-Path $temp 'project-concurrent'
        New-Item -ItemType Directory -Force -Path $concurrentProject | Out-Null
        $env:MINIONS_TEST_PI_DELAY = '1'
        $jobs = @(
            Start-Job -ScriptBlock {
                param($installer, $target)
                & $installer -Platform paseo -Scope project -TargetDirectory $target
            } -ArgumentList (Join-Path $root 'install.ps1'), $concurrentProject
            Start-Job -ScriptBlock {
                param($installer, $target)
                & $installer -Platform paseo -Scope project -TargetDirectory $target
            } -ArgumentList (Join-Path $root 'install.ps1'), $concurrentProject
        )
        try {
            $jobs | Wait-Job | Out-Null
            foreach ($job in $jobs) {
                Receive-Job -Job $job -ErrorAction Stop | Out-Null
                Assert-True ($job.State -eq 'Completed') 'Concurrent project installer completed successfully'
            }
        } finally {
            $jobs | Remove-Job -Force -ErrorAction SilentlyContinue
            Remove-Item Env:MINIONS_TEST_PI_DELAY -ErrorAction SilentlyContinue
        }
        $concurrentPi = Join-Path $concurrentProject '.pi'
        Assert-True (Test-Path (Join-Path $concurrentPi 'extensions\pi-minions\index.ts')) 'Concurrent install leaves a complete extension'
        Assert-True (Test-Path (Join-Path $concurrentPi 'skills\pi-minions\SKILL.md')) 'Concurrent install leaves a complete skill'
        Assert-True (@(Get-ChildItem -LiteralPath $concurrentPi -Recurse -Force | Where-Object { $_.Name -like '*.stage.*' -or $_.Name -like '*.backup.*' }).Count -eq 0) 'Concurrent install leaves no transaction artifacts'
    }

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

    $failed = $false
    try {
        & (Join-Path $root 'install.ps1') -Scope invalid | Out-Null
    } catch {
        $failed = $true
    }
    Assert-True $failed 'Invalid scope is rejected'

    $env:MINIONS_TEST_MODELS = 'preview'
    $failed = $false
    try {
        & (Join-Path $root 'install.ps1') -Platform codex -Variant lb | Out-Null
    } catch {
        $failed = $true
    }
    Assert-True $failed 'Near-match model IDs are rejected'

    $readme = Get-Content -LiteralPath (Join-Path $root 'README.md') -Raw
    Assert-True ($readme.Contains('REF=f8cc992e3053a84122412cde9e7baa899379cf6e')) 'README pins the reviewed Bash installer commit'
    Assert-True ($readme.Contains("`$ref = 'f8cc992e3053a84122412cde9e7baa899379cf6e'")) 'README pins the reviewed PowerShell installer commit'
    Assert-True (-not $readme.Contains('PROJECT_SCOPE_REF')) 'README contains no unresolved integration pin token'
    Assert-True ($readme.Contains('bash "$SOURCE/install.sh" --platform paseo --scope project')) 'Bash Worktree Setup invokes the installer'
    Assert-True ($readme.Contains("& (Join-Path `$source 'install.ps1') -Platform paseo -Scope project")) 'PowerShell Worktree Setup invokes the installer'
    Assert-True (-not $readme.Contains('13e5813')) 'README no longer pins the pre-feature commit'

    Write-Host 'PowerShell installer smoke tests passed.'
} finally {
    $env:PATH = $oldPath
    $env:MINIONS_HOME = $oldHome
    $env:LOCALAPPDATA = $oldLocalAppData
    Remove-Item Env:MINIONS_TEST_MODELS -ErrorAction SilentlyContinue
    Remove-Item Env:MINIONS_TEST_PI_MODELS -ErrorAction SilentlyContinue
    Remove-Item Env:MINIONS_TEST_PI_INSTALL_LOG -ErrorAction SilentlyContinue
    Remove-Item Env:MINIONS_TEST_PI_FAIL -ErrorAction SilentlyContinue
    Remove-Item Env:MINIONS_TEST_PI_DELAY -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $temp) {
        Remove-Item -Recurse -Force -LiteralPath $temp
    }
}
