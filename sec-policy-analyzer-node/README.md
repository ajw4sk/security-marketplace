# Sec Policy Analyzer (Node) — Claude Code plugin

A Claude Code plugin that parses security/compliance policy `.docx` files into the v2 JSON schema. **Same CLI surface, same JSON / CSV output as the Python sibling — no Python required.** Runtime is Node ≥ 18 plus two tiny npm packages (`adm-zip`, `fast-xml-parser`).

The Python sibling is at `plugins/sec-policy-analyzer/`. This plugin produces byte-for-byte identical JSON for the same input docx; the only differences are runtime metadata and the `node_modules` install location.

## Why a Node version

The Python plugin's install flow has three frictions documented in `sec-policy-plugin-test/INSTALL_NOTES.md`:

| # | Friction | How this plugin avoids it |
|---|---|---|
| a | Slash commands hardcode `python3`, ignoring the venv the doctor recommends → `ModuleNotFoundError` | Slash commands resolve `node` from `${CLAUDE_PLUGIN_ROOT}/scripts/.state/node-bin` (written by the doctor) → `$SEC_POLICY_NODE` → first `node` on `$PATH`. No PATH gymnastics. |
| b | `requirements.txt` is documentation-only — doctor hardcodes package names | `package.json` is the single source of truth. The doctor reads `dependencies` dynamically and verifies each via `require()`. |
| c | Suggests `/tmp/sec-policy-venv` which is volatile on macOS | `node_modules` lives at `${CLAUDE_PLUGIN_ROOT}/scripts/node_modules` — durable, scoped to the plugin, no clean-up needed. |

## Layout

```
plugins/sec-policy-analyzer-node/
├── .claude-plugin/
│   └── plugin.json
├── skills/
│   └── policy-parsing-v2/
│       ├── SKILL.md
│       └── references/
│           └── schema-cheatsheet.md
├── commands/
│   ├── parse-policy-v2.md       # /parse-policy-v2 <docx>
│   ├── parse-all-policies.md    # /parse-all-policies [<dir>]
│   └── sec-policy-setup.md      # /sec-policy-setup
├── scripts/
│   ├── parse_policy_v2.mjs      # the parser (Node ESM)
│   ├── package.json             # adm-zip + fast-xml-parser
│   ├── package-lock.json        # committed lockfile
│   └── sec-policy-doctor.sh     # node env doctor
└── README.md
```

## Install

### Local plugin dir

```bash
claude --plugin-dir /path/to/plugins/sec-policy-analyzer-node
```

### Persisted in user settings

```jsonc
{
  "plugins": [
    "/absolute/path/to/your/plugins/sec-policy-analyzer-node"
  ]
}
```

### One-time dependency install

After installing the plugin, run:

```text
/sec-policy-setup
```

If anything is missing the doctor prints the exact command to run (typically `cd "${CLAUDE_PLUGIN_ROOT}/scripts" && npm install`). It never installs on your behalf.

## Commands

| Command | Purpose |
|---|---|
| `/sec-policy-setup` | Run the env doctor, surface install hints. |
| `/parse-policy-v2 <docx> [flags]` | Parse a single docx. Outputs land alongside the input. |
| `/parse-all-policies [<dir>] [--csv]` | Parse every `.docx` in a directory (defaults to cwd). |

Common flags: `--csv`, `--policy-id <slug>`, `--framework iso-27001,soc-2`, `--policy-map`.

## See also

- `policies/POLICY_PARSING_INSTRUCTIONS_V2.md` (in-repo) — full v2 spec
- `skills/policy-parsing-v2/references/schema-cheatsheet.md` — one-page schema cheat sheet
- `scripts/parse_policy_v2.mjs` — the parser
