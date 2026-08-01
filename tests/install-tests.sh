#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMP="$(mktemp -d)"
TEMP="$(cd "${TEMP}" && pwd -P)"
trap 'rm -rf "${TEMP}"' EXIT

export MINIONS_HOME="${TEMP}/home"
export CACHE_DIR="${TEMP}/cache"
export PATH="${TEMP}/bin:${PATH}"
mkdir -p "${MINIONS_HOME}" "${TEMP}/bin" "${CACHE_DIR}/.git"

DISCIPLINE_FIXTURES=(
  "implement:engineering/implement"
  "to-spec:engineering/to-spec"
  "to-tickets:engineering/to-tickets"
  "tdd:engineering/tdd"
  "code-review:engineering/code-review"
  "diagnosing-bugs:engineering/diagnosing-bugs"
  "codebase-design:engineering/codebase-design"
  "domain-modeling:engineering/domain-modeling"
  "grilling:productivity/grilling"
)
for entry in "${DISCIPLINE_FIXTURES[@]}"; do
  discipline="${entry%%:*}"
  relative_path="${entry#*:}"
  mkdir -p "${CACHE_DIR}/skills/${relative_path}"
  printf '%s\n' "---" "name: ${discipline}" "---" > "${CACHE_DIR}/skills/${relative_path}/SKILL.md"
done

cat > "${TEMP}/bin/codex" <<'EOF'
#!/usr/bin/env bash
if [[ "${MINIONS_TEST_MODELS:-complete}" == "missing" ]]; then
  echo '{"models":[{"slug":"gpt-5.6-sol"},{"slug":"gpt-5.6-terra"}]}'
elif [[ "${MINIONS_TEST_MODELS:-complete}" == "lb" ]]; then
  echo '{"models":[{"slug":"gpt-5.6-sol"},{"slug":"gpt-5.6-luna"}]}'
elif [[ "${MINIONS_TEST_MODELS:-complete}" == "preview" ]]; then
  echo '{"models":[{"slug":"gpt-5.6-sol-preview"},{"slug":"gpt-5.6-luna-preview"}]}'
else
  echo '{"models":[{"slug":"gpt-5.6-sol"},{"slug":"gpt-5.6-terra"},{"slug":"gpt-5.6-luna"}]}'
fi
EOF

cat > "${TEMP}/bin/copilot" <<'EOF'
#!/usr/bin/env bash
if [[ "${1:-}" == "skill" && "${2:-}" == "list" ]]; then
  echo '[]'
fi
EOF

cat > "${TEMP}/bin/pi" <<'EOF'
#!/usr/bin/env bash
if [[ "${1:-}" == "--list-models" ]]; then
  printf '%s\n' \
    'openai-codex gpt-5.6-sol' \
    'openai-codex gpt-5.6-terra' \
    'openai-codex gpt-5.6-luna' \
    'github-copilot gpt-5.6-sol' \
    'github-copilot gpt-5.6-terra'
  case "${MINIONS_TEST_PI_MODELS:-complete}" in
    missing-grok) ;;
    near-grok) printf '%s\n' 'github-copilot grok-4x5' ;;
    *) printf '%s\n' 'github-copilot grok-4.5' ;;
  esac
elif [[ "${1:-}" == "install" ]]; then
  package="${!#}"
  printf '%s|%s\n' "$(pwd -P)" "$*" >> "${MINIONS_TEST_PI_COMMAND_LOG}"
  if [[ -n "${MINIONS_TEST_PI_FAIL_PACKAGE:-}" && "${package}" == "${MINIONS_TEST_PI_FAIL_PACKAGE}" ]]; then
    exit 93
  fi
  if [[ -n "${MINIONS_TEST_PI_BLOCK_FILE:-}" ]]; then
    : > "${MINIONS_TEST_PI_BLOCK_FILE}.ready"
    while [[ ! -e "${MINIONS_TEST_PI_BLOCK_FILE}.release" ]]; do sleep 0.02; done
  fi
  printf '%s\n' "${package}" >> "${MINIONS_TEST_PI_INSTALL_LOG}"
fi
EOF

cat > "${TEMP}/bin/git" <<'EOF'
#!/usr/bin/env bash
echo abc123
EOF

