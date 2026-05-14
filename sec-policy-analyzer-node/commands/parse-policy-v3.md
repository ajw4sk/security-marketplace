---
description: Parse a single security/compliance policy .docx directly into v3 JSON (compact uppercase ids, framework-coded policy-id, condition framework-tags) via the bundled Node parser wrapper
argument-hint: <path-to-docx> [--policy-id <PLCY-NNN-CODE-RRR-VV[A]>] [--framework <tags>] [--csv] [--policy-map]
---

# /parse-policy-v3

Parse a single policy `.docx` directly into the v3 schema — no v2 intermediary, no separate `transform-v3` step. Output uses the compact uppercase id family (`SECT-NN`, `COND-NN`, `STMT-NN`, `SUST-NN`, `ROLE-NN`, `RESP-NN`, `SCOP-NN`, `SLCT-NN`), a framework-coded `policy-id` of shape `PLCY-NNN-<CODE>-RRR-VV[A]`, `framework-tags` on every condition, and a `legacy-reference-id` on every non-top-level object so downstream consumers that join on the v2 chain keep working.

Authoritative schema reference: `${CLAUDE_PLUGIN_ROOT}/skills/policy-parsing-v3/references/schema-cheatsheet-v3.md`.

## Behavior

1. Resolve `$1` (the docx path). If `$1` is missing or the file doesn't exist, ask the user for it. (`run.sh` itself also validates this and exits cleanly if the docx is bogus.)

2. Forward all flags from `$@` verbatim to `run.sh`. The wrapper handles node resolution and the same default-injection chain used by `/parse-policy-v2`:
   - `--csv` (no path) expands to `--csv-output <docx-dir>/<docx-stem>.csv`. Same expansion when `default-csv: true` is set in the config file or `SEC_POLICY_DEFAULT_CSV=true` is exported.
   - If neither `--output-dir`/`-o` nor `--test-output-dir`/`-t` is passed, the wrapper picks based on `default-output-mode` (default: `test`, pointed at the docx's parent dir).
   - `--policy-id`, `--framework`, `--policy-map`, `--verbose` pass through unchanged.
   - Without `--policy-id`, the parser auto-derives `PLCY-001-<CODE>-001-01` where `<CODE>` is the first framework code from `defaults/default-frameworks.json` (or `MULT500-01` when multiple frameworks are detected, `XX000` if none). Override with `--policy-id PLCY-NNN-CODE-RRR-VV[A]` for real policy ids.

3. Run:

   ```bash
   bash "${CLAUDE_PLUGIN_ROOT}/scripts/run.sh" parse-v3 "$DOCX" "$@"
   ```

   `run.sh` resolves node via the priority chain (`$SEC_POLICY_NODE` → `.claude/sec-policy-analyzer-node.local.md` `node-bin:` → `${CLAUDE_PLUGIN_ROOT}/scripts/.state/node-bin` → `command -v node`). If none resolves it errors with the install hint — at which point the user should run `/sec-policy-setup`.

4. Spot-check the resulting `*_only.v3.json`:
   - `schema-version` is `"v3"`.
   - `policy-id` matches `PLCY-NNN-<CODE>-RRR-VV[A]`; `framework-codes` lists the codes; `framework-tags` lists the tag slugs.
   - `policy.policy-requirements` opens with `<policy-id>-SECT-01` … `<policy-id>-SECT-07`.
   - At least one numbered section beyond `SECT-07` is present (when applicable).
   - Every non-top-level object has both `reference-id` (compact uppercase form) and `legacy-reference-id` (v2 `pol*` form).
   - Every `policy-condition` has a `framework-tags` array (empty + `framework-tags-inherited: true` when the title doesn't name a framework).
   - `assignment-selectors.by-section` has entries when the docx contains `[organization-defined …]` placeholders or curated inline patterns.

5. Report each output file path and the row count of the CSV (if `--csv` was passed or `default-csv: true`).

## Output files

In test mode (default), all three files land alongside the docx:

- `<base>_only.v3.json`
- `<base>_associated_controls.v3.json`
- `<base>_complete_associations.v3.json`
- `<base>.v3.csv` (when `--csv` is set)

In production mode they go into `policies-only/`, `associated-controls/`, `complete-associations/` subfolders of `default-output-dir`.

## Resolution priority for every setting

CLI flag → `SEC_POLICY_DEFAULT_*` env var → `.claude/sec-policy-analyzer-node.local.md` frontmatter → built-in default.

`run.sh` enforces this chain in actual shell — there's no "Claude reads markdown and approximates the chain" — so behavior is reproducible across sessions, repos, and machines.

## Examples

```text
/parse-policy-v3 ./policies/nist-access-control.docx --csv
/parse-policy-v3 ./isosoc_access_control.docx --policy-id PLCY-007-MULT500-01-001-01 --framework iso-27001,soc-2 --csv --policy-map
```

## When to prefer v3 over v2

- The downstream consumer (controls mapper, app ingest, Trust Portal) expects v3 ids.
- You want condition-level `framework-tags` baked in at parse time (no second pass).
- You need a stable framework-coded `policy-id` for cross-policy joins.

Use `/parse-policy-v2` when you specifically need v2 output (legacy consumers, byte-for-byte parity with the Python sibling parser). Both schemas can be produced from the same docx — run whichever command you need.
