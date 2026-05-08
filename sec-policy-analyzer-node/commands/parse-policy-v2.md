---
description: Parse a single security/compliance policy .docx into v2 JSON (and optional CSV) using the bundled Node parser
argument-hint: <path-to-docx> [--policy-id <slug>] [--framework <tags>] [--csv] [--policy-map]
---

# /parse-policy-v2

Run the bundled Node parser at `${CLAUDE_PLUGIN_ROOT}/scripts/parse_policy_v2.mjs` against a single policy `.docx` in **test mode** — outputs land flat in the same directory as the docx and no production directories are touched.

## Behavior

When invoked, follow the `policy-parsing-v2` skill:

1. Resolve the node binary in this priority order:
   1. `${CLAUDE_PLUGIN_ROOT}/scripts/.state/node-bin` (written by `/sec-policy-setup`).
   2. `$SEC_POLICY_NODE` env var.
   3. The first `node` on `$PATH`.

   If none are found, surface `/sec-policy-setup`'s install hint and stop.

2. Confirm the deps declared in `${CLAUDE_PLUGIN_ROOT}/scripts/package.json` resolve. A quick gate:

   ```bash
   "${NODE}" -e "require('adm-zip');require('fast-xml-parser')" 2>/dev/null \
     || { echo "Run /sec-policy-setup or: cd \"${CLAUDE_PLUGIN_ROOT}/scripts\" && npm install"; exit 2; }
   ```

3. Resolve `$1` (the docx path). If `$1` is missing or does not exist, ask the user for it.

4. Detect the docx's parent directory and use it as `--test-output-dir`.

5. If `--csv` is present in the args, also pass `--csv-output <parent-dir>/<docx-stem>.csv`.

6. Forward `--policy-id`, `--framework`, and `--policy-map` flags from the args verbatim.

7. If a `controls/controls.csv` exists relative to the cwd, pass `--controls controls/controls.csv`; otherwise omit the flag (the parser handles its absence cleanly).

8. Run the parser:

   ```bash
   "${NODE}" "${CLAUDE_PLUGIN_ROOT}/scripts/parse_policy_v2.mjs" \
     --docx "$DOCX" \
     [--controls controls/controls.csv] \
     --test-output-dir "$DOCX_DIR" \
     [--csv-output "$DOCX_DIR/$STEM.csv"] \
     [--policy-id "$POLICY_ID"] \
     [--framework "$FRAMEWORK"] \
     [--policy-map] \
     --verbose
   ```

9. Spot-check the resulting `*_only.json`:
   - Confirm `policy-id`, `policy-id-source`, and `framework-tags` are sensible.
   - Confirm `policy.policy-requirements` opens with `<policy-id>-polcsec-1` … `<policy-id>-polcsec-7`.
   - Confirm at least one numbered section beyond `polcsec-7` is present (when applicable).
   - Confirm `assignment-selectors.by-section` has entries when the docx contains `[organization-defined …]` placeholders or curated inline patterns (`eight (8)`, `periodically`, …).

10. Report the path to each output file and the row count of the CSV (if requested).

## Examples

```text
/parse-policy-v2 ./policies/nist-access-control.docx --csv
/parse-policy-v2 ./isosoc_acces_control.docx --policy-id isosoc-access-control --framework iso-27001,soc-2 --csv --policy-map
```