cat > "${TEMP}/bin/mv" <<'EOF'
#!/usr/bin/env bash
target="${!#}"
if [[ -n "${MINIONS_TEST_FAIL_MOVE_TARGET:-}" &&
      "${target}" == *"${MINIONS_TEST_FAIL_MOVE_TARGET}"* &&
      ! -e "${MINIONS_TEST_FAIL_MOVE_STATE}" ]]; then
  : > "${MINIONS_TEST_FAIL_MOVE_STATE}"
  exit 91
fi
exec /bin/mv "$@"
EOF

cat > "${TEMP}/bin/cp" <<'EOF'
#!/usr/bin/env bash
target="${!#}"
if [[ -n "${MINIONS_TEST_FAIL_COPY_TARGET:-}" &&
      "${target}" == *"${MINIONS_TEST_FAIL_COPY_TARGET}"* &&
      ! -e "${MINIONS_TEST_FAIL_COPY_STATE}" ]]; then
  : > "${MINIONS_TEST_FAIL_COPY_STATE}"
  exit 92
fi
exec /bin/cp "$@"
EOF
chmod +x "${TEMP}/bin/codex" "${TEMP}/bin/copilot" "${TEMP}/bin/pi" "${TEMP}/bin/git" "${TEMP}/bin/mv" "${TEMP}/bin/cp"

count_files() {
  local count=0 file
  for file in "$@"; do
    [[ -f "${file}" ]] && count=$((count + 1))
  done
  echo "${count}"
}

assert_no_transaction_debris() {
  local root="$1" debris
  debris="$(find "${root}" \( -name '*.backup.*' -o -name '*.stage.*' -o -name '.copilot-minions-install.lock' \) -print -quit)"
  if [[ -n "${debris}" ]]; then
    echo "Unexpected installer transaction debris: ${debris}" >&2
    exit 1
  fi
}

expect_install_failure() {
  local expected="$1"
  shift
  local output
  if output="$(bash "${ROOT}/install.sh" "$@" 2>&1)"; then
    echo "Expected installer failure containing: ${expected}" >&2
    exit 1
  fi
  grep -Fq -- "${expected}" <<<"${output}" || {
    echo "Installer failure did not contain '${expected}':" >&2
    echo "${output}" >&2
    exit 1
  }
}

export MINIONS_TEST_MODELS=complete
export MINIONS_TEST_PI_INSTALL_LOG="${TEMP}/pi-install.log"
export MINIONS_TEST_PI_COMMAND_LOG="${TEMP}/pi-command.log"
: > "${MINIONS_TEST_PI_COMMAND_LOG}"
GLOBAL_OUTPUT="$(bash "${ROOT}/install.sh" --platform all)"
grep -Fxq 'Installed platform: all; variant: standard' <<<"${GLOBAL_OUTPUT}"
! grep -Fq 'scope: global' <<<"${GLOBAL_OUTPUT}"
grep -Fq '|install npm:pi-subagents@0.37.2' "${MINIONS_TEST_PI_COMMAND_LOG}"
grep -Fq '|install npm:pi-mcp-adapter@2.16.0' "${MINIONS_TEST_PI_COMMAND_LOG}"
! grep -Fq '|install -l ' "${MINIONS_TEST_PI_COMMAND_LOG}"

COPILOT_SKILL="${MINIONS_HOME}/.copilot/skills/copilot-minions"
CODEX_SKILL="${MINIONS_HOME}/.agents/skills/codex-minions"
PI_SKILL="${MINIONS_HOME}/.pi/agent/skills/pi-minions"
PI_EXTENSION="${MINIONS_HOME}/.pi/agent/extensions/pi-minions"
PI_AGENTS="${MINIONS_HOME}/.pi/agent/agents/copilot-minions"
AGENTS="${MINIONS_HOME}/.codex/agents"

