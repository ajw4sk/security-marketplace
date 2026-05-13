# Sec Policy Analyzer (Node) — Quickstart

This folder is **fully self-contained**. Copy the entire `sec-policy-analyzer-node/` directory into any target location (e.g. a directory of policy `.docx` files) and load it as a Claude Code plugin.

## 1. Drop it next to your policies

```bash
cp -R /path/to/sec-policy-analyzer-node ~/my-policies/
cd ~/my-policies
ls
# nist-access-control.docx
# soc2-encryption.docx
# sec-policy-analyzer-node/
```

## 2. Load the plugin

```bash
claude --plugin-dir ./sec-policy-analyzer-node
```

Or persist it in `~/.claude/settings.json`:

```jsonc
{
  "plugins": [
    "/absolute/path/to/sec-policy-analyzer-node"
  ]
}
```

## 3. Verify the Node environment

Inside the Claude session:

```text
/sec-policy-setup
```

The plugin runs `scripts/sec-policy-doctor.sh`. It checks:
- `node` is on PATH (≥ 18 recommended).
- Every dep declared in `scripts/package.json` resolves via `require()`.

If anything is missing it prints the exact command and **does not** install anything on its own:

```bash
cd "${CLAUDE_PLUGIN_ROOT}/scripts" && npm install
```

`node_modules` lives inside the plugin's `scripts/` folder — durable and scoped. There is no `/tmp` venv to recreate.

## 4. Parse policies

Single docx:

```text
/parse-policy-v2 ./nist-access-control.docx --csv
```

All `.docx` in the cwd:

```text
/parse-all-policies . --csv
```

Outputs land **next to each input** (no production directories are touched):

- `<base>_only.json`
- `<base>_associated_controls.json`
- `<base>_complete_associations.json`
- `<base>.csv` (when `--csv` is set)

## What's inside

| Path | Purpose |
|---|---|
| `.claude-plugin/plugin.json` | Plugin manifest |
| `skills/policy-parsing-v2/SKILL.md` | Triggering skill (auto-invoked on policy-parsing requests) |
| `skills/policy-parsing-v2/references/schema-cheatsheet.md` | One-page schema cheat sheet |
| `commands/parse-policy-v2.md` | `/parse-policy-v2` slash command |
| `commands/parse-all-policies.md` | `/parse-all-policies` slash command |
| `commands/sec-policy-setup.md` | `/sec-policy-setup` slash command |
| `commands/map-policy-controls.md` | `/map-policy-controls` slash command (v0.3+) |
| `skills/policy-controls-mapping/SKILL.md` | Auto-invoked when a parsed policy + controls xlsx are both present (v0.3+) |
| `scripts/parse_policy_v2.mjs` | The bundled parser (Node ESM) |
| `scripts/transform_to_v3.mjs` | v2 → v3 schema transform (compact ref-ids + condition framework-tags) |
| `scripts/map_controls.mjs` | Policy → controls catalog crosswalk (v0.3+) |
| `scripts/run.sh` | Unified entrypoint wrapper used by every slash command |
| `scripts/package.json` | Runtime deps (`adm-zip`, `fast-xml-parser`) — single source of truth |
| `scripts/package-lock.json` | Committed lockfile |
| `scripts/sec-policy-doctor.sh` | Node env doctor |
| `README.md` | Plugin overview |

## Per-project config (optional)

Create `${CLAUDE_PROJECT_DIR}/.claude/sec-policy-analyzer-node.local.md` to persist defaults across sessions. Any field can be overridden by a CLI flag or the matching `SEC_POLICY_DEFAULT_*` env var (resolution order: CLI > env > `.local.md` > built-in).

```markdown
---
node-bin: /usr/local/bin/node                                # SEC_POLICY_NODE
default-controls: ./controls/controls.csv                    # parser --controls CSV
default-controls-xlsx: ./NIST Controls and Procedures.xlsx   # map-controls --controls xlsx
default-framework: iso-27001,soc-2
default-output-mode: test                                    # test|production
default-test-output-dir: .
default-output-dir: ./policies/.../json
default-csv: true
default-policy-map: false
---
```

After editing the file, **restart Claude Code** for the new values to be picked up by hooks. Add `.claude/*.local.md` to your project's `.gitignore`.

## Dependencies

- **node** ≥ 18 (LTS recommended)
- **adm-zip** (read .docx archives)
- **fast-xml-parser** (parse word/document.xml)

That's it. The doctor reads `package.json` dynamically — adding a third dep there is enough; nothing else needs to change.

## Compared to the Python sibling

For the same input docx, this parser produces **byte-for-byte identical** JSON to `plugins/sec-policy-analyzer/scripts/parse_policy_v2.py`. Cross-runtime regression test: parse the same fixture with both, run `diff` — empty.

The CLI surface is identical: same flags, same defaults. The only thing that changes when you migrate from the Python plugin to this one is `python3` → `node`.
