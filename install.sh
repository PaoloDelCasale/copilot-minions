#!/usr/bin/env bash
set -euo pipefail

# Installs copilot-minions into the Copilot CLI user skills directory.
# Copies skills/copilot-minions -> ~/.copilot/skills/copilot-minions
# Re-run after `git pull`.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="${ROOT}/skills/copilot-minions"
SKILLS="${HOME}/.copilot/skills"
DEST="${SKILLS}/copilot-minions"

if [ ! -d "${SRC}" ]; then
  echo "Source not found: ${SRC}" >&2
  exit 1
fi

mkdir -p "${SKILLS}"
rm -rf "${DEST}"
cp -R "${SRC}" "${DEST}"

# Bundle the updater into the install dir so a scheduled workflow has a stable path.
if [ -d "${ROOT}/scripts" ]; then
  cp -R "${ROOT}/scripts" "${DEST}/scripts"
fi

echo "Installed copilot-minions:"
echo "  ${DEST}"
echo ""

# Register/update the discipline skills (implement, to-spec, to-tickets) from
# mattpocock/skills. Non-fatal: the orchestrator still runs on inline fallbacks.
UPDATER="${ROOT}/scripts/update-disciplines.sh"
if [ -f "${UPDATER}" ]; then
  echo "Updating discipline skills..."
  bash "${UPDATER}" || echo "Discipline update skipped." >&2
  echo ""
fi

echo "Opt in with 'orchestrate', 'minions on', or 'go build it' in any project."
