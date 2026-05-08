---
description: Verify the Sec Policy Analyzer (Node) environment, persist the verified node binary, and surface the .claude/sec-policy-analyzer-node.local.md config (if any)
---

# /sec-policy-setup

Run the plugin's environment doctor. The doctor:

1. Resolves the `node` binary using the **same priority chain** every other plugin script uses:
   1. `$SEC_POLICY_NODE`
   2. `node-bin:` in `.claude/sec-policy-analyzer-node.local.md`
   3. `${CLAUDE_PLUGIN_ROOT}/scripts/.state/node-bin` (last-known-good)
   4. `command -v node`

2. Verifies every package declared in `${CLAUDE_PLUGIN_ROOT}/scripts/package.json` resolves via `require()`. **`package.json` is the single source of truth** — adding a new dep there is enough; the doctor picks it up dynamically with no script edits.

3. On success: writes the verified node path to `${CLAUDE_PLUGIN_ROOT}/scripts/.state/node-bin` so `run.sh`, `/parse-policy-v2`, and `/parse-all-policies` lock onto the same node.

4. Reports whether a `.claude/sec-policy-analyzer-node.local.md` config file is present (does **not** modify it).

## Behavior

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/sec-policy-doctor.sh"
```

Surface the doctor's output verbatim.

If exit ≠ 0, **do not** install on the user's behalf:

| Exit | Meaning | Action |
|---|---|---|
| 1 | node not found | Repeat the printed install options, ask which path the user prefers |
| 2 | npm packages missing | Repeat `cd "${CLAUDE_PLUGIN_ROOT}/scripts" && npm install`, ask before running |
| 3 | bundled parser missing | Plugin install is broken; advise reinstalling |

If exit = 0, confirm the plugin is ready and remind the user of:
- `/parse-policy-v2 <docx> [--csv]` — single docx
- `/parse-all-policies [<dir>] [--csv]` — bulk

## Optional: per-project config

Create `${CLAUDE_PROJECT_DIR}/.claude/sec-policy-analyzer-node.local.md` to set defaults that survive across sessions. Any field can be overridden by a CLI flag or the matching `SEC_POLICY_DEFAULT_*` env var.

```markdown
---
node-bin: /usr/local/bin/node                          # SEC_POLICY_NODE
default-controls: ./controls/controls.csv              # SEC_POLICY_DEFAULT_CONTROLS
default-framework: iso-27001,soc-2                     # SEC_POLICY_DEFAULT_FRAMEWORK
default-output-mode: test                              # SEC_POLICY_DEFAULT_OUTPUT_MODE  (test|production)
default-test-output-dir: .                             # SEC_POLICY_DEFAULT_TEST_OUTPUT_DIR
default-output-dir: ./policies/.../json                # SEC_POLICY_DEFAULT_OUTPUT_DIR
default-policy-map: true                               # SEC_POLICY_DEFAULT_POLICY_MAP
---
```

Add `.claude/*.local.md` to your project's `.gitignore`.
