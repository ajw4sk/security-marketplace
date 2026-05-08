# v2 Policy JSON — Schema Cheat Sheet (Node plugin)

One-page reference for the JSON produced by `scripts/parse_policy_v2.mjs`. Output is byte-for-byte identical to the Python sibling — see `policies/POLICY_PARSING_INSTRUCTIONS_V2.md` for the full spec.

## Top-level shape (`*_only.json`)

```json
{
  "schema-version": "v2",
  "policy-id": "nist-access-control-2026",
  "policy-id-source": "filename",
  "framework-tags": ["nist"],
  "policy-map": { /* present only with --policy-map */ },
  "policy-title": "...",
  "category": "...", "status": "draft|published|...",
  "frameworks": ["..."],
  "toc": ["1.0 Purpose", "..."],
  "summary": "...",
  "policy": {
    "introduction": "...",
    "purpose": "...",
    "scope": {
      "scope-statement": "...",
      "scopes": [ /* per-policy scope items, see below */ ],
      "products": [], "regions": [], "visibility": "internal"
    },
    "roles-and-responsibilities": { "applicability": "", "responsibilities": [] },
    "management-commitment": "...", "authority": "...", "compliance": "...",
    "policy-requirements": [ /* see below */ ],
    "policy-exceptions": []
  },
  "assignment-selectors": { "by-section": { /* see below */ } },
  "policy-version-history": []
}
```

## Default sections (always present, in this order)

| sect-id (suffix) | section-type |
|---|---|
| polcsec-1 | `purpose` |
| polcsec-2 | `scope` |
| polcsec-3 | `roles-and-responsibilities` |
| polcsec-4 | `management-commitment` |
| polcsec-5 | `coordination-among-organizational-entities` |
| polcsec-6 | `compliance` |
| polcsec-7 | `policy-and-procedures` |

## ID conventions

Every local id is short. Every non-top-level object also carries `reference-id` with the full ancestor chain.

| Entity | Local id | Reference-id |
|---|---|---|
| Policy (top-level) | `policy-id` | *(none)* |
| Section | `sect-id`: `polcsec-7` | `<policy-id>-polcsec-7` |
| Role | `role-id`: `polrole-1` | `<section-ref>-polrole-1` |
| Responsibility | `resp-id`: `polresp-1` | *(same row as role)* |
| Scope item | `scope-id`: `polscope-1` | `<section-ref>-polscope-1` |
| Policy statement | `policy-statement-id`: `polstmt-1` | `<parent-ref>-polstmt-1` |
| Policy substatement | `policy-substatement-id`: `polsubstmt-1` | `<statement-ref>-polsubstmt-1` |
| Policy condition | `policy-condition-id`: `polcond-1` | `<section-ref>-polcond-1` |
| Assignment selector | `selector-id`: `polasn-1` | `<host-ref>-polasn-1` |

## Per-statement fields (always present)

```json
{
  "scopes": [],
  "assets": {
    "personnel": {},
    "infrastructure": {},
    "applications": {}
  }
}
```

### Default mode — eight inline linkage fields

```json
{
  "mapped-controls": [], "evidence-tasks": [],
  "security-portal-ids": [], "privacy-portal-ids": [],
  "jira-projects": [], "jira-project-id": "",
  "jira-components": [], "related-policy-statement-ids": []
}
```

### `--policy-map` mode — one reference

```json
{ "policy-map-id": "" }
```

…and a top-level registry:

```json
"policy-map": {
  "entries": {}, "controls": {}, "evidence-tasks": {},
  "security-portal": {}, "privacy-portal": {},
  "jira-projects": {}, "jira-components": {}
}
```

## Asset entry shape (created downstream)

```json
{
  "exception": "Yes" | "No",
  "asset-owner": "",
  "asset-id": "",
  "mappings": { "<downstream-component-id>": "<mapped-item-id>" },
  "selectors": [ { "placeholder": "x1", "value": 8 } ]
}
```

## Scope item shape (`policy.scope.scopes[]` and `polcsec-2.scopes[]`)

```json
{
  "scope-id": "polscope-1",
  "reference-id": "<policy-id>-polcsec-2-polscope-1",
  "scope-item": "business processes",
  "category": "process",
  "introducer": "covers",
  "matched-text": "all business processes"
}
```

`category` ∈ `system | actor | location | process | data | third-party | null`.

## Subsequent numbered sections (sect-8+)

```json
{
  "sect-id": "polcsec-8",
  "reference-id": "<policy-id>-polcsec-8",
  "section-number": "8.0",
  "section-title": "Account Management",
  "section-type": "policy-section",
  "policy-statements": [ /* polstmt-N objects */ ],
  "policy-conditions": [
    {
      "policy-condition-id": "polcond-1",
      "reference-id": "<policy-id>-polcsec-8-polcond-1",
      "policy-condition-title": "Policy conditions for ...",
      "policy-statements": [ /* polstmt-N objects under the condition */ ]
    }
  ]
}
```

