#!/usr/bin/env bash
set -euo pipefail

# Installs copilot-minions into the Copilot CLI user skills directory.
# Copies skills/copilot-minions -> ~/.agents/skills/copilot-minions
# Re-run after `git pull`.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="${ROOT}/skills/copilot-minions"
SKILLS="${HOME}/.agents/skills"
DEST="${SKILLS}/copilot-minions"

if [ ! -d "${SRC}" ]; then
  echo "Source not found: ${SRC}" >&2
  exit 1
fi

mkdir -p "${SKILLS}"
rm -rf "${DEST}"
cp -R "${SRC}" "${DEST}"

echo "Installed copilot-minions:"
echo "  ${DEST}"
echo ""
echo "Opt in with 'orchestrate', 'minions on', or 'go build it' in any project."
