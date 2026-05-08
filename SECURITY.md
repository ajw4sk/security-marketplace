# Security Policy

## Reporting a vulnerability

If you discover a security issue in any plugin published from this marketplace, please **do not** open a public GitHub issue. Instead, report privately via:

- GitHub: open a [private security advisory](https://github.com/ajw4sk/security-marketplace/security/advisories/new) on this repo, **or**
- Email: contact the repo owner via their GitHub profile and request a private channel.

Include:

- the plugin name + version (e.g. `sec-policy-analyzer-node@0.1.0`),
- a minimal reproduction (input docx or command line, expected vs actual behaviour),
- the impact you've observed (RCE, file read/write outside CWD, exfiltration, etc.),
- any suggested fix.

You can expect an initial reply within 7 days. After triage we'll discuss disclosure timing.

## Supply-chain hardening on this repo

The following hardenings are enabled:

- Branch protection on `main`: no force-push, no deletion, linear history required, conversation resolution required, admin enforcement on.
- Secret scanning + push protection (block secrets at commit time).
- Dependabot vulnerability alerts + automated security updates.
- Issues open (so users can report bugs); wiki, projects, and discussions disabled to reduce attack surface.

## Plugin trust model

Installing a plugin from this marketplace runs **JavaScript** on your machine when you invoke its slash commands. Before trusting a release:

1. Pin to a tag (`/plugin install sec-policy-analyzer-node@security-marketplace` follows the latest commit on `main`; for stricter pinning, fetch a specific tag).
2. Run `/sec-policy-setup` first — it never installs packages on your behalf, just prints the install command and the plugin's `package.json` deps.
3. Inspect `scripts/parse_policy_v2.mjs` and `scripts/package.json` before running anything that processes sensitive policy content.

## Out-of-scope

- npm package supply-chain compromises in `adm-zip` / `fast-xml-parser` — those are upstream concerns; please report there. We will rev the plugin's `package.json` once a fix is available upstream.
- Issues only reproducible against modified plugin code.