## Inline selector replacement

Within any statement / substatement / condition text:

1. Each match (bracketed `[…]` first, then curated inline patterns) is replaced inline with `[xN]` where `N` starts at 1 per host text.
2. The original phrase is preserved in `assignment-selectors.by-section[<sect-id>][]`.
3. Bracketed wins on overlap; among inline patterns, the first registered wins.

### Curated inline patterns

| Pattern | type slug |
|---|---|
| `eight (8)` / spelled-number + parenthetical | `numeric-value` (with `numeric-value: N`) |
| `a defined number` | `defined-number` |
| `a defined period of <X>` | `defined-period` |
| `periodically` | `frequency-periodic` |
| `as applicable` / `when(ever) possible` / `as appropriate` / `where appropriate` / `if necessary` | `applicability-conditional` |

## Assignment-selectors index

```json
{
  "assignment-selectors": {
    "by-section": {
      "polcsec-7": [
        {
          "selector-id": "polasn-1",
          "reference-id": "<policy-id>-polcsec-7-polstmt-1-polasn-1",
          "policy-id": "<policy-id>",
          "policy-section-id": "polcsec-7",
          "policy-statement-id": "polstmt-1",
          "policy-substatement-id": null,
          "policy-condition-id": null,
          "host-id": "polstmt-1",
          "host-reference-id": "<policy-id>-polcsec-7-polstmt-1",
          "placeholder": "[x1]",
          "selector-style": "bracketed",
          "selector-type": "organization-defined-personnel-or-roles",
          "selector": "organization-defined personnel or roles",
          "matched-text": "[organization-defined personnel or roles]"
        }
      ]
    }
  }
}
```

Index keys are local sect-ids (`polcsec-N`), not full reference-ids.

## Lead-in lines (always dropped)

`^\s*(?:symplicity|\{\{organization\.name\}\})\s+shall\s*[:,]?\s*$` (case-insensitive). Drops only whole-line "Symplicity shall" / "{{organization.name}} shall" preambles.

## `***` condition delimiters

Lines that are exactly `***` (three or more asterisks) toggle in/out of a condition block. Adjacent `***\n***` closes one condition and opens the next. Inside an open block, the first `Policy conditions for X` line becomes the condition title.

## Framework auto-detection

| Filename pattern | Tag(s) added |
|---|---|
| `nist`, `nist-800-53`, `nist-800-171`, `nist-800-172` | `nist`, `nist-800-53`, etc. |
| `iso`, `iso-27001`, `iso-27018` | `iso-27001`, `iso-27018` |
| `soc`, `soc-2` | `soc-2` |
| `pci`, `pci-dss` | `pci-dss` |
| `cmmc`, `hipaa`, `gdpr`, `ferpa`, `cyber-essentials` | matching tag |

Override or extend with `--framework iso-27001,soc-2`. Override the policy-id slug with `--policy-id <slug>`.

## CSV output

`--csv-output <path>` emits one row per statement-shaped object. Columns:

```
policy-id, framework-tags,
section-id, section-reference-id, section-number, section-title, section-type,
condition-id, condition-reference-id, condition-title,
parent-statement-id, parent-reference-id,
kind, local-id, reference-id, text,
assignment-selectors,
scopes, assets-personnel, assets-infrastructure, assets-applications,
policy-map-id,
mapped-controls, evidence-tasks, security-portal-ids, privacy-portal-ids,
jira-projects, jira-project-id, jira-components, related-policy-statement-ids
```

`local-id` is the short id (e.g. `polstmt-1`); `reference-id` is the full chain (unique row key). Multi-value cells are pipe-separated (`|`); `assignment-selectors` cells use `[xN]=phrase; [xM]=phrase`.

## CLI quick reference

```bash
# Test mode (sandbox) + CSV
node "${CLAUDE_PLUGIN_ROOT}/scripts/parse_policy_v2.mjs" \
  --docx <path>.docx \
  --controls controls/controls.csv \
  --test-output-dir <sandbox-dir> \
  --csv-output <sandbox-dir>/<name>.csv

# With explicit policy-id, framework tags, compact linkage
node "${CLAUDE_PLUGIN_ROOT}/scripts/parse_policy_v2.mjs" \
  --docx ./isosoc_acces_control.docx \
  --policy-id isosoc-access-control \
  --framework iso-27001,soc-2 \
  --policy-map \
  --test-output-dir . \
  --csv-output ./isosoc-access-control.csv

# Production mode
node "${CLAUDE_PLUGIN_ROOT}/scripts/parse_policy_v2.mjs" \
  --docx <path>.docx \
  --yaml <path>.yaml \
  --controls controls/controls.csv \
  --output-dir policies/policy-docs-do-not-touch/json
```
