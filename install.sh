#!/usr/bin/env bash
set -Eeuo pipefail

PLATFORM="copilot"
VARIANT="standard"
SCOPE="global"
TARGET_DIR=""
INVOCATION_CWD="$(pwd -P)"
usage() {
  echo "Usage: $0 [--platform copilot|codex|pi|paseo|all] [--variant standard|lb|all] [--scope global|project] [--target-dir DIR]" >&2
}
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
    --scope)
      [[ $# -ge 2 ]] || { echo "Missing --scope value." >&2; exit 2; }
      SCOPE="$2"
      shift 2
      ;;
    --target-dir)
      [[ $# -ge 2 ]] || { echo "Missing --target-dir value." >&2; exit 2; }
      TARGET_DIR="$2"
      shift 2
      ;;
    *)
      usage
      exit 2
      ;;
  esac
done
case "${PLATFORM}" in copilot|codex|pi|paseo|all) ;; *) echo "Unknown platform: ${PLATFORM}" >&2; exit 2 ;; esac
case "${VARIANT}" in standard|lb|all) ;; *) echo "Unknown variant: ${VARIANT}" >&2; exit 2 ;; esac
case "${SCOPE}" in global|project) ;; *) echo "Unknown scope: ${SCOPE}" >&2; exit 2 ;; esac
if [[ "${SCOPE}" == "global" && -n "${TARGET_DIR}" ]]; then
  echo "--target-dir is only valid with --scope project." >&2
  exit 2
fi
if [[ "${SCOPE}" == "project" ]]; then
  if [[ "${PLATFORM}" == "all" ]]; then
    echo "--platform all is not supported with --scope project; choose pi or paseo." >&2
    exit 2
  fi
  case "${PLATFORM}" in
    pi|paseo) ;;
    *) echo "Platform '${PLATFORM}' does not support --scope project; choose pi or paseo." >&2; exit 2 ;;
  esac
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_HOME="${MINIONS_HOME:-$HOME}"
PROJECT_ROOT=""
if [[ "${SCOPE}" == "project" ]]; then
  project_candidate="${TARGET_DIR:-${INVOCATION_CWD}}"
  [[ -d "${project_candidate}" ]] || { echo "Project target directory not found: ${project_candidate}" >&2; exit 1; }
  PROJECT_ROOT="$(cd "${project_candidate}" && pwd -P)"
fi
CORE="${ROOT}/skills/core"
LB_PROFILE="${ROOT}/skills/lb"
MANAGED_MARKER="# managed-by: copilot-minions"
PI_SUBAGENTS_PACKAGE="${PI_SUBAGENTS_PACKAGE:-npm:pi-subagents@0.37.2}"
PI_MCP_ADAPTER_PACKAGE="${PI_MCP_ADAPTER_PACKAGE:-npm:pi-mcp-adapter@2.16.0}"
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
LOCK_PATH=""
LOCK_ACQUIRED=0

selected_platform() { [[ "${PLATFORM}" == "$1" || "${PLATFORM}" == "all" ]]; }
selected_pi_host() { selected_platform pi || selected_platform paseo; }
selected_variant() { [[ "${VARIANT}" == "$1" || "${VARIANT}" == "all" ]]; }
require_directory() { [[ -d "$1" ]] || { echo "Source directory not found: $1" >&2; exit 1; }; }

acquire_install_lock() {
  local lock_root="${INSTALL_HOME}"
  [[ "${SCOPE}" == "project" ]] && lock_root="${PROJECT_ROOT}"
  mkdir -p "${lock_root}"
  LOCK_PATH="${lock_root}/.copilot-minions-install.lock"
  if ! mkdir "${LOCK_PATH}" 2>/dev/null; then
    echo "Another copilot-minions installation is already in progress for ${lock_root}." >&2
    exit 1
  fi
  LOCK_ACQUIRED=1
}

assert_pi_available() {
  command -v pi >/dev/null 2>&1 || {
    echo "pi not found on PATH; Pi installation requires the Pi coding agent." >&2
    exit 1
  }
}

install_pi_package() {
  local package="$1"
  echo "Installing pinned Pi runtime: ${package}"
  if [[ "${SCOPE}" == "project" ]]; then
    if ! (cd "${PROJECT_ROOT}" && pi install -l "${package}"); then
      echo "Unable to install ${package} in project ${PROJECT_ROOT}; no Minions resources were committed." >&2
      exit 1
    fi
  elif ! pi install "${package}"; then
    echo "Unable to install ${package}; no Minions resources were committed." >&2
    exit 1
  fi
}

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

assert_managed_pi_directory() {
  local path="$1"
  if [[ -e "${path}" && ! -f "${path}/.managed-by-copilot-minions" ]]; then
    echo "Refusing to overwrite unmanaged Pi resource: ${path}" >&2
    exit 1
  fi
}

