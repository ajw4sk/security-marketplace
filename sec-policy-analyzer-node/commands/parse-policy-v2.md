---
description: Parse a single security/compliance policy .docx into v2 JSON (and optional CSV) via the bundled Node parser wrapper
argument-hint: <path-to-docx> [--policy-id <slug>] [--framework <tags>] [--csv] [--policy-map]
---

# /parse-policy-v2

Parse a single policy `.docx`. By default the wrapper writes outputs flat next to the docx (test mode), but a project-level config (`default-output-mode: production` in `.claude/sec-policy-analyzer-node.local.md`, or `SEC_POLICY_DEFAULT_OUTPUT_MODE=production`) can switch the destination to `default-output-dir`'s `policies-only/`, `associated-controls/`, `complete-associations/` subfolders. Always invokes via `${CLAUDE_PLUGIN_ROOT}/scripts/run.sh`, which handles node-binary resolution, env-var fallbacks, and the local config file in one place.

## Behavior

1. Resolve `$1` (the docx path). If `$1` is missing or the file doesn't exist, ask the user for it. (`run.sh` itself also validates this and exits cleanly if the docx is bogus.)

2. Forward all flags from `$@` verbatim to `run.sh`. The wrapper does the rest:
   - `--csv` (no path) expands to `--csv-output <docx-dir>/<docx-stem>.csv`. The same expansion happens automatically when `default-csv: true` is set in the config file or `SEC_POLICY_DEFAULT_CSV=true` is exported.
   - If neither `--output-dir`/`-o` nor `--test-output-dir`/`-t` is passed, the wrapper picks based on `default-output-mode` (default: `test`, pointed at the docx's parent dir).
   - `--policy-id`, `--framework`, `--policy-map`, `--verbose` pass through unchanged.

3. Run:

   ```bash
   bash "${CLAUDE_PLUGIN_ROOT}/scripts/run.sh" parse "$DOCX" "$@"
   ```

   `run.sh` resolves node via the priority chain (`$SEC_POLICY_NODE` → `.claude/sec-policy-analyzer-node.local.md` `node-bin:` → `${CLAUDE_PLUGIN_ROOT}/scripts/.state/node-bin` → `command -v node`). If none resolves it errors with the install hint — at which point the user should run `/sec-policy-setup`.

4. Spot-check the resulting `*_only.json`:
   - `policy-id`, `policy-id-source`, and `framework-tags` are sensible.
   - `policy.policy-requirements` opens with `<policy-id>-SECT-01` … `<policy-id>-SECT-07`.
   - At least one numbered section beyond `SECT-07` is present (when applicable).
   - `assignment-selectors.by-section` has entries when the docx contains `[organization-defined …]` placeholders or curated inline patterns.

5. Report each output file path and the row count of the CSV (if `--csv` was passed or `default-csv: true`).

## Resolution priority for every setting

CLI flag → `SEC_POLICY_DEFAULT_*` env var → `.claude/sec-policy-analyzer-node.local.md` frontmatter → built-in default.

`run.sh` enforces this chain in actual shell — there's no "Claude reads markdown and approximates the chain" — so behavior is reproducible across sessions, repos, and machines.

## Examples

```text
/parse-policy-v2 ./policies/nist-access-control.docx --csv
/parse-policy-v2 ./isosoc_acces_control.docx --policy-id isosoc-access-control --framework iso-27001,soc-2 --csv --policy-map
```
