---
name: policy-parsing-v2-node
description: This skill should be used when the user asks to "parse a policy with v2 (node)", "use the node policy parser", "run sec-policy-analyzer-node", "use parse_policy_v2.mjs", "parse a NIST policy without python", "emit a policy CSV with the node plugin", or otherwise refers to the Node-based Sec Policy Analyzer plugin. It guides parsing security/compliance policy .docx files with `parse_policy_v2.mjs` (Node + adm-zip + fast-xml-parser) into the v2 JSON schema with full-ancestor IDs, framework-aware policy-id, scopes, assets, and an assignment-selectors index. Output shape is byte-for-byte identical to the Python sibling plugin (sec-policy-analyzer).
version: 0.1.0
---

# Policy Parsing v2 — Node

## Purpose

The **Sec Policy Analyzer (Node)** plugin parses security/compliance policy Word documents (`.docx`) into the v2 JSON schema. It is the Python-free sibling of the `sec-policy-analyzer` plugin: same CLI surface, same JSON / CSV output, no Python dependency.

The parser is bundled at `${CLAUDE_PLUGIN_ROOT}/scripts/parse_policy_v2.mjs`. Runtime: Node ≥ 18 plus two npm packages (`adm-zip`, `fast-xml-parser`) installed under `scripts/node_modules` via `npm install` in the plugin's `scripts/` directory. **No Python anywhere.**

The plugin works in two modes:

1. **In-repo (Trust Portal):** the `policies/POLICY_PARSING_INSTRUCTIONS_V2.md` spec, `controls/controls.csv`, and `pipeline/test_data/parsing_v2_tests/` fixtures are available. Use the parser via the bundled `parse_policy_v2.mjs`.
2. **Standalone:** drop the plugin into any directory of policy `.docx` files and run `/parse-all-policies` to produce JSON + CSV alongside each input. No repo or controls CSV required.

In both modes, run `/sec-policy-setup` first. The doctor checks `node` and the deps declared in `scripts/package.json`. It never installs anything on the user's behalf — it prints the exact `cd "${CLAUDE_PLUGIN_ROOT}/scripts" && npm install` command and waits.

## When to Trigger

Use this skill whenever the request involves the Node-based v2 parsing pipeline, including:

- Running `parse_policy_v2.mjs` (or `/parse-policy-v2`, `/parse-all-policies`).
- Generating or inspecting v2 JSON / CSV output produced by the Node parser.
- Diagnosing v2 schema correctness — section ordering, fully-qualified `pol*` ids, statement / substatement / condition nesting, assignment-selector indexing, scopes/assets shape.
- Updating `parse_policy_v2.mjs` or `package.json` to evolve the parser.

If the request involves the Python sibling (`parse_policy_v2.py`, the `sec-policy-analyzer` plugin) prefer the `policy-parsing-v2` skill instead.

## v2 Schema at a Glance

Every document carries `policy-id` + `framework-tags` at the top, every non-top-level object has both a local `*-id` and a `reference-id` (full ancestor chain). Per the schema cheatsheet, parser-generated id prefixes use the compact uppercase family: `SECT-NN` (section), `STMT-NN` (statement), `SUST-NN` (substatement), `COND-NN` (condition), `ROLE-NN` / `RESP-NN` (role / responsibility), `SCOP-NN` (scope), `SLCT-N` (assignment selector).

| sect-id (suffix) | section-type |
|---|---|
| SECT-01 | `purpose` |
| SECT-02 | `scope` |
| SECT-03 | `roles-and-responsibilities` |
| SECT-04 | `management-commitment` |
| SECT-05 | `coordination-among-organizational-entities` |
| SECT-06 | `compliance` |
| SECT-07 | `policy-and-procedures` |

Sections beyond 7 (`SECT-08`+) carry `policy-statements` and optional `policy-conditions`. Conditions are detected from `***`-delimited blocks (the title line `Policy conditions for X` becomes the condition title) and from legacy unwrapped `Policy conditions for X` lines.

### Per-Statement Fields (always present)

```json
{
  "scopes": [],
  "assets": { "personnel": {}, "infrastructure": {}, "applications": {} }
}
```

Plus either the eight inline linkage fields (default) or a single `policy-map-id` (with `--policy-map`).

### Inline Selector Coverage

Bracketed selectors first (`[organization-defined …]`), then the curated inline patterns: `eight (8)` / spelled-number-with-numeric, `a defined number`, `a defined period`, `periodically`, `as applicable`, `whenever possible`, `where appropriate`, `if necessary`. Each captured occurrence becomes a `[xN]` placeholder and an entry in `assignment-selectors.by-section[<sect-id>]`.

