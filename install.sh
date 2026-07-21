#!/usr/bin/env bash
set -Eeuo pipefail

PLATFORM="copilot"
VARIANT="standard"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --platform)
      [[ $# -ge 2 ]] || { echo "Missing --platform value." >&2; exit 2; }
      PLATFORM="$2"
      shift 2
      ;;
    --variant)
      [[ $# -ge 2 ]] || { echo "Missing --variant value." >&2; exit 2; }
      VARIANT="$2"
      shift 2
      ;;
    *)
      echo "Usage: $0 [--platform copilot|codex|all] [--variant standard|lb|all]" >&2
      exit 2
      ;;
  esac
done
case "${PLATFORM}" in copilot|codex|all) ;; *) echo "Unknown platform: ${PLATFORM}" >&2; exit 2 ;; esac
case "${VARIANT}" in standard|lb|all) ;; *) echo "Unknown variant: ${VARIANT}" >&2; exit 2 ;; esac

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_HOME="${MINIONS_HOME:-$HOME}"
CORE="${ROOT}/skills/core"
LB_PROFILE="${ROOT}/skills/lb"
MANAGED_MARKER="# managed-by: copilot-minions"
TRANSACTION_ID="$$.$RANDOM"
STAGE_PATHS=()
SKILL_STAGES=()
SKILL_DESTS=()
SKILL_BACKUPS=()
TOUCHED_SKILL_DESTS=()
AGENT_STAGES=()
AGENT_TARGETS=()
AGENT_BACKUPS=()
NEW_AGENT_TARGETS=()
OBSOLETE_AGENT_TARGETS=()
COMMIT_STARTED=0

selected_platform() { [[ "${PLATFORM}" == "$1" || "${PLATFORM}" == "all" ]]; }
selected_variant() { [[ "${VARIANT}" == "$1" || "${VARIANT}" == "all" ]]; }
require_directory() { [[ -d "$1" ]] || { echo "Source directory not found: $1" >&2; exit 1; }; }

