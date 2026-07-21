#!/usr/bin/env bash
set -euo pipefail

PLATFORM="copilot"
if [[ $# -gt 0 ]]; then
  if [[ $# -ne 2 || "$1" != "--platform" ]]; then
    echo "Usage: $0 [--platform copilot|codex|pi|all]" >&2
    exit 2
  fi
  PLATFORM="$2"
fi
case "${PLATFORM}" in
  copilot|codex|pi|all) ;;
  *) echo "Unknown platform: ${PLATFORM}" >&2; exit 2 ;;
esac

REPO_URL="https://github.com/mattpocock/skills.git"
REF="${REF:-main}"
INSTALL_HOME="${MINIONS_HOME:-$HOME}"
CACHE_DIR="${CACHE_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/copilot-minions/mattpocock-skills}"
DISCIPLINES=(implement to-spec to-tickets)

selected() {
  [[ "${PLATFORM}" == "$1" || "${PLATFORM}" == "all" ]]
}

require() {
  command -v "$1" >/dev/null 2>&1 || { echo "$1 not found on PATH." >&2; exit 1; }
}

require git
if selected copilot; then
  require copilot
fi

if [[ -d "${CACHE_DIR}/.git" ]]; then
  echo "Updating source: ${CACHE_DIR}"
  git -C "${CACHE_DIR}" fetch --quiet origin
  git -C "${CACHE_DIR}" reset --hard --quiet "origin/${REF}"
else
  echo "Cloning source into: ${CACHE_DIR}"
  mkdir -p "$(dirname "${CACHE_DIR}")"
  git clone --quiet --depth 1 --branch "${REF}" "${REPO_URL}" "${CACHE_DIR}"
fi
echo "Source at ${REF} @ $(git -C "${CACHE_DIR}" rev-parse --short HEAD)"

LIST_JSON="[]"
if selected copilot; then
  LIST_JSON="$(copilot skill list --json 2>/dev/null || echo '[]')"
fi

for discipline in "${DISCIPLINES[@]}"; do
  source_dir="${CACHE_DIR}/skills/engineering/${discipline}"
  if [[ ! -d "${source_dir}" ]]; then
    echo "Warning: upstream no longer provides '${discipline}'; skipping." >&2
    continue
  fi
  canonical="$(cd "${source_dir}" && pwd -P)"

  if selected copilot; then
    if command -v python3 >/dev/null 2>&1; then
      while IFS= read -r stale; do
        [[ -n "${stale}" ]] || continue
        echo "Removing stale Copilot registration: ${stale}"
        copilot skill remove "${stale}" >/dev/null 2>&1 || true
      done < <(printf '%s' "${LIST_JSON}" | python3 -c '
import json, sys
name, canonical = sys.argv[1], sys.argv[2]
try:
    entries = json.load(sys.stdin)
except Exception:
    entries = []
for entry in entries:
    if entry.get("name") == name and entry.get("source") == "custom" and entry.get("path") != canonical:
        print(entry.get("path"))
' "${discipline}" "${canonical}")
    fi
    copilot skill add "${source_dir}" >/dev/null
    echo "  Copilot: ${discipline} -> ${canonical}"
  fi

  if selected codex; then
    skills_dir="${INSTALL_HOME}/.agents/skills"
    target="${skills_dir}/${discipline}"
    mkdir -p "${skills_dir}"
    if [[ -L "${target}" ]]; then
      resolved="$(cd "${target}" && pwd -P)"
      if [[ "${resolved}" != "${canonical}" ]]; then
        echo "Codex discipline link points elsewhere: ${target} -> ${resolved}" >&2
        exit 1
      fi
    elif [[ -e "${target}" ]]; then
      echo "Refusing to replace unmanaged Codex discipline: ${target}" >&2
      exit 1
    else
      ln -s "${canonical}" "${target}"
    fi
    echo "  Codex: ${discipline} -> ${canonical}"
  fi

  if selected pi; then
    skills_dir="${INSTALL_HOME}/.pi/agent/skills"
    target="${skills_dir}/${discipline}"
    mkdir -p "${skills_dir}"
    if [[ -L "${target}" ]]; then
      resolved="$(cd "${target}" && pwd -P)"
      if [[ "${resolved}" != "${canonical}" ]]; then
        echo "Pi discipline link points elsewhere: ${target} -> ${resolved}" >&2
        exit 1
      fi
    elif [[ -e "${target}" ]]; then
      echo "Refusing to replace unmanaged Pi discipline: ${target}" >&2
      exit 1
    else
      ln -s "${canonical}" "${target}"
    fi
    echo "  Pi: ${discipline} -> ${canonical}"
  fi
done

echo
echo "Disciplines updated for platform: ${PLATFORM}"
