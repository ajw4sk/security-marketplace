# v2 Policy JSON — Schema Cheat Sheet (Node plugin)

One-page reference for the JSON produced by `scripts/parse_policy_v2.mjs`. Output is byte-for-byte identical to the Python sibling — see `policies/POLICY_PARSING_INSTRUCTIONS_V2.md` for the full spec.

> **Migration note.** `parse_policy_v2.mjs` currently still emits the legacy `pol*` id family (`polcsec-1`, `polstmt-1`, `polcond-1`, `polsubstmt-1`, `polrole-1`, `polresp-1`, `polscope-1`, `polasn-1`). The id family shown throughout this cheatsheet (`SECT-NN`, `COND-NN`, `STMT-NN`, …) is the *target* shape: what the v2 parser will emit once aligned with v3, and what `parse_policy_v3.mjs` emits today. Until v2 parser migration lands, every `pol*` substring in actual v2 output maps 1:1 to its compact sibling shown here (`polcsec-7` ↔ `SECT-07`, `polstmt-1` ↔ `STMT-01`, etc.).

For the v3 schema directly, see `../../policy-parsing-v3/references/schema-cheatsheet-v3.md`.

## Top-level shape (`*_only.json`)

```json
{
  "schema-version": "v2",
  "policy-id": "PLCY-001-NI100-001-01",
  "policy-id-source": "filename",
  "framework-tags": ["nist-800-53"],
  "framework-codes": ["NI100"],
  "frameworks": ["NIST 800-53 Rev 5"],
  "category": "access-control",
  "category-code": "AC",
  "policy-tags": [],
  "status": "draft",                 /* enum: draft | review | published | approved | deprecated */
  "policy-map": { /* present only with --policy-map */ },
  "policy-title": "...",
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

## Default sections (always present, start with a number, typically two formats, NIST format and other formats)

| sect-id (suffix) | section-type |
|---|---|
| SECT-01 | `purpose` |
| SECT-02 | `scope` |
| SECT-03 | `roles-and-responsibilities` |
| SECT-04 | `management-commitment` |
| SECT-05 | `coordination-among-organizational-entities` |
| SECT-06 | `compliance` |
| SECT-07 | `policy-and-procedures` |

## ID conventions

Every local id is short. Every non-top-level object also carries `reference-id` with the full ancestor chain.

| Entity | Local id | Reference-id |
|---|---|---|
| Policy (top-level) | `PLCY-01` | *(none)* |
| Section | `sect-id`: `SECT-07` | `<policy-id>-SECT-07` |
| Role | `role-id`: `ROLE-01` | `<section-ref>-ROLE-01` |
| Responsibility | `RESP-id`: `RESP-01` | *(same row as role)* |
| Scope item | `scope-id`: `SCOP-1` | `<section-ref>-SCOP-01` |
| Policy statement | `policy-statement-id`: `STMT-01` | `<parent-ref>-STMT-01` |
| Policy substatement | `policy-substatement-id`: `SUST-01` | `<statement-ref>-SUST-01` |
| Policy condition | `policy-condition-id`: `COND-01` | `<section-ref>-COND-01` |
| Assignment selector | `selector-id`: `SLCT1` | `<host-ref>-SLCT1` |

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

The parser emits `assets: { personnel: {}, infrastructure: {}, applications: {} }` (always empty objects) on every statement-shaped object. Downstream tooling populates them by adding entries keyed by `asset-id`. Per-asset entry shape:

```jsonc
{
  "asset-id": "ASSET-…",
  "exception": "Yes",                // "Yes" | "No"
  "asset-owner": "",
  "mappings": {
    "<downstream-component-id>": "<mapped-item-id>"
  },
  "selectors": [
    { "selector-id": "SLCT-01", "value": 8 }
  ],
  "assignments": []                  // free-form, set by downstream
}
```

## Scope item shape (`policy.scope.scopes[]` and `policy.sections.scopes[]`)

```json
{
  "scope-id": "SCOP-01",
  "reference-id": "<policy-id>-SECT-01-SCOP-01",
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
  "sect-id": "SECT-08",
  "reference-id": "<policy-id>-SECT-08",
  "section-number": "8.0",
  "section-title": "Account Management",
  "section-type": "policy-section",
  "policy-statements": [ /* STMT-N objects */ ],
  "policy-conditions": [
    {
      "policy-condition-id": "COND-01",
      "reference-id": "<policy-id>-SECT-08-COND-01",
      "policy-condition-title": "Policy conditions for ...",
      "policy-statements": [ /* STMT-NN objects under the condition */ ]
    }
  ]
}
```

## Inline selector replacement

Within any statement / substatement / condition text, the parser replaces each detected selector phrase with a sequential placeholder `[xN]` (1-indexed per host object). The original phrase is recorded as a selector entry in `assignment-selectors.by-section`.

Detection priority (lower number wins on overlap):

| Priority | Style | Pattern | Example |
|---|---|---|---|
| 0 | bracketed | `[…]` anywhere in the text | `[organization-defined frequency]` |
| 1 | inline | spelled number with numeric (`one (1)`, `eight (8)`, …) | `eight (8)` |
| 2 | inline | `a defined number` / `the defined number` | `a defined number` |
| 3 | inline | `a defined period` / `the defined period of <unit>` | `a defined period of days` |
| 4 | inline | `periodically` | `periodically` |
| 5 | inline | `as applicable` | `as applicable` |
| 6 | inline | `when(ever) possible` | `whenever possible` |
| 7 | inline | `where appropriate` / `as appropriate` | `where appropriate` |
| 8 | inline | `if necessary` | `if necessary` |

Overlapping matches are resolved by lowest priority wins; ties break left-to-right. Bracketed selectors are always preferred over inline patterns covering the same span.

### Selector record shape

```jsonc
{
  "selector-id": "SLCT-01",
  "reference-id": "<host-reference-id>-SLCT-01",
  "legacy-reference-id": "<host-legacy-reference-id>-polasn-1",
  "policy-id": "<policy-id>",
  "policy-section-id": "SECT-NN",
  "policy-statement-id": "STMT-NN",
  "policy-substatement-id": "SUST-NN",   // null when the host is a statement
  "policy-condition-id": "COND-NN",      // null when not inside a condition
  "host-id": "STMT-NN",                  // statement or substatement local id
  "host-reference-id": "<full chain ending at host>",
  "placeholder": "[x1]",
  "selector-style": "bracketed",         // or "inline"
  "selector-type": "organization-defined-frequency", // slugified phrase for bracketed; spec key for inline
  "selector": "organization-defined frequency",      // bracketed: literal phrase; inline: the spec's name
  "matched-text": "[organization-defined frequency]",
  "numeric-value": 8                     // only on inline numeric-value entries
}
```

## Assignment-selectors index

Top-level `assignment-selectors.by-section` groups every selector record by the local `sect-id` of its enclosing section. Sections with no selectors are omitted.

```jsonc
{
  "assignment-selectors": {
    "by-section": {
      "SECT-08": [
        {
          "selector-id": "SLCT-01",
          "reference-id": "<policy-id>-SECT-08-STMT-01-SLCT-01",
          "placeholder": "[x1]",
          "host-reference-id": "<policy-id>-SECT-08-STMT-01",
          "selector-style": "bracketed",
          "selector-type": "organization-defined-frequency",
          "selector": "organization-defined frequency"
          /* …rest of the record per the shape above */
        }
      ]
    }
  }
}
```

Index keys are local sect-ids (`SECT-NN`), not full reference-ids.

## Lead-in lines (always dropped)

`^\s*(?:symplicity|\{\{organization\.name\}\})\s+shall\s*[:,]?\s*$` (case-insensitive). Drops only whole-line "Symplicity shall" / "{{organization.name}} shall" preambles.

## `***` condition delimiters

Lines that are exactly `***` (three or more asterisks) toggle in/out of a condition block. Adjacent `***\n***` closes one condition and opens the next. Inside an open block, the first `Policy conditions for X` line becomes the condition title.

## Framework codes (source of truth)

Every framework has a **code** (used inside `policy-id`) and a **tag** (slug, used in `framework-tags`). Both land on the policy:

```json
"framework-tags":  ["nist-800-53"],
"framework-codes": ["NI100"]
```

| Framework | Code | Tag |
|---|---|---|
| NIST 800-53 | `NI100` | `nist-800-53` |
| TX-RAMP | `NI102` | `tx-ramp` |
| NIST 800-171 | `NI105` | `nist-800-171` |
| NIST 800-172 | `NI106` | `nist-800-172` |
| NIST CSF | `NI107` | `nist-csf` |
| NIST CSF 2.0 | `NI108` | `nist-csf-2` |
| NIST AI RMF | `NI110` | `nist-ai-rmf` |
| SOC 2 Type 2 | `SO115` | `soc-2` |
| ISO 27001 | `IS120` | `iso-27001` |
| ISO 42001 | `IS121` | `iso-42001` |
| CSA STAR | `CS130` | `csa-star` |
| Cyber Essentials | `CY140` | `cyber-essentials` |
| HIPAA | `HI200` | `hipaa` |
| FERPA | `FE210` | `ferpa` |
| GDPR | `GD250` | `gdpr` |
| PCI DSS 4.0.1 | `PC280` | `pci-dss` |
| HECVAT 4.15 | `HE415` | `hecvat` |
| **Multi-framework** | `MULT500-NN` | *(omit; list each real framework in tags + codes)* |

### Policy-id format

`PLCY-<NNN>-<CODE>-<RRR>-<VV>[A]` where:
- `NNN` = company-wide policy counter (every policy ever issued by the org), starts at `001`
- `CODE` = a framework code from the table above (or `MULT500-NN` when a single policy covers multiple)
- `RRR` = index *within that framework's policy set* (1st NIST 800-53 policy = `001`, 2nd = `002`, …), starts at `001`
- `VV` = version of this policy (1st cut = `01`, each rewrite bumps), starts at `01`
- `[A]` = optional single-letter variant suffix (`A`, `B`, `C`, …) when the same logical policy ships in multiple org-specific variants (e.g. `…-01A` for Symplicity, `…-01B` for Contratanet)

First two segments (`NNN-CODE-RRR`) stay stable across versions and variants — only `VV` and the variant letter change. The `policy-version-history` array on the policy chains earlier versions/variants.

Multi-framework example: `PLCY-007-MULT500-01-001-01` carries `framework-codes: ["NI100","SO115"]` enumerating its real frameworks.

### Filename auto-detection → tags + codes

| Filename pattern | Tags added | Codes added |
|---|---|---|
| `nist-800-53`, `nist` (bare) | `nist-800-53` | `NI100` |
| `tx-ramp`, `txramp` | `tx-ramp` | `NI102` |
| `nist-800-171` | `nist-800-171` | `NI105` |
| `nist-800-172` | `nist-800-172` | `NI106` |
| `nist-csf-2`, `csf-2` | `nist-csf-2` | `NI108` |
| `nist-csf` | `nist-csf` | `NI107` |
| `nist-ai-rmf`, `ai-rmf` | `nist-ai-rmf` | `NI110` |
| `soc-2`, `soc2` | `soc-2` | `SO115` |
| `iso-27001` | `iso-27001` | `IS120` |
| `iso-42001` | `iso-42001` | `IS121` |
| `csa-star`, `csa` | `csa-star` | `CS130` |
| `cyber-essentials` | `cyber-essentials` | `CY140` |
| `hipaa` | `hipaa` | `HI200` |
| `ferpa` | `ferpa` | `FE210` |
| `gdpr` | `gdpr` | `GD250` |
| `pci-dss`, `pci` | `pci-dss` | `PC280` |
| `hecvat` | `hecvat` | `HE415` |

Override or extend with `--framework nist-800-53,soc-2` (tag slugs). Override the policy-id with `--policy-id PLCY-NNN-CODE-RRR-VV[A]`.

## CSV output

`--csv-output <path>` emits one row per statement-shaped object. Columns:

```
policy-id, framework-tags,
section-id, section-reference-id, section-number, section-title, section-type,
condition-id, condition-reference-id, condition-framework,
statement-id, statement-reference-id,
Substatement-id, Substatement-reference-id, 
kind, local-id, reference-id, text,
Assignment-id, assignment-reference-id,
scopes, assets-personnel, assets-infrastructure, assets-applications,
policy-map-id,
mapped-controls, evidence-tasks, security-portal-ids, privacy-portal-ids,
jira-projects, jira-project-id, jira-components, related-policy-statement-ids
```

`local-id` is the short id (e.g. `STMT-01`); `reference-id` is the full chain (unique row key). Multi-value cells are pipe-separated (`|`); `assignment-selectors` cells use `[xN]=phrase; [xM]=phrase`.

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
