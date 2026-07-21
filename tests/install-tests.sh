#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMP="$(mktemp -d)"
trap 'rm -rf "${TEMP}"' EXIT

export MINIONS_HOME="${TEMP}/home"
export CACHE_DIR="${TEMP}/cache"
export PATH="${TEMP}/bin:${PATH}"
mkdir -p "${MINIONS_HOME}" "${TEMP}/bin" "${CACHE_DIR}/.git"

for discipline in implement to-spec to-tickets; do
  mkdir -p "${CACHE_DIR}/skills/engineering/${discipline}"
  printf '%s\n' "---" "name: ${discipline}" "---" > "${CACHE_DIR}/skills/engineering/${discipline}/SKILL.md"
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
    'github-copilot gpt-5.6-terra' \
    'github-copilot gpt-5.6-luna'
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
chmod +x "${TEMP}/bin/codex" "${TEMP}/bin/copilot" "${TEMP}/bin/pi" "${TEMP}/bin/git" "${TEMP}/bin/mv"

count_files() {
  local count=0 file
  for file in "$@"; do
    [[ -f "${file}" ]] && count=$((count + 1))
  done
  echo "${count}"
}

export MINIONS_TEST_MODELS=complete
bash "${ROOT}/install.sh" --platform all >/dev/null

COPILOT_SKILL="${MINIONS_HOME}/.copilot/skills/copilot-minions"
CODEX_SKILL="${MINIONS_HOME}/.agents/skills/codex-minions"
PI_SKILL="${MINIONS_HOME}/.pi/agent/skills/pi-minions"
PI_EXTENSION="${MINIONS_HOME}/.pi/agent/extensions/pi-minions"
AGENTS="${MINIONS_HOME}/.codex/agents"

[[ -f "${COPILOT_SKILL}/frontier.md" ]]
[[ -f "${CODEX_SKILL}/frontier.md" ]]
[[ -f "${PI_SKILL}/frontier.md" ]]
[[ -f "${PI_SKILL}/platform.md" ]]
[[ -f "${PI_EXTENSION}/index.ts" ]]
[[ -f "${COPILOT_SKILL}/platform.md" ]]
[[ -f "${CODEX_SKILL}/platform.md" ]]
[[ ! -e "${CODEX_SKILL}/custom-agents" ]]
[[ "$(count_files "${AGENTS}"/codex-minions-*.toml)" -eq 6 ]]
[[ -f "${AGENTS}/.codex-minions-manifest" ]]
for discipline in implement to-spec to-tickets; do
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

echo 'Bash installer smoke tests passed.'
