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
#   default-controls           SEC_POLICY_DEFAULT_CONTROLS         (parser --controls CSV)
#   default-controls-xlsx      SEC_POLICY_DEFAULT_CONTROLS_XLSX    (map-controls --controls xlsx)
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
PARSER_V3="${SCRIPTS}/parse_policy_v3.mjs"
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

cmd_parse()    { _do_parse "$PARSER"    "$@"; }
cmd_parse_v3() { _do_parse "$PARSER_V3" "$@"; }

_do_parse() {
  local parser_path="$1"
  shift
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

  # 1) Scan args: separate --csv (a shorthand) from the rest.
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

  # 2) Resolve JSON output destination. Defaults route to <parsing-output>/policy
  #    when no explicit -o / -t given and default-output-mode isn't production.
  local extra=()
  local resolved_test_dir=""  # tracks the test-output-dir we chose, for --csv expansion
  local has_out=0
  if [ "${#cleaned[@]}" -gt 0 ]; then
    for a in "${cleaned[@]}"; do
      case "$a" in --output-dir|-o|--test-output-dir|-t) has_out=1;; esac
    done
  fi
  if [ "$has_out" -eq 0 ]; then
    local mode default_dir parsing_root
    mode="$(resolved SEC_POLICY_DEFAULT_OUTPUT_MODE default-output-mode "test")"
    if [ "$mode" = "production" ]; then
      default_dir="$(resolved SEC_POLICY_DEFAULT_OUTPUT_DIR default-output-dir "")"
      if [ -n "$default_dir" ]; then extra+=(--output-dir "$default_dir"); fi
    else
      parsing_root="$(resolved SEC_POLICY_DEFAULT_PARSING_OUTPUT_DIR parsing-output-dir "${PROJECT_DIR}/parsing-output")"
      default_dir="$(resolved SEC_POLICY_DEFAULT_TEST_OUTPUT_DIR default-test-output-dir "${parsing_root}/policy")"
      extra+=(--test-output-dir "$default_dir")
      resolved_test_dir="$default_dir"
    fi
  fi

  # 3) --csv shorthand expands relative to the resolved JSON destination so the
  #    CSV lands alongside the JSONs. Falls back to the docx dir if production
  #    mode (where JSONs go into named subdirs) or no destination was injected.
  local csv_dest_dir="${resolved_test_dir:-$docx_dir}"
  if [ "$saw_csv" -eq 1 ] && [ "$saw_csv_output" -eq 0 ]; then
    extra+=(--csv-output "${csv_dest_dir}/${docx_stem}.csv")
  elif [ "$saw_csv_output" -eq 0 ]; then
    local default_csv
    default_csv="$(resolved SEC_POLICY_DEFAULT_CSV default-csv "false")"
    if [ "$default_csv" = "true" ]; then
      extra+=(--csv-output "${csv_dest_dir}/${docx_stem}.csv")
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
  exec "$node" "$parser_path" --docx "$docx" "${injected[@]+${injected[@]}}"
}

cmd_parse_all()    { _do_parse_all parse    "$@"; }
cmd_parse_all_v3() { _do_parse_all parse-v3 "$@"; }

