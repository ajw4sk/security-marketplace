---
description: Parse every .docx policy in a directory into v2 JSON + CSV via the bundled Node parser wrapper. Defaults to the current working directory.
argument-hint: [<dir-of-docx-files>] [--csv] [--framework <tags>] [--policy-map]
---

# /parse-all-policies

Bulk-run the bundled v2 parser against every `.docx` in a target directory. Always invokes via `${CLAUDE_PLUGIN_ROOT}/scripts/run.sh`, so config-file / env / CLI flag resolution is identical to single-docx runs.

## Behavior

1. Verify the env. If `${CLAUDE_PLUGIN_ROOT}/scripts/.state/node-bin` is missing, advise the user to run `/sec-policy-setup` first and stop.

2. Resolve the target directory:
   - If `$1` is provided and is a directory, use it.
   - Otherwise default to `$PWD`.

3. Run the parse-all subcommand:

   ```bash
   bash "${CLAUDE_PLUGIN_ROOT}/scripts/run.sh" parse-all "$TARGET_DIR" "$@"
   ```

   The wrapper globs `*.docx` (skipping `~$*` Word lock files) and runs `parse` on each, applying the standard resolution chain (CLI > env > `.local.md` > built-in default) per docx.

4. Surface the wrapper's per-docx success/fail summary verbatim. Continue past failures by default; only stop early if the user explicitly requested fail-fast.

## Examples

```text
/parse-all-policies                              # parse every .docx in cwd
/parse-all-policies ./customer-policies --csv
/parse-all-policies . --csv --framework iso-27001,soc-2
```

## Notes

- Flat layout assumed: docx files in one directory, outputs alongside them. Run per-subdirectory for nested layouts.
- `controls/controls.csv` is optional — set `default-controls: ./controls/controls.csv` in `.claude/sec-policy-analyzer-node.local.md` to apply it to every parse without per-invocation flags.
