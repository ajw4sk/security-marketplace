#!/usr/bin/env bash
# Sec Policy Analyzer (Node) — entrypoint wrapper used by every slash command.
#
# Resolution priority for the node binary (first match wins):
#   1. $SEC_POLICY_NODE                                — explicit env override
#   2. node-bin: in .claude/sec-policy-analyzer-node.local.md (project-scoped)
#   3. ${CLAUDE_PLUGIN_ROOT}/scripts/.state/node-bin   — doctor's last-known-good
#   4. command -v node                                 — PATH default
#
# Per-project config (optional): .claude/sec-policy-analyzer-node.local.md
# Document body: YAML frontmatter, parsed with sed/grep. Fields used by this
# wrapper are below; the parser reads more env-driven defaults itself.
#
# Usage:
#   run.sh doctor                                  # invoke the env doctor
#   run.sh parse <docx> [parser-flags ...]         # parse one docx
#   run.sh parse-all [<dir>] [parser-flags ...]    # parse every .docx in <dir>
#   run.sh exec <node-args...>                     # raw passthrough (debug)
#
# Defaults applied when CLI flag is omitted (CLI > env > config-file > built-in):
#   default-controls           SEC_POLICY_DEFAULT_CONTROLS
#   default-framework          SEC_POLICY_DEFAULT_FRAMEWORK
#   default-output-mode        SEC_POLICY_DEFAULT_OUTPUT_MODE  (test|production)
#   default-test-output-dir    SEC_POLICY_DEFAULT_TEST_OUTPUT_DIR
#   default-output-dir         SEC_POLICY_DEFAULT_OUTPUT_DIR
#   default-csv                SEC_POLICY_DEFAULT_CSV          (true|false)
#   default-policy-map         SEC_POLICY_DEFAULT_POLICY_MAP   (true|false)

set -euo pipefail

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
SCRIPTS="${PLUGIN_ROOT}/scripts"
PARSER="${SCRIPTS}/parse_policy_v2.mjs"
STATE="${SCRIPTS}/.state"
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
CONFIG_FILE="${PROJECT_DIR}/.claude/sec-policy-analyzer-node.local.md"

# ---- frontmatter parsing ----------------------------------------------------
# Read a single key from the YAML frontmatter of $CONFIG_FILE.
# Strips surrounding double-quotes; returns empty if not set.
read_cfg() {
  local key="$1"
  [ -f "$CONFIG_FILE" ] || return 0
  sed -n '/^---$/,/^---$/{ /^---$/d; p; }' "$CONFIG_FILE" 2>/dev/null \
    | grep -E "^${key}:" \
    | head -n1 \
    | sed -E "s/^${key}:[[:space:]]*//; s/^[\"'](.*)[\"']$/\1/; s/[[:space:]]*#.*$//"
}

# Apply: $1=env-var-name, $2=config-key, $3=builtin-default. Echoes resolved value.
resolved() {
  local env_name="$1" cfg_key="$2" default="${3:-}"
  local v
  v="${!env_name:-}"
  if [ -z "$v" ]; then v="$(read_cfg "$cfg_key" || true)"; fi
  if [ -z "$v" ]; then v="$default"; fi
  printf '%s' "$v"
}

# ---- node binary resolution -------------------------------------------------
resolve_node() {
  local node=""
  if [ -n "${SEC_POLICY_NODE:-}" ] && [ -x "${SEC_POLICY_NODE}" ]; then
    echo "${SEC_POLICY_NODE}"; return
  fi
  node="$(read_cfg node-bin || true)"
  if [ -n "$node" ] && [ -x "$node" ]; then echo "$node"; return; fi
  if [ -f "${STATE}/node-bin" ]; then
    node="$(cat "${STATE}/node-bin")"
    if [ -n "$node" ] && [ -x "$node" ]; then echo "$node"; return; fi
  fi
  command -v node 2>/dev/null && return
  return 1
}

# ---- subcommands ------------------------------------------------------------
cmd_doctor() {
  bash "${SCRIPTS}/sec-policy-doctor.sh" "$@"
}

# Forward CLI args verbatim, but inject defaults from config/env when the
# corresponding flag is missing. Works for parse-one and parse-all.
inject_defaults() {
  args=()
  [ "$#" -gt 0 ] && args=("$@")

  # has_any_flag <flag1> [flag2 ...] — true if any of the supplied flags are
  # present in args. Treats long and short forms as equivalent (e.g.
  # --controls and -c are the same logical setting).
  has_any_flag() {
    [ "${#args[@]}" -eq 0 ] && return 1
    local f
    for f in "$@"; do
      local a
      for a in "${args[@]}"; do
        [ "$a" = "$f" ] && return 0
      done
    done
    return 1
  }

  # --controls / -c
  if ! has_any_flag --controls -c; then
    local v
    v="$(resolved SEC_POLICY_DEFAULT_CONTROLS default-controls "")"
    if [ -n "$v" ] && [ -e "$v" ]; then
      args+=(--controls "$v")
    fi
  fi
  # --framework
  if ! has_any_flag --framework; then
    local v
    v="$(resolved SEC_POLICY_DEFAULT_FRAMEWORK default-framework "")"
    [ -n "$v" ] && args+=(--framework "$v")
  fi
  # --policy-map
  if ! has_any_flag --policy-map; then
    local v
    v="$(resolved SEC_POLICY_DEFAULT_POLICY_MAP default-policy-map "false")"
    [ "$v" = "true" ] && args+=(--policy-map)
  fi
  # NOTE: --csv-output is NOT injected here. The "default-csv" / SEC_POLICY_DEFAULT_CSV
  # setting is honored in cmd_parse, which knows the docx path needed to derive
  # the sibling .csv path; inject_defaults runs without that context.
  if [ "${#args[@]}" -gt 0 ]; then
    printf '%s\n' "${args[@]}"
  fi
}

