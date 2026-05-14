# v3 Policy JSON — Schema Cheat Sheet (Node plugin)

One-page reference for v3 policy JSON used by the app workflow. v3 uses compact reference IDs, condition framework tags, and `legacy-reference-id` back-links for compatibility.

## Top-level shape (`*_only.json`)

```json
{
  "schema-version": "v3",
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

## Default sections (always present, start with a number, typically two formats, NIST format and other formats) for NIST 800-53 Policies

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

```json
{
  "exception": "Yes" | "No",
  "asset-owner": "",
  "asset-id": "",
  "mappings": { "<downstream-component-id>": "<mapped-item-id>" },
  "selectors": [ { <selector-id>: "value": 8 } ]
  "Assignments": 
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

Within any statement / substatement / condition text:

- Spreadsheet/control text uses explicit bracketed terms such as `[Assignment: organization-defined ...]` and `[Selection (one or more): ...]`.
- In the controls structure (`tmp/02_enddraft.json`, `tmp/00_consolidated.json`), those terms are represented as IDs and values under `assignments`, `selections`, and `parameters`.
- Empty, unresolved values are stored as `null` in `value` fields (not empty string).
- Parameter value binding is by parameter ID (for example `AC-01-00-C-1-TX-REQ-PRMT1`).

### Curated inline patterns

Use spreadsheet terminology from control text and JSON:

- Assignment term format in control text: `[Assignment: <text>]`
- Selection term format in control text: `[Selection (one or more): <option A>; <option B>; ...]`
- Assignment JSON object: `{ "id": "...ASMT...", "text": "...", "value": null }`
- Selection JSON object: `{ "id": "...SLCT...", "options": "...", "value": null }`
- Parameter JSON object: `{ "id": "...PRMT...", "value": <string|null> }`

## Assignments and selectors index

Preferred naming in this cheat sheet: `control_structure`.

Current source files still store this object under `json_blob`; treat `json_blob` and `control_structure` as the same object shape.

```json
{
  "control_structure": {
    "sortId": "AC-01-00",
    "descriptions": [
      {
        "id": "AC-01-00-A",
        "selections": [],
        "assignments": [
          {
            "id": "AC-01-00-A-SY-PKS-ASMT1",
            "text": "organization-defined personnel or roles",
            "value": null
          }
        ],
        "parameters": [
          {
            "id": "AC-01-00-A-SY-PKS-PRMT1",
            "value": null
          }
        ],
        "subDescriptions": [
          {
            "id": "AC-01-00-A-1",
            "selections": [
              {
                "id": "AC-01-00-A-1-CTRL-SY-PKS-SLCT1",
                "options": "Organization-level; Mission/business process-level; System-level",
                "value": null
              }
            ],
            "assignments": [],
            "parameters": [
              {
                "id": "AC-01-00-A-1-SY-PKS-PRMT1",
                "value": null
              }
            ]
          }
        ]
      },
      {
        "id": "AC-01-00-C",
        "selections": [],
        "assignments": [],
        "parameters": [],
        "subDescriptions": [
          {
            "id": "AC-01-00-C-1",
            "selections": [],
            "assignments": [
              {
                "id": "AC-01-00-C-1-TX-REQ-ASMT1",
                "text": "organization-defined frequency",
                "value": null
              },
              {
                "id": "AC-01-00-C-1-TX-REQ-ASMT2",
                "text": "organization-defined events",
                "value": null
              }
            ],
            "parameters": [
              {
                "id": "AC-01-00-C-1-TX-REQ-PRMT1",
                "value": "least every three (3) years"
              },
              {
                "id": "AC-01-00-C-1-TX-REQ-PRMT2",
                "value": "following significant changes"
              }
            ]
          }
        ]
      }
    ]
  }
}
```

Flat row projection (generic tabular export) uses aligned arrays:

- `selection_id` + `selection_statement`
- `assignment_ids` + `assignment_descriptions`
- `parameter_ids` + `parameter_descriptions`

The linkage is positional within those arrays and by shared control/description lineage.

Example:

```json
{
  "description_id": "AC-01-00-C-1",
  "selection_id": null,
  "selection_statement": null,
  "assignment_ids": [
    "AC-01-00-C-1-TX-REQ-ASMT1",
    "AC-01-00-C-1-TX-REQ-ASMT2"
  ],
  "assignment_descriptions": [
    "organization-defined frequency",
    "organization-defined events"
  ],
  "parameter_ids": [
    "AC-01-00-C-1-TX-REQ-PRMT1",
    "AC-01-00-C-1-TX-REQ-PRMT2"
  ],
  "parameter_descriptions": [
    "least every three (3) years",
    "following significant changes"
  ]
}
```

### ID segment legend

For IDs such as `AC-01-00-A-SY-PKS-ASMT1` and `AC-01-00-C-1-TX-REQ-PRMT1`:

- `SY-PKS` means Symplicity Picks (organization-picked values).
- `XX-REQ` means framework requirement values, where `XX` is the framework prefix.
- For TX-RAMP specifically, `XX-REQ` becomes `TX-REQ`.
- Common suffixes: `ASMT` = assignment, `SLCT` = selection, `PRMT` = parameter.

## Procedure recommendations (separate payload)

Procedure recommendations are maintained as a separate payload (for example `tmp/04_procedures.json`) and linked into controls via `linked_procedure_ids` and `linked_procedures`.

### Top-level shape

```json
{
  "procedures": [
    {
      "procedure_id": "N8-AC-004-ACCT-004-PCDR",
      "control_name": "Account Management",
      "control_ids": "AC-2",
      "sort_ids": "AC-02-01, AC-02-02, AC-02-03",
      "procedure_name": "Procedures for addressing account management",
      "external_control_id": null,
      "evidence_tasks": null,
      "tb_id": null,
      "category_code": "ACCT",
      "review_date": null,
      "owner": null,
      "reviewer": null,
      "status": null,
      "analyzer_id": null,
      "sportal_id": null,
      "pportal_id": null,
      "jwork_id": null,
      "_row": 5
    }
  ],
  "category_code_library": {
    "ACCT": "Account Management",
    "AES": "Audit and Event Settings"
  }
}
```

### Control object fields for procedure linkage

Add these fields to each control object to carry procedure recommendations:

- `linked_procedure_ids`: array of `procedure_id` values.
- `linked_procedures`: array of embedded procedure objects using the full recommendation field set.

Example:

```json
{
  "sort_id": "AC-02-05",
  "control_name": "Account Management | Inactivity Logout",
  "linked_procedure_ids": [
    "N8-AC-004-ACCT-004-PCDR"
  ],
  "linked_procedures": [
    {
      "procedure_id": "N8-AC-004-ACCT-004-PCDR",
      "control_name": "Account Management",
      "control_ids": "AC-2",
      "sort_ids": "AC-02-01, AC-02-02, AC-02-03, AC-02-04, AC-02-05",
      "procedure_name": "Procedures for addressing account management",
      "external_control_id": null,
      "evidence_tasks": null,
      "tb_id": null,
      "category_code": "ACCT",
      "review_date": null,
      "owner": null,
      "reviewer": null,
      "status": null,
      "analyzer_id": null,
      "sportal_id": null,
      "pportal_id": null,
      "jwork_id": null,
      "_row": 5
    }
  ]
}
```

## Lead-in lines (always dropped)

`^\s*(?:symplicity|\{\{organization\.name\}\})\s+shall\s*[:,]?\s*$` (case-insensitive). Drops only whole-line "Symplicity shall" / "{{organization.name}} shall" preambles.

## `***` condition delimiters

Lines that are exactly `***` (three or more asterisks) toggle in/out of a condition block. Adjacent `***\n***` closes one condition and opens the next. Inside an open block, the first `Policy conditions for X` line becomes the condition title where X is the framework(s).

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

`local-id` is the short id (e.g. `STMT-01`); `reference-id` is the full chain (unique row key). Multi-value cells are pipe-separated (`|`); assignment/selection parameter values should be represented by parameter IDs and values (for example `AC-01-00-C-1-TX-REQ-PRMT1=least every three (3) years; AC-01-00-C-1-TX-REQ-PRMT2=following significant changes`).

## CLI quick reference

```bash
# v3-native parse workflow (no explicit v2 -> v3 transform step in this doc)
# Use your app's v3 parser entrypoint and target v3 outputs directly.
<app-v3-parser-command> \
  --docx <path>.docx \
  --schema-version v3 \
  --output <out-dir>

# Optional CSV export for downstream edits
<app-v3-parser-command> \
  --docx <path>.docx \
  --schema-version v3 \
  --csv-output <out-dir>/<name>.csv
```
