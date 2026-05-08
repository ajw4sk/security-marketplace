---
description: Parse every .docx policy in a directory into v2 JSON + CSV using the bundled Node parser. Defaults to the current working directory.
argument-hint: [<dir-of-docx-files>] [--csv] [--framework <tags>] [--policy-map]
---

# /parse-all-policies

Bulk-run the bundled v2 parser at `${CLAUDE_PLUGIN_ROOT}/scripts/parse_policy_v2.mjs` against **every** `.docx` file in a target directory. Designed for the standalone use case where the plugin is loaded in a folder that contains only policy `.docx` files.

## Behavior

When invoked, follow the `policy-parsing-v2` skill:

1. Resolve the node binary using the same priority chain as `/parse-policy-v2`:
   1. `${CLAUDE_PLUGIN_ROOT}/scripts/.state/node-bin`
   2. `$SEC_POLICY_NODE`
   3. `command -v node`

   If none are found, surface `/sec-policy-setup` and stop.

2. Confirm deps via `node -e "require('adm-zip');require('fast-xml-parser')"`. If that fails, run `/sec-policy-setup` or stop and ask whether to run `cd "${CLAUDE_PLUGIN_ROOT}/scripts" && npm install`.

3. Resolve the target directory:
   - If `$1` is provided and is a directory, use it.
   - Otherwise default to the current working directory.

4. Glob `*.docx` files in the target directory (non-recursive). Skip filenames beginning with `~$` (Word lock files).

5. For each docx:
   - Pick a sensible `--policy-id` slug from the filename (lowercase, hyphens). Use `--policy-id` only if the user explicitly passed one to apply to all.
   - Pass `--framework "$FRAMEWORK"` if `--framework` was supplied.
   - Pass `--policy-map` if it was supplied.
   - Always pass `--test-output-dir <target-dir>` so outputs land alongside the input.
   - Pass `--csv-output <target-dir>/<stem>.csv` when `--csv` is present in args.
   - Run:

     ```bash
     "${NODE}" "${CLAUDE_PLUGIN_ROOT}/scripts/parse_policy_v2.mjs" \
       --docx "$DOCX" \
       --test-output-dir "$TARGET_DIR" \
       [--csv-output "$TARGET_DIR/$STEM.csv"] \
       [--framework "$FRAMEWORK"] \
       [--policy-map] \
       --verbose
     ```

6. After the loop, print a summary table: docx → policy-id → framework-tags → output JSON path → CSV path (if any) → success/failure.

7. If any docx failed, surface the parser's stderr verbatim and continue with the next file by default; only stop early when the user explicitly requested fail-fast.

## Examples

```text
/parse-all-policies                      # parse every .docx in cwd
/parse-all-policies ./customer-policies --csv
/parse-all-policies . --csv --framework iso-27001,soc-2
```

## Notes

- Flat layout assumed: docx files in one directory, outputs alongside them. Run per-subdirectory for nested layouts.
- `controls/controls.csv` is optional. With no controls file, `associated-controls` is empty but the v2 JSON still parses cleanly.