assert_codex_models() {
  command -v codex >/dev/null 2>&1 || {
    echo "codex not found on PATH; Codex installation requires a model-catalog preflight." >&2
    exit 1
  }
  local catalog
  if ! catalog="$(codex debug models 2>&1)"; then
    echo "Unable to read the Codex model catalog:" >&2
    echo "${catalog}" >&2
    exit 1
  fi
  local required=(gpt-5.6-sol gpt-5.6-luna)
  selected_variant standard && required+=(gpt-5.6-terra)
  local missing=() model
  for model in "${required[@]}"; do
    grep -Eq ':[[:space:]]*"'"${model}"'"([[:space:]]*[,}])' <<<"${catalog}" ||
      missing+=("${model}")
  done
  if [[ ${#missing[@]} -gt 0 ]]; then
    echo "Codex model catalog is missing required model(s): ${missing[*]}" >&2
    exit 1
  fi
}

assert_managed_file() {
  local path="$1"
  if [[ -e "${path}" && "$(head -n 1 "${path}" | tr -d '\r')" != "${MANAGED_MARKER}" ]]; then
    echo "Refusing to overwrite unmanaged Codex agent file: ${path}" >&2
    exit 1
  fi
}

new_skill_stage() {
  local name="$1" overlay="$2" profile="$3" destination="$4"
  require_directory "${overlay}"
  local parent stage
  parent="$(dirname "${destination}")"
  mkdir -p "${parent}"
  stage="${parent}/.${name}.stage.${TRANSACTION_ID}"
  mkdir -p "${stage}"
  cp -R "${CORE}/." "${stage}/"
  if [[ -n "${profile}" ]]; then
    require_directory "${profile}"
    cp -R "${profile}/." "${stage}/"
  fi
  cp "${overlay}/SKILL.md" "${overlay}/platform.md" "${stage}/"
  [[ -d "${ROOT}/scripts" ]] && cp -R "${ROOT}/scripts" "${stage}/scripts"
  STAGE_PATHS+=("${stage}")
  SKILL_STAGES+=("${stage}")
  SKILL_DESTS+=("${destination}")
  SKILL_BACKUPS+=("")
}

new_agent_stage() {
  local package_name="$1" overlay="$2"
  local source="${overlay}/custom-agents"
  local agents_dir="${INSTALL_HOME}/.codex/agents"
  require_directory "${source}"
  mkdir -p "${agents_dir}"
  local stage="${agents_dir}/.${package_name}.stage.${TRANSACTION_ID}"
  mkdir -p "${stage}"
  STAGE_PATHS+=("${stage}")
  AGENT_STAGES+=("${stage}")

  local source_file filename target
  for source_file in "${source}"/*.toml; do
    [[ -f "${source_file}" ]] || continue
    filename="$(basename "${source_file}")"
    target="${agents_dir}/${filename}"
    assert_managed_file "${target}"
    cp "${source_file}" "${stage}/${filename}"
  done

  local manifest_name=".${package_name}-manifest"
  local manifest="${agents_dir}/${manifest_name}"
  assert_managed_file "${manifest}"
  if [[ -f "${manifest}" ]]; then
    while IFS= read -r old_name; do
      old_name="${old_name%$'\r'}"
      [[ -n "${old_name}" ]] || continue
      if [[ ! -f "${source}/${old_name}" ]]; then
        old_target="${agents_dir}/${old_name}"
        assert_managed_file "${old_target}"
        OBSOLETE_AGENT_TARGETS+=("${old_target}")
      fi
    done < <(tail -n +2 "${manifest}")
  fi
  {
    echo "${MANAGED_MARKER}"
    for source_file in "${source}"/*.toml; do
      [[ -f "${source_file}" ]] && basename "${source_file}"
    done | sort
  } > "${stage}/${manifest_name}"
}

add_variant_stages() {
  local variant_name="$1" suffix="" profile="" name="" overlay=""
  if [[ "${variant_name}" == "lb" ]]; then
    suffix="-lb"
    profile="${LB_PROFILE}"
  fi
  if selected_platform copilot; then
    name="copilot-minions${suffix}"
    overlay="${ROOT}/skills/${name}"
    new_skill_stage "${name}" "${overlay}" "${profile}" "${INSTALL_HOME}/.copilot/skills/${name}"
  fi
  if selected_platform codex; then
    name="codex-minions${suffix}"
    overlay="${ROOT}/skills/${name}"
    new_agent_stage "${name}" "${overlay}"
    new_skill_stage "${name}" "${overlay}" "${profile}" "${INSTALL_HOME}/.agents/skills/${name}"
  fi
}

rollback() {
  local i
  if [[ ${#NEW_AGENT_TARGETS[@]} -gt 0 ]]; then
    for i in "${!NEW_AGENT_TARGETS[@]}"; do rm -f "${NEW_AGENT_TARGETS[$i]}"; done
  fi
  if [[ ${#AGENT_TARGETS[@]} -gt 0 ]]; then
    for i in "${!AGENT_TARGETS[@]}"; do
      if [[ -n "${AGENT_BACKUPS[$i]}" && -e "${AGENT_BACKUPS[$i]}" ]]; then
        mv "${AGENT_BACKUPS[$i]}" "${AGENT_TARGETS[$i]}"
      fi
    done
  fi
  if [[ ${#TOUCHED_SKILL_DESTS[@]} -gt 0 ]]; then
    for destination in "${TOUCHED_SKILL_DESTS[@]}"; do
      [[ -e "${destination}" ]] && rm -rf "${destination}"
    done
  fi
  for i in "${!SKILL_DESTS[@]}"; do
    if [[ -n "${SKILL_BACKUPS[$i]}" && -e "${SKILL_BACKUPS[$i]}" ]]; then
      mv "${SKILL_BACKUPS[$i]}" "${SKILL_DESTS[$i]}"
    fi
  done
}

cleanup() {
  local path
  if [[ ${#STAGE_PATHS[@]} -gt 0 ]]; then
    for path in "${STAGE_PATHS[@]}"; do
      if [[ -e "${path}" ]]; then
        rm -rf "${path}"
      fi
    done
  fi
  return 0
}

on_error() {
  local status=$?
  [[ ${COMMIT_STARTED} -eq 1 ]] && rollback
  cleanup
  exit "${status}"
}
trap on_error ERR
trap cleanup EXIT

require_directory "${CORE}"
selected_platform codex && assert_codex_models
selected_variant standard && add_variant_stages standard
selected_variant lb && add_variant_stages lb

COMMIT_STARTED=1
for i in "${!SKILL_DESTS[@]}"; do
  if [[ -e "${SKILL_DESTS[$i]}" ]]; then
    backup="${SKILL_DESTS[$i]}.backup.${TRANSACTION_ID}"
    mv "${SKILL_DESTS[$i]}" "${backup}"
    SKILL_BACKUPS[$i]="${backup}"
  fi
  TOUCHED_SKILL_DESTS+=("${SKILL_DESTS[$i]}")
  mv "${SKILL_STAGES[$i]}" "${SKILL_DESTS[$i]}"
done

if [[ ${#OBSOLETE_AGENT_TARGETS[@]} -gt 0 ]]; then
  for target in "${OBSOLETE_AGENT_TARGETS[@]}"; do
    if [[ -e "${target}" ]]; then
      backup="${target}.backup.${TRANSACTION_ID}"
      mv "${target}" "${backup}"
      AGENT_TARGETS+=("${target}")
      AGENT_BACKUPS+=("${backup}")
    fi
  done
fi
if [[ ${#AGENT_STAGES[@]} -gt 0 ]]; then
  for stage in "${AGENT_STAGES[@]}"; do
    agents_dir="$(dirname "${stage}")"
    for staged_file in "${stage}"/.* "${stage}"/*; do
      [[ -f "${staged_file}" ]] || continue
      filename="$(basename "${staged_file}")"
      target="${agents_dir}/${filename}"
      backup=""
      if [[ -e "${target}" ]]; then
        backup="${target}.backup.${TRANSACTION_ID}"
        mv "${target}" "${backup}"
      fi
      AGENT_TARGETS+=("${target}")
      AGENT_BACKUPS+=("${backup}")
      mv "${staged_file}" "${target}"
      NEW_AGENT_TARGETS+=("${target}")
    done
    rmdir "${stage}"
  done
fi

COMMIT_STARTED=0
trap - ERR
for backup in "${SKILL_BACKUPS[@]}"; do
  [[ -n "${backup}" && -e "${backup}" ]] && rm -rf "${backup}"
done
if [[ ${#AGENT_BACKUPS[@]} -gt 0 ]]; then
  for backup in "${AGENT_BACKUPS[@]}"; do
    [[ -n "${backup}" && -e "${backup}" ]] && rm -rf "${backup}"
  done
fi

echo "Installed platform: ${PLATFORM}; variant: ${VARIANT}"
for destination in "${SKILL_DESTS[@]}"; do echo "  ${destination}"; done
selected_platform codex && echo "  ${INSTALL_HOME}/.codex/agents (managed minions agents)"
echo

UPDATER="${ROOT}/scripts/update-disciplines.sh"
if [[ -f "${UPDATER}" ]]; then
  echo "Updating discipline skills..."
  bash "${UPDATER}" --platform "${PLATFORM}" || echo "Discipline update skipped." >&2
  echo
fi

echo "Opt in with 'orchestrate', 'minions on', or 'go build it'."