cmd_parse() {
  local docx="${1:-}"
  shift || true
  if [ -z "$docx" ]; then
    echo "ERROR: parse needs a docx path"  >&2
    echo "usage: run.sh parse <docx> [parser-flags ...]" >&2
    exit 2
  fi
  if [ ! -f "$docx" ]; then
    echo "ERROR: docx not found: $docx" >&2
    exit 2
  fi
  local docx_dir docx_stem
  docx_dir="$(cd "$(dirname "$docx")" 2>/dev/null && pwd)" || {
    echo "ERROR: cannot resolve directory of: $docx" >&2; exit 2; }
  docx_stem="$(basename "$docx" .docx)"

  # --csv shorthand (no path) → derive sibling path. Also honors default-csv:true
  # from .local.md / SEC_POLICY_DEFAULT_CSV when the user did not pass --csv or
  # --csv-output explicitly.
  local extra=()
  local cleaned=()
  local saw_csv=0
  local saw_csv_output=0
  if [ "$#" -gt 0 ]; then
    for a in "$@"; do
      case "$a" in
        --csv)         saw_csv=1 ;;
        --csv-output)  saw_csv_output=1; cleaned+=("$a") ;;
        *)             cleaned+=("$a") ;;
      esac
    done
  fi
  if [ "$saw_csv" -eq 1 ] && [ "$saw_csv_output" -eq 0 ]; then
    extra+=(--csv-output "${docx_dir}/${docx_stem}.csv")
  elif [ "$saw_csv_output" -eq 0 ]; then
    local default_csv
    default_csv="$(resolved SEC_POLICY_DEFAULT_CSV default-csv "false")"
    if [ "$default_csv" = "true" ]; then
      extra+=(--csv-output "${docx_dir}/${docx_stem}.csv")
    fi
  fi

  # Choose output mode (only if neither long nor short output-dir flag given)
  local has_out=0
  if [ "${#cleaned[@]}" -gt 0 ]; then
    for a in "${cleaned[@]}"; do
      case "$a" in --output-dir|-o|--test-output-dir|-t) has_out=1;; esac
    done
  fi
  if [ "$has_out" -eq 0 ]; then
    local mode default_dir
    mode="$(resolved SEC_POLICY_DEFAULT_OUTPUT_MODE default-output-mode "test")"
    if [ "$mode" = "production" ]; then
      default_dir="$(resolved SEC_POLICY_DEFAULT_OUTPUT_DIR default-output-dir "")"
      if [ -n "$default_dir" ]; then extra+=(--output-dir "$default_dir"); fi
    else
      default_dir="$(resolved SEC_POLICY_DEFAULT_TEST_OUTPUT_DIR default-test-output-dir "$docx_dir")"
      extra+=(--test-output-dir "$default_dir")
    fi
  fi

  local node
  node="$(resolve_node)" || { echo "ERROR: no node binary resolved — run /sec-policy-setup" >&2; exit 1; }

  # Build the final positional list, then inject env/config-driven defaults.
  local final=()
  [ "${#cleaned[@]}" -gt 0 ] && final+=("${cleaned[@]}")
  [ "${#extra[@]}"   -gt 0 ] && final+=("${extra[@]}")
  # Portable replacement for `mapfile -t` (macOS ships bash 3.2):
  local injected=()
  local _line
  while IFS= read -r _line; do
    injected+=("$_line")
  done < <(inject_defaults "${final[@]+${final[@]}}")
  exec "$node" "$PARSER" --docx "$docx" "${injected[@]+${injected[@]}}"
}

cmd_parse_all() {
  local target="${1:-.}"
  shift || true
  if [ ! -d "$target" ]; then
    echo "ERROR: parse-all needs a directory (got: $target)" >&2
    exit 2
  fi
  local node
  node="$(resolve_node)" || { echo "ERROR: no node binary resolved — run /sec-policy-setup" >&2; exit 1; }

  local count=0 ok=0 fail=0
  shopt -s nullglob
  for docx in "$target"/*.docx; do
    case "$(basename "$docx")" in
      '~$'*) continue;;  # Word lock files
    esac
    count=$((count+1))
    echo
    echo "──── $(basename "$docx") ────"
    if "$0" parse "$docx" "$@"; then ok=$((ok+1)); else fail=$((fail+1)); fi
  done
  echo
  echo "summary: $ok ok / $fail failed / $count total"
  [ "$fail" -eq 0 ]
}

cmd_exec() {
  local node
  node="$(resolve_node)" || { echo "ERROR: no node binary resolved" >&2; exit 1; }
  exec "$node" "$@"
}

# ---- dispatch ---------------------------------------------------------------
sub="${1:-}"
shift || true
case "$sub" in
  doctor)     cmd_doctor "$@" ;;
  parse)      cmd_parse "$@" ;;
  parse-all)  cmd_parse_all "$@" ;;
  exec)       cmd_exec "$@" ;;
  ""|-h|--help)
    cat <<EOF
sec-policy-analyzer-node — entrypoint

Subcommands:
  doctor                          Run the env doctor
  parse <docx> [parser-flags]     Parse one .docx (--csv shorthand expands to sibling path)
  parse-all [<dir>] [flags]       Parse every .docx in <dir> (default: cwd)
  exec <node-args>                Raw node passthrough (debug)

Resolution chain (first match wins):
  1. CLI flags
  2. Environment variables (SEC_POLICY_*)
  3. .claude/sec-policy-analyzer-node.local.md frontmatter
  4. Built-in defaults
EOF
    ;;
  *)
    echo "unknown subcommand: $sub" >&2
    exec "$0" --help
    ;;
esac
