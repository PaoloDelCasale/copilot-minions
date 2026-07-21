#!/usr/bin/env bash
set -euo pipefail

# Keep the copilot-minions discipline skills current with mattpocock/skills.
#
# copilot-minions references (never forks) Matt Pocock's engineering skills. This
# script clones/pulls mattpocock/skills into a portable cache and registers the
# three disciplines that are not in Copilot's default personal set — implement,
#   to-spec, to-tickets — as custom skills (directory references). Because they are
# directory references to the cache, a weekly pull refreshes their content.
#
# Idempotent: safe to run repeatedly. Run manually, from install.sh, or from a
# weekly Copilot scheduled workflow.
#
# Env overrides:
#   CACHE_DIR   where to keep the checkout (default: ${XDG_CACHE_HOME:-~/.cache}/copilot-minions/mattpocock-skills)
#   REF         git branch/ref to track (default: main)

REPO_URL='https://github.com/mattpocock/skills.git'
REF="${REF:-main}"
CACHE_DIR="${CACHE_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/copilot-minions/mattpocock-skills}"
DISCIPLINES=(implement to-spec to-tickets)

require() {
  command -v "$1" >/dev/null 2>&1 || { echo "$1 not found on PATH." >&2; exit 1; }
}
require git
require copilot

# --- 1. Clone or update the source -------------------------------------------
if [ -d "${CACHE_DIR}/.git" ]; then
  echo "Updating source: ${CACHE_DIR}"
  git -C "${CACHE_DIR}" fetch --quiet origin
  git -C "${CACHE_DIR}" reset --hard --quiet "origin/${REF}"
else
  echo "Cloning source into: ${CACHE_DIR}"
  mkdir -p "$(dirname "${CACHE_DIR}")"
  git clone --quiet --depth 1 --branch "${REF}" "${REPO_URL}" "${CACHE_DIR}"
fi
echo "Source at ${REF} @ $(git -C "${CACHE_DIR}" rev-parse --short HEAD)"

# --- 2. Register each discipline from the cache ------------------------------
LIST_JSON="$(copilot skill list --json 2>/dev/null || echo '[]')"

for d in "${DISCIPLINES[@]}"; do
  dir="${CACHE_DIR}/skills/engineering/${d}"
  if [ ! -d "${dir}" ]; then
    echo "Warning: upstream no longer provides '${d}' at skills/engineering/${d} — skipping." >&2
    continue
  fi
  canonical="$(cd "${dir}" && pwd)"

  # Drop any stale custom registration of this skill that points elsewhere.
  if command -v python3 >/dev/null 2>&1; then
    while IFS= read -r stale; do
      [ -n "${stale}" ] || continue
      echo "Removing stale registration: ${stale}"
      copilot skill remove "${stale}" >/dev/null 2>&1 || true
    done < <(printf '%s' "${LIST_JSON}" | python3 -c '
import json, sys
name, canon = sys.argv[1], sys.argv[2]
try:
    data = json.load(sys.stdin)
except Exception:
    data = []
for s in data:
    if s.get("name") == name and s.get("source") == "custom" and s.get("path") != canon:
        print(s.get("path"))
' "${d}" "${canonical}")
  fi

  # Register from the cache (idempotent — re-adding the same dir is harmless).
  copilot skill add "${dir}" >/dev/null
  echo "  registered ${d} -> ${canonical}"
done

echo ""
echo "Disciplines updated. Verify with: copilot skill list"