new_skill_stage() {
  local name="$1" overlay="$2" profile="$3" destination="$4" managed="${5:-false}"
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
  [[ -f "${overlay}/models.md" ]] && cp "${overlay}/models.md" "${stage}/models.md"
  [[ -d "${ROOT}/scripts" ]] && cp -R "${ROOT}/scripts" "${stage}/scripts"
  [[ "${managed}" == "true" ]] && printf '%s\n' 'managed-by: copilot-minions' > "${stage}/.managed-by-copilot-minions"
  STAGE_PATHS+=("${stage}")
  SKILL_STAGES+=("${stage}")
  SKILL_DESTS+=("${destination}")
  SKILL_BACKUPS+=("")
}

new_pi_extension_stage() {
  local destination="$1"
  local source="${ROOT}/extensions/pi-minions"
  require_directory "${source}"
  assert_managed_pi_directory "${destination}"
  local parent stage
  parent="$(dirname "${destination}")"
  mkdir -p "${parent}"
  stage="${parent}/.pi-minions.stage.${TRANSACTION_ID}"
  mkdir -p "${stage}"
  cp -R "${source}/." "${stage}/"
  STAGE_PATHS+=("${stage}")
  SKILL_STAGES+=("${stage}")
  SKILL_DESTS+=("${destination}")
  SKILL_BACKUPS+=("")
}

new_pi_agents_stage() {
  local destination="$1"
  local source="${ROOT}/extensions/pi-minions/agents"
  require_directory "${source}"
  assert_managed_pi_directory "${destination}"
  local parent stage
  parent="$(dirname "${destination}")"
  mkdir -p "${parent}"
  stage="${parent}/.copilot-minions-agents.stage.${TRANSACTION_ID}"
  mkdir -p "${stage}"
  cp -R "${source}/." "${stage}/"
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
  if selected_pi_host; then
    name="pi-minions${suffix}"
    overlay="${ROOT}/skills/${name}"
    local destination="${INSTALL_HOME}/.pi/agent/skills/${name}"
    [[ "${SCOPE}" == "project" ]] && destination="${PROJECT_ROOT}/.pi/skills/${name}"
    assert_managed_pi_directory "${destination}"
    new_skill_stage "${name}" "${overlay}" "${profile}" "${destination}" true
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
  if [[ ${LOCK_ACQUIRED} -eq 1 && -d "${LOCK_PATH}" ]]; then
    rmdir "${LOCK_PATH}" 2>/dev/null || true
    LOCK_ACQUIRED=0
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
acquire_install_lock
selected_platform codex && assert_codex_models
selected_pi_host && assert_pi_available
if selected_pi_host; then
  if [[ "${SCOPE}" == "project" ]]; then
    new_pi_extension_stage "${PROJECT_ROOT}/.pi/extensions/pi-minions"
    if selected_platform pi; then
      new_pi_agents_stage "${PROJECT_ROOT}/.pi/agents/copilot-minions"
    fi
  else
    new_pi_extension_stage "${INSTALL_HOME}/.pi/agent/extensions/pi-minions"
    new_pi_agents_stage "${INSTALL_HOME}/.pi/agent/agents/copilot-minions"
  fi
fi
selected_variant standard && add_variant_stages standard
selected_variant lb && add_variant_stages lb
selected_platform pi && install_pi_package "${PI_SUBAGENTS_PACKAGE}"
selected_platform paseo && install_pi_package "${PI_MCP_ADAPTER_PACKAGE}"

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

if [[ "${SCOPE}" == "project" ]]; then
  echo "Installed platform: ${PLATFORM}; variant: ${VARIANT}; scope: project"
  echo "  target: ${PROJECT_ROOT}"
else
  echo "Installed platform: ${PLATFORM}; variant: ${VARIANT}"
fi
for destination in "${SKILL_DESTS[@]}"; do echo "  ${destination}"; done
selected_platform codex && echo "  ${INSTALL_HOME}/.codex/agents (managed minions agents)"
selected_platform pi && echo "  ${PI_SUBAGENTS_PACKAGE} (pinned Pi worker runtime)"
selected_platform paseo && echo "  ${PI_MCP_ADAPTER_PACKAGE} (pinned Paseo MCP bridge)"
echo

UPDATER="${ROOT}/scripts/update-disciplines.sh"
if [[ "${SCOPE}" == "project" ]]; then
  echo "Skipping discipline update for project scope; project-local Minions skills are self-contained."
  echo
elif [[ -f "${UPDATER}" ]]; then
  echo "Updating discipline skills..."
  updater_platform="${PLATFORM}"
  [[ "${updater_platform}" == "paseo" ]] && updater_platform="pi"
  bash "${UPDATER}" --platform "${updater_platform}" || echo "Discipline update skipped." >&2
  echo
fi

echo "Opt in with 'orchestrate', 'minions on', or 'go build it'."
