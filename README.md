# Security Marketplace

A Claude Code plugin marketplace for security/compliance tooling. Currently ships a single plugin: **Sec Policy Analyzer (Node)** — a parser that turns security/compliance policy `.docx` files (NIST 800-53, ISO 27001, SOC 2, PCI DSS, …) into a structured v2 JSON schema with full-ancestor IDs, framework-aware `policy-id`, per-statement scopes & assets, an assignment-selectors index, and an optional flat CSV. No Python required — Node ≥ 18 + two tiny npm packages (`adm-zip`, `fast-xml-parser`).

## Install in Claude Code

```text
/plugin marketplace add https://github.com/ajw4sk/security-marketplace
/plugin install sec-policy-analyzer-node@security-marketplace
/sec-policy-setup
```

`/sec-policy-setup` runs the bundled environment doctor. It checks `node` and the npm packages declared in the plugin's `scripts/package.json`. If anything is missing it prints exactly:

```bash
cd "${CLAUDE_PLUGIN_ROOT}/scripts" && npm install
```

The doctor never installs anything on your behalf — run that command yourself and re-run the setup.

Once green:

```text
/parse-policy-v2 ./some-policy.docx --csv
/parse-all-policies . --csv
```

Outputs land alongside each input docx (`*_only.json`, `*_associated_controls.json`, `*_complete_associations.json`, optional `*.csv`).

## What this marketplace ships

| Plugin | Source | Description |
|---|---|---|
| `sec-policy-analyzer-node` | [`./sec-policy-analyzer-node`](./sec-policy-analyzer-node) | Node parser for policy `.docx` files. Produces v2 JSON with `pol*`-family IDs (`polcsec`, `polstmt`, `polsubstmt`, `polcond`, `polasn`, `polrole`, `polresp`, `polscope`), per-statement `scopes[]` and `assets{personnel,infrastructure,applications}`, top-level `assignment-selectors.by-section` index, optional `--policy-map` compact-linkage mode, and CSV output. |

## Repository security

- **Branch protection on `main`** — no force-push, no deletion, linear history required, conversation resolution required, admin enforcement on.
- **Secret scanning + push protection** — secrets blocked at commit time.
- **Dependabot vulnerability alerts** + automated security updates enabled.
- **Wiki, projects, and discussions disabled** — issues remain open for bug reports.
- **MIT licensed** — see [LICENSE](./LICENSE).
- **Vulnerability reports** — please use the [private security advisory flow](https://github.com/ajw4sk/security-marketplace/security/advisories/new) rather than public issues. See [SECURITY.md](./SECURITY.md).

## Layout

```
security-marketplace/
├── .claude-plugin/
│   └── marketplace.json          # registers sec-policy-analyzer-node
├── sec-policy-analyzer-node/     # the plugin (self-contained)
│   ├── .claude-plugin/plugin.json
│   ├── README.md, QUICKSTART.md
│   ├── skills/policy-parsing-v2/
│   ├── commands/{parse-policy-v2,parse-all-policies,sec-policy-setup}.md
│   └── scripts/{parse_policy_v2.mjs, package.json, package-lock.json, sec-policy-doctor.sh}
├── LICENSE                       # MIT
├── SECURITY.md
├── README.md                     # this file
└── .gitignore
```

## Contributing

Pull requests welcome. To stay aligned with branch protection, every change to `main` goes through a PR even from the owner — open a PR, let CI green, then merge. See [SECURITY.md](./SECURITY.md) for vulnerability reporting.