[[ -f "${COPILOT_SKILL}/frontier.md" ]]
[[ -f "${CODEX_SKILL}/frontier.md" ]]
[[ -f "${PI_SKILL}/frontier.md" ]]
[[ -f "${COPILOT_SKILL}/control.md" ]]
[[ -f "${CODEX_SKILL}/control.md" ]]
[[ -f "${PI_SKILL}/control.md" ]]
grep -Fq 'Triage: 8/12' "${PI_SKILL}/control.md"
grep -Fq 'Triage: 12/12' "${PI_SKILL}/control.md"
[[ -f "${PI_SKILL}/platform.md" ]]
grep -Fq 'budgetClass: "closure"' "${PI_SKILL}/platform.md"
[[ -f "${PI_EXTENSION}/index.ts" ]]
[[ -f "${PI_AGENTS}/pi-minions-reviewer.md" ]]
[[ -f "${PI_AGENTS}/pi-minions-review-axis.md" ]]
[[ "$(count_files "${PI_AGENTS}"/pi-minions-*.md)" -eq 7 ]]
grep -Fxq 'npm:pi-subagents@0.37.2' "${MINIONS_TEST_PI_INSTALL_LOG}"
grep -Fxq 'npm:pi-mcp-adapter@2.16.0' "${MINIONS_TEST_PI_INSTALL_LOG}"
: > "${MINIONS_TEST_PI_INSTALL_LOG}"
bash "${ROOT}/install.sh" --platform paseo >/dev/null
grep -Fxq 'npm:pi-mcp-adapter@2.16.0' "${MINIONS_TEST_PI_INSTALL_LOG}"
! grep -Fq 'pi-subagents' "${MINIONS_TEST_PI_INSTALL_LOG}"
[[ -f "${COPILOT_SKILL}/platform.md" ]]
[[ -f "${CODEX_SKILL}/platform.md" ]]
grep -Eq 'mechanical.*grok-4\.5.*high' "${COPILOT_SKILL}/models.md"
grep -Eq 'mechanical.*gpt-5\.6-luna.*low' "${CODEX_SKILL}/models.md"
grep -Fq '## `openai-codex`' "${PI_SKILL}/models.md"
grep -Fq '## `github-copilot`' "${PI_SKILL}/models.md"
[[ ! -e "${CODEX_SKILL}/custom-agents" ]]
[[ "$(count_files "${AGENTS}"/codex-minions-*.toml)" -eq 6 ]]
[[ -f "${AGENTS}/.codex-minions-manifest" ]]
for discipline in implement to-spec to-tickets tdd code-review diagnosing-bugs codebase-design domain-modeling grilling; do
  [[ -L "${MINIONS_HOME}/.agents/skills/${discipline}" ]]
  [[ -L "${MINIONS_HOME}/.pi/agent/skills/${discipline}" ]]
done

bash "${ROOT}/install.sh" --platform all >/dev/null
[[ "$(count_files "${AGENTS}"/codex-minions-*.toml)" -eq 6 ]]

export MINIONS_TEST_MODELS=lb
bash "${ROOT}/install.sh" --platform codex --variant lb >/dev/null
CODEX_LB_SKILL="${MINIONS_HOME}/.agents/skills/codex-minions-lb"
[[ -f "${CODEX_LB_SKILL}/models.md" ]]
grep -Eq 'explorer.*gpt-5.6-luna.*medium' "${CODEX_LB_SKILL}/models.md"

export MINIONS_TEST_MODELS=complete
bash "${ROOT}/install.sh" --platform all --variant all >/dev/null
[[ -f "${MINIONS_HOME}/.copilot/skills/copilot-minions-lb/SKILL.md" ]]
[[ -f "${MINIONS_HOME}/.pi/agent/skills/pi-minions-lb/SKILL.md" ]]
[[ -f "${MINIONS_HOME}/.pi/agent/skills/pi-minions-lb/control.md" ]]
grep -Eq 'architect.*grok-4\.5.*high' "${MINIONS_HOME}/.copilot/skills/copilot-minions-lb/models.md"
grep -Fq 'gpt-5.6-luna:xhigh' "${MINIONS_HOME}/.pi/agent/skills/pi-minions-lb/models.md"
grep -Fq 'grok-4.5:high' "${MINIONS_HOME}/.pi/agent/skills/pi-minions-lb/models.md"
[[ "$(count_files "${AGENTS}"/codex-minions*.toml)" -eq 12 ]]
[[ -f "${AGENTS}/.codex-minions-lb-manifest" ]]

touch "${COPILOT_SKILL}/rollback-sentinel" "${CODEX_SKILL}/rollback-sentinel"
touch "${MINIONS_HOME}/.copilot/skills/copilot-minions-lb/untouched-sentinel"
export MINIONS_TEST_FAIL_MOVE_TARGET="/.agents/skills/codex-minions"
export MINIONS_TEST_FAIL_MOVE_STATE="${TEMP}/mv-failed"
if bash "${ROOT}/install.sh" --platform all >/dev/null 2>&1; then
  echo 'Expected injected commit failure.' >&2
  exit 1