_do_parse_all() {
  local sub="$1"
  shift
  local target="${1:-.}"
  shift || true
  if [ ! -d "$target" ]; then
    echo "ERROR: ${sub}-all needs a directory (got: $target)" >&2
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
    if "$0" "$sub" "$docx" "$@"; then ok=$((ok+1)); else fail=$((fail+1)); fi
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

# Create the user-side parsing-output workspace and copy the bundled templates
# into it. Idempotent — existing files are left alone (templates may have been
# customized). Destination resolution: CLI arg > $SEC_POLICY_DEFAULT_PARSING_OUTPUT_DIR
# > .local.md `parsing-output-dir:` > ${CLAUDE_PROJECT_DIR}/parsing-output.
cmd_scaffold() {
  local cli_dir="${1:-}"
  local dest
  if [ -n "$cli_dir" ]; then
    dest="$cli_dir"
  else
    dest="$(resolved SEC_POLICY_DEFAULT_PARSING_OUTPUT_DIR parsing-output-dir "${PROJECT_DIR}/parsing-output")"
  fi
  echo "Scaffolding parsing workspace at: ${dest}"
  local subs=(policy controls procedures evidence-tasks templates)
  for sub in "${subs[@]}"; do
    mkdir -p "${dest}/${sub}"
    echo "  ${dest}/${sub}/  ✓"
  done

  local tpl_src="${PLUGIN_ROOT}/templates"
  local tpl_dst="${dest}/templates"
  if [ -d "$tpl_src" ]; then
    local copied=0 skipped=0
    shopt -s nullglob
    for f in "$tpl_src"/*.json; do
      local name
      name="$(basename "$f")"
      if [ -e "${tpl_dst}/${name}" ]; then
        skipped=$((skipped+1))
      else
        cp "$f" "${tpl_dst}/${name}"
        copied=$((copied+1))
      fi
    done
    echo "  templates: ${copied} copied, ${skipped} already present"
  else
    echo "  WARN: bundled templates directory not found at ${tpl_src}"
  fi
}

# v2 → v3 schema transform. All args forwarded verbatim.
cmd_transform_v3() {
  local node
  node="$(resolve_node)" || { echo "ERROR: no node binary resolved — run /sec-policy-setup" >&2; exit 1; }
  exec "$node" "${SCRIPTS}/transform_to_v3.mjs" "$@"
}

# policy → controls mapper. All args forwarded verbatim. Defaults injected when
# missing: --controls xlsx (from resolved chain), --out and --condensed-out
# (routed into <parsing-output>/controls/, derived from --policy basename).
cmd_map_controls() {
  local node
  node="$(resolve_node)" || { echo "ERROR: no node binary resolved — run /sec-policy-setup" >&2; exit 1; }
  local args=("$@")

  # Scan: presence flags + capture --policy path for output naming.
  local has_controls=0 has_out=0 has_condensed=0
  local policy_path=""
  local i=0
  for i in "${!args[@]}"; do
    case "${args[$i]}" in
      --controls)      has_controls=1 ;;
      --out)           has_out=1 ;;
      --condensed-out) has_condensed=1 ;;
      --policy)        policy_path="${args[$((i+1))]:-}" ;;
    esac
  done

  if [ "$has_controls" -eq 0 ]; then
    local v
    v="$(resolved SEC_POLICY_DEFAULT_CONTROLS_XLSX default-controls-xlsx "")"
    if [ -n "$v" ] && [ -e "$v" ]; then args+=(--controls "$v"); fi
  fi

  # Route mapping outputs into <parsing-output>/controls when caller didn't
  # pin them. Derives a sensible filename from the policy basename.
  if { [ "$has_out" -eq 0 ] || [ "$has_condensed" -eq 0 ]; } && [ -n "$policy_path" ]; then
    local parsing_root controls_dir base
    parsing_root="$(resolved SEC_POLICY_DEFAULT_PARSING_OUTPUT_DIR parsing-output-dir "${PROJECT_DIR}/parsing-output")"
    controls_dir="${parsing_root}/controls"
    base="$(basename "$policy_path")"
    base="${base%.json}"   # strip .json
    base="${base%.v3}"     # strip .v3 (so .v3.json → bare stem)
    mkdir -p "$controls_dir" 2>/dev/null || true
    if [ "$has_out" -eq 0 ]; then
      args+=(--out "${controls_dir}/${base}_mapping.json")
    fi
    if [ "$has_condensed" -eq 0 ]; then
      args+=(--condensed-out "${controls_dir}/${base}_mapping_condensed.json")
    fi
  fi

  exec "$node" "${SCRIPTS}/map_controls.mjs" "${args[@]+${args[@]}}"
}

# ---- dispatch ---------------------------------------------------------------
sub="${1:-}"
shift || true
case "$sub" in
  doctor)         cmd_doctor "$@" ;;
  parse)          cmd_parse "$@" ;;
  parse-all)      cmd_parse_all "$@" ;;
  parse-v3)       cmd_parse_v3 "$@" ;;
  parse-all-v3)   cmd_parse_all_v3 "$@" ;;
  scaffold)       cmd_scaffold "$@" ;;
  transform-v3)   cmd_transform_v3 "$@" ;;
  map-controls)   cmd_map_controls "$@" ;;
  exec)           cmd_exec "$@" ;;
  ""|-h|--help)
    cat <<EOF
sec-policy-analyzer-node — entrypoint

Subcommands:
  doctor                          Run the env doctor
  parse <docx> [parser-flags]     Parse one .docx into v2 JSON (--csv shorthand expands to sibling path)
  parse-all [<dir>] [flags]       Parse every .docx in <dir> into v2 (default: cwd)
  parse-v3 <docx> [parser-flags]  Parse one .docx directly into v3 JSON
  parse-all-v3 [<dir>] [flags]    Parse every .docx in <dir> directly into v3
  scaffold [<dir>]                Create parsing-output/{policy,controls,procedures,evidence-tasks,templates}
                                  and copy bundled templates into templates/ (idempotent)
  transform-v3 --policy-only <p>  Apply v2 → v3 transform to existing v2 output
  map-controls --policy <p> --controls <xlsx>
                                  Map policy statements to control catalog entries
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
