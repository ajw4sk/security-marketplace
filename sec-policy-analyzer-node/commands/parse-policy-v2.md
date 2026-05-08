---
description: Parse a single security/compliance policy .docx into v2 JSON (and optional CSV) via the bundled Node parser wrapper
argument-hint: <path-to-docx> [--policy-id <slug>] [--framework <tags>] [--csv] [--policy-map]
---

# /parse-policy-v2

Parse a single policy `.docx` in **test mode** — outputs land flat next to the docx, no production directories touched. Always invokes the parser via `${CLAUDE_PLUGIN_ROOT}/scripts/run.sh`, which handles node-binary resolution, env-var fallbacks, and per-project `.claude/sec-policy-analyzer-node.local.md` config in one place.

## Behavior

1. Verify the env. If `${CLAUDE_PLUGIN_ROOT}/scripts/.state/node-bin` is missing, advise the user to run `/sec-policy-setup` first and stop.

2. Resolve `$1` (the docx path). If `$1` is missing or doesn't exist, ask the user for it.

3. Forward all flags from `$@` verbatim to `run.sh`. The wrapper does the rest:
   - `--csv` (no path) expands to `--csv-output <docx-dir>/<docx-stem>.csv`.
   - If neither `--output-dir` nor `--test-output-dir` is passed, the wrapper picks based on `default-output-mode` (config-file / `SEC_POLICY_DEFAULT_OUTPUT_MODE` env var) — defaulting to test mode pointed at the docx's parent dir.
   - `--policy-id`, `--framework`, `--policy-map`, `--verbose` pass through unchanged.

4. Run the parser:

   ```bash
   bash "${CLAUDE_PLUGIN_ROOT}/scripts/run.sh" parse "$DOCX" "$@"
   ```

5. Spot-check the resulting `*_only.json`:
   - `policy-id`, `policy-id-source`, and `framework-tags` are sensible.
   - `policy.policy-requirements` opens with `<policy-id>-polcsec-1` … `<policy-id>-polcsec-7`.
   - At least one numbered section beyond `polcsec-7` is present (when applicable).
   - `assignment-selectors.by-section` has entries when the docx contains `[organization-defined …]` placeholders or curated inline patterns.

6. Report each output file path and the row count of the CSV (if `--csv` was passed).

## Resolution priority for every setting

CLI flag → `SEC_POLICY_DEFAULT_*` env var → `.claude/sec-policy-analyzer-node.local.md` frontmatter → built-in default.

`run.sh` enforces this chain in actual shell — there's no "Claude reads markdown and approximates the chain" — so behavior is reproducible across sessions, repos, and machines.

## Examples

```text
/parse-policy-v2 ./policies/nist-access-control.docx --csv
/parse-policy-v2 ./isosoc_acces_control.docx --policy-id isosoc-access-control --framework iso-27001,soc-2 --csv --policy-map
```