fi
unset MINIONS_TEST_FAIL_MOVE_TARGET MINIONS_TEST_FAIL_MOVE_STATE
[[ -f "${COPILOT_SKILL}/rollback-sentinel" ]]
[[ -f "${CODEX_SKILL}/rollback-sentinel" ]]
[[ -f "${MINIONS_HOME}/.copilot/skills/copilot-minions-lb/untouched-sentinel" ]]

# Project-local Paseo uses the invocation cwd, keeps role prompts beside the
# extension, installs both self-contained variants, and never creates Pi agents.
GLOBAL_PROJECT_SENTINEL="${PI_EXTENSION}/project-scope-must-not-touch-global"
GLOBAL_DISCIPLINE_SENTINEL="${MINIONS_HOME}/.pi/agent/skills/implement"
touch "${GLOBAL_PROJECT_SENTINEL}"
rm "${GLOBAL_DISCIPLINE_SENTINEL}"
PASEO_PROJECT="${TEMP}/paseo-project"
mkdir -p "${PASEO_PROJECT}/.pi/agents/user-owned"
printf '%s\n' '# user-owned Paseo agent' > "${PASEO_PROJECT}/.pi/agents/user-owned/agent.md"
: > "${MINIONS_TEST_PI_COMMAND_LOG}"
PASEO_OUTPUT="$(cd "${PASEO_PROJECT}" && bash "${ROOT}/install.sh" --platform paseo --scope project --variant all)"
PASEO_PROJECT_EXTENSION="${PASEO_PROJECT}/.pi/extensions/pi-minions"
PASEO_PROJECT_SKILL="${PASEO_PROJECT}/.pi/skills/pi-minions"
PASEO_PROJECT_LB_SKILL="${PASEO_PROJECT}/.pi/skills/pi-minions-lb"
[[ -f "${PASEO_PROJECT_EXTENSION}/index.ts" ]]
[[ -f "${PASEO_PROJECT_EXTENSION}/agents/pi-minions-reviewer.md" ]]
[[ "$(count_files "${PASEO_PROJECT_EXTENSION}"/agents/pi-minions-*.md)" -eq 7 ]]
[[ -f "${PASEO_PROJECT_SKILL}/control.md" ]]
[[ -f "${PASEO_PROJECT_SKILL}/scripts/update-disciplines.sh" ]]
[[ -f "${PASEO_PROJECT_LB_SKILL}/control.md" ]]
grep -Fq 'gpt-5.6-luna:xhigh' "${PASEO_PROJECT_LB_SKILL}/models.md"
[[ -f "${PASEO_PROJECT_EXTENSION}/.managed-by-copilot-minions" ]]
[[ -f "${PASEO_PROJECT_SKILL}/.managed-by-copilot-minions" ]]
[[ -f "${PASEO_PROJECT_LB_SKILL}/.managed-by-copilot-minions" ]]
[[ ! -e "${PASEO_PROJECT}/.pi/agent" ]]
[[ ! -e "${PASEO_PROJECT}/.pi/agents/copilot-minions" ]]
[[ -f "${PASEO_PROJECT}/.pi/agents/user-owned/agent.md" ]]
[[ ! -e "${PASEO_PROJECT}/.pi/skills/implement" ]]
[[ -f "${GLOBAL_PROJECT_SENTINEL}" ]]
[[ ! -e "${GLOBAL_DISCIPLINE_SENTINEL}" ]]
grep -Fxq "${PASEO_PROJECT}|install -l npm:pi-mcp-adapter@2.16.0" "${MINIONS_TEST_PI_COMMAND_LOG}"
! grep -Fq 'pi-subagents' "${MINIONS_TEST_PI_COMMAND_LOG}"
grep -Fq 'Skipping discipline update for project scope' <<<"${PASEO_OUTPUT}"
assert_no_transaction_debris "${PASEO_PROJECT}"

# Reinstall replaces only managed resources and leaves unrelated project agents.
touch "${PASEO_PROJECT_EXTENSION}/idempotence-sentinel" "${PASEO_PROJECT_SKILL}/idempotence-sentinel"
(cd "${PASEO_PROJECT}" && bash "${ROOT}/install.sh" --platform paseo --scope project --variant all >/dev/null)
[[ ! -e "${PASEO_PROJECT_EXTENSION}/idempotence-sentinel" ]]
[[ ! -e "${PASEO_PROJECT_SKILL}/idempotence-sentinel" ]]
[[ -f "${PASEO_PROJECT}/.pi/agents/user-owned/agent.md" ]]
assert_no_transaction_debris "${PASEO_PROJECT}"