## How to Use the Parser

### Test mode (recommended for iteration)

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/parse_policy_v2.mjs" \
  --docx ./nist-access-control-2026.docx \
  --test-output-dir . \
  --csv-output ./nist-access-control-2026.csv \
  --verbose
```

### CLI flags

| Flag | Purpose |
|---|---|
| `--docx` | Required. Path to source `.docx`. |
| `--yaml` | Optional metadata YAML. |
| `--controls` | Optional. Path to controls CSV for control mapping. |
| `--output-dir` | Production output (writes into `policies-only/`, etc. subfolders). |
| `--test-output-dir` | Sandbox flat output. |
| `--csv-output` | Also emit a flat CSV at this path. |
| `--policy-id` | Override the auto-derived policy-id slug. |
| `--framework` | Comma-separated extra framework tag(s) (`iso-27001,soc-2`). |
| `--policy-map` | Compact mode: emit top-level `policy-map` + replace 8 inline linkage fields with `policy-map-id`. |
| `--verbose` | Print per-section parse summary. |

### Production mode

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/parse_policy_v2.mjs" \
  --docx policies/add-policy-changes-here/<name>.docx \
  --yaml policies/add-policy-changes-here/<name>.yaml \
  --controls controls/controls.csv \
  --output-dir policies/policy-docs-do-not-touch/json \
  --verbose
```

### Required Node environment

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/sec-policy-doctor.sh"
# or:
/sec-policy-setup
```

The doctor checks `node` is on PATH and that every dep declared in `scripts/package.json` resolves via `require()`. If anything is missing it prints:

```bash
cd "${CLAUDE_PLUGIN_ROOT}/scripts" && npm install
```

Run that once. `node_modules` lives **inside the plugin** (durable, scoped, no PATH gymnastics) — there is no equivalent of the Python sibling's PEP-668 venv hassle.

## Workflow (standalone directory)

When the plugin is loaded in a folder of `.docx` files (no Trust Portal repo around):

1. Run `/sec-policy-setup`. If the doctor reports missing packages, surface `cd "${CLAUDE_PLUGIN_ROOT}/scripts" && npm install` and wait for confirmation.
2. Once green, run `/parse-all-policies [<dir>] [--csv]` (defaulting to the cwd). The plugin globs the directory for `.docx` files (skipping `~$*` Word lock files) and emits alongside each one:
   - `<base>_only.json`
   - `<base>_associated_controls.json` (empty `associated-controls` array when no controls CSV is available)
   - `<base>_complete_associations.json`
   - `<base>.csv` (when `--csv` is set)
3. Print a summary table mapping docx → policy-id → framework-tags → output paths → success/failure.
4. The user can then bulk-edit the linkage fields (mapped-controls, evidence-tasks, jira-* etc.) in the CSV files.

## Workflow (in-repo / Trust Portal)

Same as the Python sibling. Default to a folder under `pipeline/test_data/parsing_v2_tests/<topic>/` for sandbox iteration, then graduate to `--output-dir` once the test mode output looks correct.

## Validating the Output

- `policy-id` present at top level; every section / statement / substatement / condition / selector `reference-id` begins with this prefix.
- Sections `SECT-01` through `SECT-07` always present, in that order.
- ID nesting: child reference-ids contain their parent reference-ids end-to-end.
- Selector placeholders: every `[xN]` in a statement has a corresponding `assignment-selectors.by-section[<sect-id>]` entry whose `host-reference-id` matches the row.
- Linkage fields: every statement-shaped object exposes the eight fields with empty defaults, OR (under `--policy-map`) a single `policy-map-id`.
- Lead-in scrubbing: no statement body is exactly "Symplicity shall:" or "{{organization.name}} shall:".
- `***` lines never leak into statement bodies.

## Comparing to the Python sibling

For the same input docx, this parser produces **byte-for-byte identical** JSON to the Python parser. The only differences are runtime metadata (file timestamps) and the `node_modules` install location.

## Additional Resources

- **`references/schema-cheatsheet.md`** — One-page cheat sheet (IDs, scopes, assets, selector index, CSV columns).
- **`policies/POLICY_PARSING_INSTRUCTIONS_V2.md`** (in repo root) — Full v2 spec.
- **`scripts/parse_policy_v2.mjs`** — The parser itself.
