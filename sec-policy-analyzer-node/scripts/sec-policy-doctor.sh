#!/usr/bin/env bash
# Sec Policy Analyzer (Node) — environment doctor.
#
# Verifies the node binary + the deps declared in scripts/package.json.
# Never installs anything on the user's behalf; prints the exact command and
# exits non-zero. Writes the verified node path to scripts/.state/node-bin so
# every other script in this plugin uses the same node it just approved.
#
# Node-binary resolution priority (matches scripts/run.sh):
#   1. $SEC_POLICY_NODE                                — explicit env override
#   2. node-bin: in .claude/sec-policy-analyzer-node.local.md
#   3. ${CLAUDE_PLUGIN_ROOT}/scripts/.state/node-bin   — last-known-good
#   4. command -v node                                 — PATH default
#
# Exit codes:
#   0  — environment OK
#   1  — node missing / unusable
#   2  — required node packages missing (install hint printed)
#   3  — bundled parser missing

set -u

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
SCRIPTS="${PLUGIN_ROOT}/scripts"
PARSER="${SCRIPTS}/parse_policy_v2.mjs"
PKG_JSON="${SCRIPTS}/package.json"
STATE="${SCRIPTS}/.state"
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
CONFIG_FILE="${PROJECT_DIR}/.claude/sec-policy-analyzer-node.local.md"

echo "Sec Policy Analyzer (Node) — environment check"
echo "  Plugin root: ${PLUGIN_ROOT}"

if [ ! -f "${PARSER}" ]; then
  echo "  ERROR: bundled parser not found at ${PARSER}"
  exit 3
fi
echo "  Bundled parser: ${PARSER}  ✓"

read_cfg() {
  local key="$1"
  [ -f "$CONFIG_FILE" ] || return 0
  sed -n '/^---$/,/^---$/{ /^---$/d; p; }' "$CONFIG_FILE" 2>/dev/null \
    | grep -E "^${key}:" \
    | head -n1 \
    | sed -E "s/^${key}:[[:space:]]*//; s/^[\"'](.*)[\"']$/\1/; s/[[:space:]]*#.*$//"
}

# --- node-binary resolution ---
NODE_BIN=""
SOURCE=""
if [ -n "${SEC_POLICY_NODE:-}" ] && [ -x "${SEC_POLICY_NODE}" ]; then
  NODE_BIN="${SEC_POLICY_NODE}"; SOURCE="\$SEC_POLICY_NODE"
fi
if [ -z "$NODE_BIN" ]; then
  cfg_node="$(read_cfg node-bin || true)"
  if [ -n "$cfg_node" ] && [ -x "$cfg_node" ]; then
    NODE_BIN="$cfg_node"; SOURCE=".local.md (node-bin)"
  fi
fi
if [ -z "$NODE_BIN" ] && [ -f "${STATE}/node-bin" ]; then
  saved="$(cat "${STATE}/node-bin")"
  if [ -n "$saved" ] && [ -x "$saved" ]; then
    NODE_BIN="$saved"; SOURCE="last-known-good (.state/node-bin)"
  fi
fi
if [ -z "$NODE_BIN" ]; then
  NODE_BIN="$(command -v node 2>/dev/null || true)"
  [ -n "$NODE_BIN" ] && SOURCE="PATH"
fi

if [ -z "$NODE_BIN" ]; then
  echo "  ERROR: node not found via SEC_POLICY_NODE, .local.md, .state/node-bin, or PATH."
  echo "  Install one of:"
  echo "    macOS (Homebrew):    brew install node"
  echo "    nvm:                 nvm install --lts && nvm use --lts"
  echo "    Volta:               volta install node@lts"
  echo "    Debian/Ubuntu:       sudo apt-get install -y nodejs npm"
  echo
  echo "  Or set the path explicitly:"
  echo "    export SEC_POLICY_NODE=/path/to/node"
  echo "  …or add 'node-bin: /path/to/node' to ${CONFIG_FILE}"
  exit 1
fi

NODE_VERSION="$("$NODE_BIN" --version 2>/dev/null || true)"
if [ -z "$NODE_VERSION" ]; then
  echo "  ERROR: ${NODE_BIN} did not return a version (corrupt or wrong arch)."
  exit 1
fi
echo "  node: ${NODE_BIN} ${NODE_VERSION}  ✓  (source: ${SOURCE})"

# --- deps from package.json (single source of truth) ---
if [ ! -f "${PKG_JSON}" ]; then
  echo "  ERROR: ${PKG_JSON} not found"
  exit 3
fi

DEPS="$("$NODE_BIN" -e "const p=require('${PKG_JSON}');console.log(Object.keys(p.dependencies||{}).join(' '))")"
if [ -z "${DEPS}" ]; then
  echo "  No runtime deps declared. Nothing to verify."
  echo "  Run with: ${NODE_BIN} \"${PARSER}\" --help"
  exit 0
fi

MISSING=()
for DEP in ${DEPS}; do
  if ! (cd "${SCRIPTS}" && "$NODE_BIN" -e "require('${DEP}')") 2>/dev/null; then
    MISSING+=("${DEP}")
  fi
done

if [ "${#MISSING[@]}" -ne 0 ]; then
  echo "  Missing node packages: ${MISSING[*]}"
  echo
  echo "Install with:"
  echo "  cd \"${SCRIPTS}\" && npm install"
  echo
  echo "(npm install reads ${PKG_JSON} as the source of truth — adding a new"
  echo " dep there is enough; this doctor will pick it up automatically.)"
  exit 2
fi

for DEP in ${DEPS}; do
  echo "  ${DEP}: import OK  ✓"
done

# Persist the verified node binary so run.sh + slash commands use the same one.
mkdir -p "${STATE}"
printf '%s\n' "${NODE_BIN}" > "${STATE}/node-bin"

echo
if [ -f "$CONFIG_FILE" ]; then
  echo "  Local config: ${CONFIG_FILE}  ✓"
else
  echo "  Local config (optional): ${CONFIG_FILE}  — not present, all defaults in effect"
fi

echo
bash "${SCRIPTS}/run.sh" scaffold || echo "  WARN: scaffold step failed (non-fatal)"

cat <<EOF

All good. Run the parser via the wrapper:
  bash "${SCRIPTS}/run.sh" parse <docx> [--csv] [--policy-map] [--framework iso-27001,soc-2]
  bash "${SCRIPTS}/run.sh" parse-all <dir> [--csv]
  bash "${SCRIPTS}/run.sh" parse-v3 <docx>                  # direct v3 parse

Or invoke node directly:
  ${NODE_BIN} "${PARSER}" --docx <path-to-docx> --test-output-dir <dir> --csv-output <path.csv> --verbose
EOF
