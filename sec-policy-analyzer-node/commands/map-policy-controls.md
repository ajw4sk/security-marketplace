---
description: Map parsed policy statements to a controls catalog (e.g. NIST 800-53 xlsx). Emits a full mapping JSON plus a condensed best-pick view that links every policy statement to its top control + related procedure IDs.
argument-hint: <policy.json> [--controls <catalog.xlsx>] [--sheet "Level 2"] [--out <path>] [--condensed-out <path>] [--variant balanced|name-boost|description-only|section-aware] [--top 5] [--min-score 0.02]
---

# /map-policy-controls

Run the policy → controls mapper against a parsed policy JSON.

## Behavior

1. Resolve `$1` (the parsed policy JSON path — v2 `*_policy_only.json` or v3 `*.v3.json`). If missing, ask the user for it. Prefer v3 if both exist next to each other (compact reference-ids, framework-tags on conditions).

2. Resolve the controls catalog:
   - From the `--controls` flag, OR
   - From the `default-controls-xlsx` frontmatter key in `.claude/sec-policy-analyzer-node.local.md`, OR
   - From `SEC_POLICY_DEFAULT_CONTROLS_XLSX`.
   - If still missing, ask the user.

3. Forward `$@` verbatim to `run.sh`. The wrapper handles node-binary resolution and the controls default. Default `--variant` is `balanced`; the recommended variant is `section-aware` (boosts controls in the same family as the policy section).

4. Run:

   ```bash
   bash "${CLAUDE_PLUGIN_ROOT}/scripts/run.sh" map-controls --policy "$POLICY" "$@"
   ```

5. By default the wrapper writes `mapping.json` next to the policy and (if `--condensed-out` is given) a flat best-pick view. Show the user:
   - `mappings-total`, `with-candidates`, `avg-top-score` from the summary block
   - 5–10 spot-check rows (section / kind / policy-ref / top control / score)
   - Path to the full + condensed output files

## Variants

| Variant | Use when | Notes |
|---|---|---|
| `balanced` | Default. | Weights name 2× description, discussion 0.5× |
| `name-boost` | Control-name overlap should dominate. | Name 3× description |
| `description-only` | Want unbiased description match. | Ignores name, useful for diffing |
| `section-aware` (recommended) | Policy sections align with control families (typical for NIST). | Boosts candidates whose name overlaps the policy section title |

## Examples

```text
/map-policy-controls ./nist-access-control-2026_policy_only.v3.json \
  --controls "./NIST Controls and Procedures.xlsx" \
  --variant section-aware \
  --out ./mapping.json \
  --condensed-out ./mapping_condensed.json
```

```text
/map-policy-controls ./policy_only.v3.json --variant balanced --top 3 --min-score 0.05
```

## Output shape (full JSON)

```jsonc
{
  "schema-version": "map-v1",
  "policy-id": "...",
  "controls-source": "NIST Controls and Procedures.xlsx",
  "controls-sheet": "Level 2",
  "variant": "section-aware",
  "summary": { "mappings-total": 99, "with-candidates": 99, "avg-top-score": 0.51 },
  "controls": [ /* every catalog row, with related-procedure-ids */ ],
  "mappings": [
    {
      "policy-ref-id": "nist-access-control-2026-s8-r6",
      "policy-legacy-ref-id": "nist-access-control-2026-polcsec-8-polstmt-6",
      "section": { "section-number": "8.0", "section-title": "Account Management", "section-reference-id": "..." },
      "condition": null,
      "kind": "statement",
      "framework-tags": ["nist", "nist-800-53"],
      "text": "Require users to physically logout of systems ...",
      "candidates": [
        { "control-id": "AC-02-05", "control-name": "Account Management | Inactivity Logout",
          "score": 0.45, "name-hits": ["logout", "inactivity"], "description-hits": ["require"],
          "related-procedure-ids": ["N8-AC-004-ACCT-004-PCDR"] }
      ]
    }
  ]
}
```

## Output shape (condensed `--condensed-out`)

One row per policy statement; only the top control + its procedure IDs. Easy to scan or hand off downstream.