# Ordinary Pi supports a relative explicit target and installs managed companion agents.
PI_PROJECT_PARENT="${TEMP}/pi-project-parent"
PI_PROJECT="${PI_PROJECT_PARENT}/project"
mkdir -p "${PI_PROJECT}"
: > "${MINIONS_TEST_PI_COMMAND_LOG}"
(cd "${PI_PROJECT_PARENT}" && bash "${ROOT}/install.sh" --platform pi --scope project --target-dir project >/dev/null)
PI_PROJECT_EXTENSION="${PI_PROJECT}/.pi/extensions/pi-minions"
PI_PROJECT_SKILL="${PI_PROJECT}/.pi/skills/pi-minions"
PI_PROJECT_AGENTS="${PI_PROJECT}/.pi/agents/copilot-minions"
[[ -f "${PI_PROJECT_EXTENSION}/index.ts" ]]
[[ -f "${PI_PROJECT_SKILL}/SKILL.md" ]]
[[ -f "${PI_PROJECT_SKILL}/scripts/update-disciplines.sh" ]]
[[ ! -e "${PI_PROJECT}/.pi/skills/pi-minions-lb" ]]
[[ -f "${PI_PROJECT_AGENTS}/.managed-by-copilot-minions" ]]
[[ -f "${PI_PROJECT_AGENTS}/pi-minions-reviewer.md" ]]
[[ "$(count_files "${PI_PROJECT_AGENTS}"/pi-minions-*.md)" -eq 7 ]]
[[ ! -e "${PI_PROJECT}/.pi/agent" ]]
grep -Fxq "${PI_PROJECT}|install -l npm:pi-subagents@0.37.2" "${MINIONS_TEST_PI_COMMAND_LOG}"
! grep -Fq 'pi-mcp-adapter' "${MINIONS_TEST_PI_COMMAND_LOG}"
[[ -f "${GLOBAL_PROJECT_SENTINEL}" ]]
assert_no_transaction_debris "${PI_PROJECT}"

# Runtime failure occurs before commit and preserves the prior managed install.
touch "${PI_PROJECT_EXTENSION}/package-failure-sentinel" \
  "${PI_PROJECT_SKILL}/package-failure-sentinel" \
  "${PI_PROJECT_AGENTS}/package-failure-sentinel"
export MINIONS_TEST_PI_FAIL_PACKAGE='npm:pi-subagents@0.37.2'
if (cd "${PI_PROJECT}" && bash "${ROOT}/install.sh" --platform pi --scope project >/dev/null 2>&1); then
  echo 'Expected project-local Pi package failure.' >&2
  exit 1
fi
unset MINIONS_TEST_PI_FAIL_PACKAGE
[[ -f "${PI_PROJECT_EXTENSION}/package-failure-sentinel" ]]
[[ -f "${PI_PROJECT_SKILL}/package-failure-sentinel" ]]
[[ -f "${PI_PROJECT_AGENTS}/package-failure-sentinel" ]]
assert_no_transaction_debris "${PI_PROJECT}"

# An injected commit failure rolls extension, agents, and skill back as one unit.
export MINIONS_TEST_FAIL_MOVE_TARGET='/.pi/skills/pi-minions'
export MINIONS_TEST_FAIL_MOVE_STATE="${TEMP}/project-mv-failed"
if (cd "${PI_PROJECT}" && bash "${ROOT}/install.sh" --platform pi --scope project >/dev/null 2>&1); then
  echo 'Expected injected project commit failure.' >&2
  exit 1
fi
unset MINIONS_TEST_FAIL_MOVE_TARGET MINIONS_TEST_FAIL_MOVE_STATE
[[ -f "${PI_PROJECT_EXTENSION}/package-failure-sentinel" ]]
[[ -f "${PI_PROJECT_SKILL}/package-failure-sentinel" ]]
[[ -f "${PI_PROJECT_AGENTS}/package-failure-sentinel" ]]
assert_no_transaction_debris "${PI_PROJECT}"

