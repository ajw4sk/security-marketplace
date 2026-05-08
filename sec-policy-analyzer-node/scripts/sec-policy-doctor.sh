#!/usr/bin/env bash
# Sec Policy Analyzer (Node) — environment doctor.
#
# Verifies node + the deps declared in scripts/package.json. Never installs
# anything on the user's behalf — prints the exact command and exits non-zero.
#
# Exit codes:
#   0  — environment OK
#   1  — node missing
#   2  — required node packages missing (install hint printed)
#   3  — bundled parser missing

set -u

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
SCRIPTS="${PLUGIN_ROOT}/scripts"
PARSER="${SCRIPTS}/parse_policy_v2.mjs"
PKG_JSON="${SCRIPTS}/package.json"

echo "Sec Policy Analyzer (Node) — environment check"
echo "  Plugin root: ${PLUGIN_ROOT}"

if [ ! -f "${PARSER}" ]; then
  echo "  ERROR: bundled parser not found at ${PARSER}"
  exit 3
fi
echo "  Bundled parser: ${PARSER}  ✓"

NODE_BIN="$(command -v node || true)"
if [ -z "${NODE_BIN}" ]; then
  echo "  ERROR: node not found on PATH."
  echo "  Install one of:"
  echo "    macOS (Homebrew):    brew install node"
  echo "    nvm:                 nvm install --lts && nvm use --lts"
  echo "    Volta:               volta install node@lts"
  echo "    Debian/Ubuntu:       sudo apt-get install -y nodejs npm"
  exit 1
fi
NODE_VERSION="$(node --version)"
echo "  node: ${NODE_BIN} ${NODE_VERSION}  ✓"

# Read deps directly from package.json (single source of truth).
if [ ! -f "${PKG_JSON}" ]; then
  echo "  ERROR: ${PKG_JSON} not found"
  exit 3
fi

DEPS="$(node -e "const p=require('${PKG_JSON}');console.log(Object.keys(p.dependencies||{}).join(' '))")"
if [ -z "${DEPS}" ]; then
  echo "  No runtime deps declared. Nothing to verify."
  echo "  Run with: node \"${PARSER}\" --help"
  exit 0
fi

MISSING=()
for DEP in ${DEPS}; do
  if ! (cd "${SCRIPTS}" && node -e "require('${DEP}')") 2>/dev/null; then
    MISSING+=("${DEP}")
  fi
done

if [ "${#MISSING[@]}" -ne 0 ]; then
  echo "  Missing node packages: ${MISSING[*]}"
  echo
  echo "Install with:"
  echo "  cd \"${SCRIPTS}\" && npm install"
  echo
  echo "(npm install reads ${PKG_JSON} as the source of truth — adding a"
  echo " new dep there is enough; this doctor will pick it up automatically.)"
  exit 2
fi

for DEP in ${DEPS}; do
  echo "  ${DEP}: import OK  ✓"
done

# Persist the verified node binary so slash commands can pick the right one.
mkdir -p "${SCRIPTS}/.state"
printf '%s\n' "${NODE_BIN}" > "${SCRIPTS}/.state/node-bin"

echo
echo "All good. Run the parser with:"
echo "  node \"${PARSER}\" --docx <path-to-docx> --test-output-dir <dir> --csv-output <path.csv> --verbose"
