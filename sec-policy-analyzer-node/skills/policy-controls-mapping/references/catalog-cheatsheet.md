# Controls Catalog Cheatsheet

One-page reference for the **controls catalog structure** the mapper reads from (NIST 800-53 `Level 2` xlsx, and equivalents). Distinct from policy parsing output — the catalog has its own ID family, its own bracketed-term syntax, and its own flat-row projection.

For policy parsing output (v2 / v3), see the cheatsheets under `policy-parsing-v2/references/` and `policy-parsing-v3/references/`.

## Bracketed terms in control text

Spreadsheet/control text uses explicit bracketed terms:

- Assignment term: `[Assignment: <text>]`
- Selection term: `[Selection (one or more): <option A>; <option B>; ...]`

In the parsed `control_structure` (see below), these become IDs and values under `assignments`, `selections`, and `parameters`. Empty/unresolved values are stored as `null` in `value` fields (not empty string). Parameter value binding is by parameter ID (e.g. `AC-01-00-C-1-TX-REQ-PRMT1`).

## ID segment legend

For IDs such as `AC-01-00-A-SY-PKS-ASMT1` and `AC-01-00-C-1-TX-REQ-PRMT1`:

| Segment | Meaning |
|---|---|
| `AC-01-00` | Control sort id (family + number + sub) |
| `A`, `C`, `C-1`, `A-1` | Description / sub-description path |
| `SY-PKS` | Symplicity Picks — organization-picked values |
| `XX-REQ` | Framework requirement values; `XX` is the framework prefix (e.g. `TX-REQ` for TX-RAMP) |
| `ASMT<N>` | Assignment |
| `SLCT<N>` | Selection |
| `PRMT<N>` | Parameter |

## `control_structure` object shape

Preferred name in new code: `control_structure`. Existing source files still store this object under `json_blob` — treat `json_blob` and `control_structure` as the same shape.

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

## Flat row projection

Generic tabular export uses aligned arrays. Linkage is positional within those arrays and by shared control/description lineage.

- `selection_id` + `selection_statement`
- `assignment_ids` + `assignment_descriptions`
- `parameter_ids` + `parameter_descriptions`

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

## Bridging to policy CSV rows

When exporting the mapped policy CSV, parameter-bearing cells should be rendered by ID and value rather than by free-form phrase. Example for an `assignment-selectors` cell:

```
AC-01-00-C-1-TX-REQ-PRMT1=least every three (3) years; AC-01-00-C-1-TX-REQ-PRMT2=following significant changes
```

The `local-id` on a policy CSV row is the short id from the parser (e.g. `STMT-01`); the `reference-id` is the full chain. Multi-value cells are pipe-separated (`|`).