# Unmanaged project resources fail before the package command is invoked.
UNMANAGED_PASEO_PROJECT="${TEMP}/unmanaged-paseo-project"
mkdir -p "${UNMANAGED_PASEO_PROJECT}/.pi/extensions/pi-minions"
printf '%s\n' '// user-owned' > "${UNMANAGED_PASEO_PROJECT}/.pi/extensions/pi-minions/index.ts"
: > "${MINIONS_TEST_PI_COMMAND_LOG}"
if (cd "${UNMANAGED_PASEO_PROJECT}" && bash "${ROOT}/install.sh" --platform paseo --scope project >/dev/null 2>&1); then
  echo 'Expected unmanaged project extension collision.' >&2
  exit 1
fi
[[ ! -s "${MINIONS_TEST_PI_COMMAND_LOG}" ]]
assert_no_transaction_debris "${UNMANAGED_PASEO_PROJECT}"

UNMANAGED_PI_PROJECT="${TEMP}/unmanaged-pi-project"
mkdir -p "${UNMANAGED_PI_PROJECT}/.pi/agents/copilot-minions"
printf '%s\n' '# user-owned' > "${UNMANAGED_PI_PROJECT}/.pi/agents/copilot-minions/agent.md"
: > "${MINIONS_TEST_PI_COMMAND_LOG}"
if (cd "${UNMANAGED_PI_PROJECT}" && bash "${ROOT}/install.sh" --platform pi --scope project >/dev/null 2>&1); then
  echo 'Expected unmanaged project companion-agent collision.' >&2
  exit 1
fi
[[ ! -s "${MINIONS_TEST_PI_COMMAND_LOG}" ]]
assert_no_transaction_debris "${UNMANAGED_PI_PROJECT}"

UNMANAGED_SKILL_PROJECT="${TEMP}/unmanaged-skill-project"
mkdir -p "${UNMANAGED_SKILL_PROJECT}/.pi/skills/pi-minions"
printf '%s\n' '# user-owned' > "${UNMANAGED_SKILL_PROJECT}/.pi/skills/pi-minions/SKILL.md"
: > "${MINIONS_TEST_PI_COMMAND_LOG}"
if (cd "${UNMANAGED_SKILL_PROJECT}" && bash "${ROOT}/install.sh" --platform pi --scope project >/dev/null 2>&1); then
  echo 'Expected unmanaged project skill collision.' >&2
  exit 1
fi
[[ ! -s "${MINIONS_TEST_PI_COMMAND_LOG}" ]]
assert_no_transaction_debris "${UNMANAGED_SKILL_PROJECT}"

# A staging failure is cleaned before the package command and leaves no debris.
STAGING_FAILURE_PROJECT="${TEMP}/staging-failure-project"
mkdir -p "${STAGING_FAILURE_PROJECT}"
: > "${MINIONS_TEST_PI_COMMAND_LOG}"
export MINIONS_TEST_FAIL_COPY_TARGET='/.pi/extensions/.pi-minions.stage.'
export MINIONS_TEST_FAIL_COPY_STATE="${TEMP}/project-copy-failed"
if (cd "${STAGING_FAILURE_PROJECT}" && bash "${ROOT}/install.sh" --platform paseo --scope project >/dev/null 2>&1); then
  echo 'Expected injected project staging failure.' >&2
  exit 1
fi
unset MINIONS_TEST_FAIL_COPY_TARGET MINIONS_TEST_FAIL_COPY_STATE
[[ ! -s "${MINIONS_TEST_PI_COMMAND_LOG}" ]]
assert_no_transaction_debris "${STAGING_FAILURE_PROJECT}"

# The per-target lock prevents overlapping commits and is removed afterward.
CONCURRENT_PROJECT="${TEMP}/concurrent-project"
CONCURRENT_BLOCK="${TEMP}/concurrent-install"
mkdir -p "${CONCURRENT_PROJECT}"
(
  cd "${CONCURRENT_PROJECT}"
  MINIONS_TEST_PI_BLOCK_FILE="${CONCURRENT_BLOCK}" \
    bash "${ROOT}/install.sh" --platform paseo --scope project >/dev/null
) &
concurrent_pid=$!
for _ in {1..250}; do
  [[ -e "${CONCURRENT_BLOCK}.ready" ]] && break
  sleep 0.02
done
if [[ ! -e "${CONCURRENT_BLOCK}.ready" ]]; then
  : > "${CONCURRENT_BLOCK}.release"
  wait "${concurrent_pid}" || true
  echo 'Timed out waiting for concurrent installer.' >&2
  exit 1
