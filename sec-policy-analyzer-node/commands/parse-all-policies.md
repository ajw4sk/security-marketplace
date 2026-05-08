---
description: Parse every .docx policy in a directory into v2 JSON + CSV via the bundled Node parser wrapper. Defaults to the current working directory.
argument-hint: [<dir-of-docx-files>] [--csv] [--framework <tags>] [--policy-map]
---

# /parse-all-policies

Bulk-run the bundled v2 parser against every `.docx` in a target directory. Always invokes via `${CLAUDE_PLUGIN_ROOT}/scripts/run.sh`, so config-file / env / CLI flag resolution is identical to single-docx runs.

## Behavior

1. Resolve the target directory:
   - If `$1` is provided and is a directory, use it.
   - Otherwise default to `$PWD`.

2. Run the parse-all subcommand:

   ```bash
   bash "${CLAUDE_PLUGIN_ROOT}/scripts/run.sh" parse-all "$TARGET_DIR" "$@"
   ```

   The wrapper globs `*.docx` (skipping `~$*` Word lock files) and runs `parse` on each, applying the standard resolution chain (CLI > env > `.local.md` > built-in default) per docx. If `node` cannot be resolved, the wrapper errors with the install hint — at which point run `/sec-policy-setup`.

3. Surface the wrapper's per-docx success/fail summary verbatim. The wrapper continues through every docx regardless of individual failures and reports the final tally (`N ok / M failed / T total`); a non-zero exit signals at least one failure.

## Examples

```text
/parse-all-policies                              # parse every .docx in cwd
/parse-all-policies ./customer-policies --csv
/parse-all-policies . --csv --framework iso-27001,soc-2
```

## Notes

- Flat layout assumed: docx files in one directory, outputs alongside them. Run per-subdirectory for nested layouts.
- `controls/controls.csv` is optional — set `default-controls: ./controls/controls.csv` in `.claude/sec-policy-analyzer-node.local.md` to apply it to every parse without per-invocation flags.
