---
description: Verify the Sec Policy Analyzer (Node) environment and print install hints for missing node packages
---

# /sec-policy-setup

Run the plugin's environment doctor to make sure `node` is available and that the npm packages declared in `scripts/package.json` are installed inside `scripts/node_modules`.

## Behavior

1. Execute:

   ```bash
   bash "${CLAUDE_PLUGIN_ROOT}/scripts/sec-policy-doctor.sh"
   ```

2. Surface the doctor's output verbatim.

3. If the doctor exits non-zero, **do not** install anything on the user's behalf. Repeat the printed install command (`cd "${CLAUDE_PLUGIN_ROOT}/scripts" && npm install`) and ask whether to run it before proceeding.

4. If the doctor exits zero, confirm the plugin is ready and remind the user of the available commands:
   - `/parse-policy-v2 <docx> [--csv]` — parse a single docx.
   - `/parse-all-policies [<dir>] [--csv]` — parse every `.docx` in a directory.

## Notes

- `package.json` is the **single source of truth** for runtime deps. The doctor reads it dynamically; adding a dep there + running `npm install` is sufficient — no script edits needed.
- The doctor writes the verified `node` path to `${CLAUDE_PLUGIN_ROOT}/scripts/.state/node-bin`. The slash commands prefer that file when present, so they always run with the same `node` the doctor approved.
