#!/usr/bin/env bash
# Install the 100x skill suite. A thin wrapper so the first step needs no PATH setup.
# All logic lives in lib/install.mjs. Run with --help for the flags, --dry-run to preview, --uninstall to undo.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

if ! command -v node >/dev/null 2>&1 || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; then
  echo "100x needs Node 22 or newer. Install it (https://nodejs.org or your package manager) and run this again." >&2
  exit 1
fi

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  exec node "$here/../bin/100x.mjs" help install
fi

exec node "$here/../bin/100x.mjs" install "$@"