fi
if concurrent_error="$(cd "${CONCURRENT_PROJECT}" && bash "${ROOT}/install.sh" --platform paseo --scope project 2>&1)"; then
  : > "${CONCURRENT_BLOCK}.release"
  wait "${concurrent_pid}" || true
  echo 'Expected concurrent installer to fail on the target lock.' >&2
  exit 1
fi
grep -Fq 'installation is already in progress' <<<"${concurrent_error}"
: > "${CONCURRENT_BLOCK}.release"
wait "${concurrent_pid}"
assert_no_transaction_debris "${CONCURRENT_PROJECT}"

# Project scope rejects ambiguous or unsupported platform combinations clearly.
expect_install_failure '--platform all is not supported with --scope project' --platform all --scope project
expect_install_failure "Platform 'copilot' does not support --scope project" --platform copilot --scope project
expect_install_failure "Platform 'codex' does not support --scope project" --platform codex --scope project
expect_install_failure '--target-dir is only valid with --scope project' --platform paseo --target-dir "${PASEO_PROJECT}"
expect_install_failure 'Unknown scope: invalid' --platform paseo --scope invalid
expect_install_failure 'Project target directory not found:' --platform paseo --scope project --target-dir "${TEMP}/missing-project"

# A failed global preflight keeps the historical no-write behavior.
PREFLIGHT_HOME="${TEMP}/preflight-home"
if MINIONS_HOME="${PREFLIGHT_HOME}" MINIONS_TEST_MODELS=missing \
  bash "${ROOT}/install.sh" --platform codex >/dev/null 2>&1; then
  echo 'Expected isolated Codex preflight failure.' >&2
  exit 1
fi
[[ ! -e "${PREFLIGHT_HOME}" ]]

touch "${PI_EXTENSION}/catalog-sentinel"
export MINIONS_TEST_PI_MODELS=missing-grok
bash "${ROOT}/install.sh" --platform pi >/dev/null
[[ ! -e "${PI_EXTENSION}/catalog-sentinel" ]]
[[ -f "${PI_SKILL}/SKILL.md" ]]
unset MINIONS_TEST_PI_MODELS

touch "${COPILOT_SKILL}/sentinel"
export MINIONS_TEST_MODELS=missing
if bash "${ROOT}/install.sh" --platform all >/dev/null 2>&1; then
  echo 'Expected missing model preflight to fail.' >&2
  exit 1
fi
[[ -f "${COPILOT_SKILL}/sentinel" ]]

export MINIONS_TEST_MODELS=complete
printf '%s\n' '# user-owned' > "${AGENTS}/codex-minions-mechanical.toml"
if bash "${ROOT}/install.sh" --platform codex >/dev/null 2>&1; then
  echo 'Expected unmanaged agent collision to fail.' >&2
  exit 1
fi

rm "${PI_EXTENSION}/.managed-by-copilot-minions"
if bash "${ROOT}/install.sh" --platform pi >/dev/null 2>&1; then
  echo 'Expected unmanaged Pi extension collision to fail.' >&2
  exit 1
fi
printf '%s\n' 'managed-by: copilot-minions' > "${PI_EXTENSION}/.managed-by-copilot-minions"

if bash "${ROOT}/install.sh" --platform invalid >/dev/null 2>&1; then
  echo 'Expected invalid platform to fail.' >&2
  exit 1
fi

if bash "${ROOT}/install.sh" --variant invalid >/dev/null 2>&1; then
  echo 'Expected invalid variant to fail.' >&2
  exit 1
fi

export MINIONS_TEST_MODELS=preview
if bash "${ROOT}/install.sh" --platform codex --variant lb >/dev/null 2>&1; then
  echo 'Expected near-match model IDs to fail.' >&2
  exit 1
fi

grep -Fq 'REF=f8cc992e3053a84122412cde9e7baa899379cf6e' "${ROOT}/README.md"
grep -Fq "\$ref = 'f8cc992e3053a84122412cde9e7baa899379cf6e'" "${ROOT}/README.md"
! grep -Fq 'PROJECT_SCOPE_REF' "${ROOT}/README.md"
grep -Fq 'bash "$SOURCE/install.sh" --platform paseo --scope project' "${ROOT}/README.md"
grep -Fq "& (Join-Path \$source 'install.ps1') -Platform paseo -Scope project" "${ROOT}/README.md"
! grep -Fq 'REF=13e5813' "${ROOT}/README.md"

echo 'Bash installer smoke tests passed.'
