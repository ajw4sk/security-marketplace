# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository purpose

A Claude Code **plugin marketplace** for security/compliance tooling. Registered in `.claude-plugin/marketplace.json`. Currently ships exactly one plugin: `sec-policy-analyzer-node/` — a Node-based parser that turns policy `.docx` files (NIST 800-53, ISO 27001, SOC 2, PCI DSS, …) into a structured v2 JSON schema (+ optional flat CSV).

There is a Python sibling plugin (`sec-policy-analyzer`) maintained in a different repo. This Node plugin is intentionally a **byte-for-byte JSON-output equivalent** of the Python one — when changing the parser, preserve that property.

## Common commands

All commands below assume cwd = the plugin's `scripts/` directory (`sec-policy-analyzer-node/scripts/`).

```bash
# One-time dependency install (only adm-zip + fast-xml-parser)
cd sec-policy-analyzer-node/scripts && npm install

# Environment doctor — verifies node + deps, persists last-known-good node path
# to scripts/.state/node-bin. Never installs anything on the user's behalf.
bash sec-policy-analyzer-node/scripts/sec-policy-doctor.sh
# or: npm run doctor

# Parse a single docx via the wrapper (handles node resolution + config chain)
bash sec-policy-analyzer-node/scripts/run.sh parse <docx> [--csv] [--policy-map] [--framework iso-27001,soc-2]

# Parse every .docx in a directory
bash sec-policy-analyzer-node/scripts/run.sh parse-all <dir> [--csv]

# Map a parsed policy JSON against a controls catalog (e.g. NIST 800-53 xlsx)
bash sec-policy-analyzer-node/scripts/run.sh map-controls <policy.json> --controls <catalog.xlsx>

# Direct parser invocation (debug / no wrapper defaults)
node sec-policy-analyzer-node/scripts/parse_policy_v2.mjs --docx <path> --test-output-dir <dir> --csv-output <path.csv> --verbose
```

From inside Claude Code, the equivalents are the slash commands `/sec-policy-setup`, `/parse-policy-v2`, `/parse-all-policies`, `/map-policy-controls`.

There is **no test suite, lint config, or CI** in this repo — cross-runtime regression is checked manually by diffing this parser's JSON output against the Python sibling on the same fixture.

## Architecture: the four layers

Understanding how a slash command invocation actually runs the parser requires reading across `commands/`, `scripts/run.sh`, `scripts/sec-policy-doctor.sh`, and `scripts/parse_policy_v2.mjs`. The big picture:

1. **Slash command** (`commands/*.md`) — thin shim. Always shells out to `${CLAUDE_PLUGIN_ROOT}/scripts/run.sh`. Do **not** add logic here; the wrapper is the single place that owns resolution.
2. **`run.sh` wrapper** — owns:
   - **Node-binary resolution** (priority chain, first match wins): `$SEC_POLICY_NODE` → `node-bin:` in `${CLAUDE_PROJECT_DIR}/.claude/sec-policy-analyzer-node.local.md` → `${CLAUDE_PLUGIN_ROOT}/scripts/.state/node-bin` (written by the doctor) → `command -v node`.
   - **Default-flag injection** (same chain semantics for *every* setting): CLI flag → `SEC_POLICY_DEFAULT_*` env var → `.local.md` frontmatter → built-in default. Settings include `default-controls`, `default-framework`, `default-output-mode` (`test`|`production`), `default-test-output-dir`, `default-output-dir`, `default-csv`, `default-policy-map`.
   - **`--csv` shorthand** expands to `--csv-output <docx-dir>/<docx-stem>.csv` (the wrapper, not the parser, knows the docx path).
3. **`sec-policy-doctor.sh`** — same node-resolution chain as `run.sh`. Reads `scripts/package.json` `dependencies` as the **single source of truth** for runtime deps and verifies each with `require()`. On success, writes the verified node path to `scripts/.state/node-bin` so subsequent invocations lock onto the same binary. Exit codes: `0` ok, `1` node missing, `2` packages missing, `3` parser file missing.
4. **`parse_policy_v2.mjs`** — the parser. ESM, Node ≥ 18, deps = `adm-zip` (read docx archives) + `fast-xml-parser` (parse `word/document.xml`). Emits three JSON files (`<base>_only.json`, `<base>_associated_controls.json`, `<base>_complete_associations.json`) and an optional flat CSV. The schema uses the `pol*` id family (`polcsec`, `polstmt`, `polsubstmt`, `polcond`, `polasn`, `polrole`, `polresp`, `polscope`) with full-ancestor `reference-id` on every non-top-level object, plus per-statement `scopes[]` and `assets{personnel,infrastructure,applications}`, and a top-level `assignment-selectors.by-section` index.

### Sibling scripts (additive, same wrapper)

- **`transform_to_v3.mjs`** — additive v2 → v3 transform. Produces compact `s/c/r/role/sc/x` reference-ids, adds `framework-tags` on conditions, preserves the original v2 `reference-id` as `legacy-reference-id`. Does not replace v2 output; consumes a v2 JSON and emits the v3 shape.
- **`map_controls.mjs`** — maps a parsed policy JSON against an external controls catalog (e.g. a NIST 800-53 xlsx). Driven by `/map-policy-controls` through the same `run.sh` resolution chain — add new mapper settings via the same CLI > env > `.local.md` > built-in pattern, not by reaching into the mapper directly.

### Out-of-band assets the parser/mapper read

- `defaults/` — coded registries (`default-frameworks.json`, `default-categories.json`, `default-assets.json`) used to anchor v3 transforms and the mapper. Edit these for new framework/category/asset entries rather than hardcoding them in script.
- `templates/` — JSON scaffolds for v3-shaped objects (policy, control, procedure, framework, category, evidence-task, the four asset shapes). These are the canonical shape contracts — when adding a new field in the parser/transformer, update the matching template.
- `skills/` — three skills bundled with the plugin: `policy-parsing-v2/`, `policy-parsing-v3/`, `policy-controls-mapping/`. Each has its own `SKILL.md` and (for v2/v3) a `references/schema-cheatsheet*.md` documenting the on-disk schema. Treat the cheatsheets as the human-readable schema spec; update them in lockstep with parser changes.

## Invariants to preserve when editing

- **`package.json` is the single source of truth for runtime deps.** The doctor reads it dynamically; never hardcode dep names in shell.
- **The doctor never installs anything.** It prints the exact `cd "${CLAUDE_PLUGIN_ROOT}/scripts" && npm install` and exits non-zero. Don't add silent-install logic.
- **All slash commands route through `run.sh`.** Don't bypass the wrapper, don't duplicate the resolution chain elsewhere — it exists so behavior is reproducible across sessions, repos, and machines.
- **Resolution chain order is load-bearing**: CLI > env > `.local.md` > built-in. Any new setting should follow the same pattern (`resolved()` in `run.sh`, `read_cfg()` for the frontmatter).
- **JSON output parity with the Python sibling** is the regression contract. Changing parser behavior — section detection, lead-in scrubbing, selector extraction, id generation — must be matched in the Python parser (`parse_policy_v2.py`) or it breaks the cross-runtime diff test documented in `sec-policy-analyzer-node/QUICKSTART.md`.

## Repository workflow

Branch protection is on for `main` (no force-push, linear history required, conversation resolution required, admin enforcement). Every change — including the owner's — goes through a PR. Don't push directly to `main`.

The marketplace manifest (`.claude-plugin/marketplace.json`) and the plugin manifest (`sec-policy-analyzer-node/.claude-plugin/plugin.json`) carry independent `version` fields; bump both when shipping a release.
