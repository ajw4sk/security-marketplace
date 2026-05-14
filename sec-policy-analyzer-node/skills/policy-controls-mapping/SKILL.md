---
name: policy-controls-mapping
description: This skill should be used when the user asks to "map policy to controls", "match policy statements to NIST controls", "associate policy with a controls catalog", "generate a control crosswalk", "find which controls a policy statement satisfies", "link policy to procedures", or otherwise wants to associate a previously parsed policy (v2 or v3 JSON produced by sec-policy-analyzer-node) with entries in a controls catalog spreadsheet (e.g. the NIST 800-53 .xlsx). Trigger proactively when a parsed policy JSON and a controls .xlsx are both present in the working directory.
version: 0.1.0
---

# Policy → Controls Mapping

## Purpose

After a policy `.docx` has been parsed into v2 or v3 JSON by `parse_policy_v2.mjs`, this skill associates each policy statement (and condition-statement, and substatement) with the most-likely matching control(s) from a controls catalog spreadsheet — typically the NIST 800-53 "Level 2" sheet that ships in `NIST Controls and Procedures.xlsx`.

Output:
- A **full mapping JSON** with top-K ranked candidates per statement, including `matched-tokens`, `name-hits`, `description-hits`, and the `related-procedure-ids` carried in from the catalog.
- An optional **condensed JSON** — one row per policy statement with the single best control pick and its procedure IDs. This is the file to attach to a Trust Portal / Linear / GRC ticket.

The mapper is pure Node — same runtime as the parser, same `adm-zip` + `fast-xml-parser` deps. No Python, no extra installs.

## When to Trigger

Trigger this skill when:

- The user asks to "map" / "associate" / "crosswalk" a policy to controls, or to procedures.
- The working directory contains BOTH a parsed policy JSON (`*_policy_only.json` or `*.v3.json`) AND a controls `.xlsx` — propose running this skill proactively.
- The user has a condition like `Policy conditions for CMMC 2.0 and NIST 800-171` and wants to identify which catalog controls it satisfies — the v3 schema carries `framework-tags` on the condition, which this skill respects.
- The user wants traceability from policy statement → control → related procedure ID.

Do **not** trigger for:

- Parsing the source docx (use `policy-parsing-v2-node` / `/parse-policy-v2` first).
- Re-emitting v3 (use `/run.sh transform-v3` or this skill's preflight step).

## Preflight

1. Confirm a parsed policy JSON exists. Prefer the v3 file (`*.v3.json`) if present — compact reference-ids and framework-tags-on-conditions are useful downstream. If only v2 exists, optionally run:

   ```bash
   bash "${CLAUDE_PLUGIN_ROOT}/scripts/run.sh" transform-v3 \
     --policy-only ./<base>_policy_only.json \
     --complete    ./<base>_policy_complete_associations.json
   ```

2. Confirm a controls `.xlsx` is reachable. The default is the NIST `Level 2` sheet (columns: Control Family, SORT ID, Control Name, Control Description, TX-RAMP Parameters, Discussion, Related Controls, Related Procedures, Related Procedure ID).
   - CLI flag: `--controls <path.xlsx>`
   - Env default: `SEC_POLICY_DEFAULT_CONTROLS_XLSX`
   - Config default: `default-controls-xlsx:` in `.claude/sec-policy-analyzer-node.local.md`

## Running

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/run.sh" map-controls \
  --policy   ./<base>_policy_only.v3.json \
  --controls "./NIST Controls and Procedures.xlsx" \
  --sheet    "Level 2" \
  --variant  section-aware \
  --top      5 \
  --min-score 0.02 \
  --out            ./mapping.json \
  --condensed-out  ./mapping_condensed.json
```

Slash command equivalent: `/map-policy-controls <policy.json> [flags]`.

## Variants

The matcher is a weighted IDF token-overlap scorer. Token weights vary per variant:

- **balanced** — `wName=2.0, wDesc=1.0, wDisc=0.5`. Solid default.
- **name-boost** — `wName=3.0`. Use when the control name is highly diagnostic (most NIST controls).
- **description-only** — `wName=0, wDesc=1.0`. Diagnostic / debug — what falls out when you ignore the name.
- **section-aware** (recommended) — balanced + a multiplier when the candidate control's name overlaps the policy section title. Highest measured AC-family hit rate on the NIST test fixture (89/99 vs 83/99 for balanced).

Run more than one variant when in doubt — they share the same output schema, so diffing is trivial.

## Output Structure

### Full mapping (`--out`)

`schema-version: map-v1`. Top-level fields capture provenance (`policy-id`, `controls-source`, `variant`, `top`, `min-score`). The `controls` array preserves every catalog row (so the mapping JSON is a self-contained crosswalk). Each entry in `mappings` carries the policy ref-ids (both compact v3 and legacy v2), the section + condition context, the framework-tags inherited or extracted, the source statement text, and a ranked candidate list with score and matched-token diagnostics.

### Condensed best-pick (`--condensed-out`)

`schema-version: map-condensed-v1`. One row per policy statement:

```jsonc
{
  "policy-ref-id":        "PLCY-014-NI100-001-01-SECT-09-COND-04-STMT-01",
  "policy-legacy-ref-id": "nist-access-control-2026-polcsec-9-polcond-4-polstmt-1",
  "section-number":       "9.0",
  "section-title":        "Access Enforcement",
  "section-ref-id":       "PLCY-014-NI100-001-01-SECT-09",
  "condition-id":         "COND-04",
  "condition-title":      "Policy conditions for CMMC 2.0 and NIST 800-171",
  "condition-ref-id":     "PLCY-014-NI100-001-01-SECT-09-COND-04",
  "framework-tags":       ["nist-800-171", "cmmc"],
  "kind":                 "condition-statement",
  "text":                 "Execute critical or sensitive system and organizational operations using dual authorization.",
  "control-id":           "AC-03-02",
  "control-family":       "Access Control",
  "control-name":         "Access Enforcement | Dual Authorization",
  "score":                0.31,
  "related-procedure-ids":["N8-AC-...-PCDR"]
}
```

## Iteration tips

- If too many statements land outside the expected control family, switch to `section-aware`.
- If the same control captures every statement in a section, lower `--top` to 1 and look at the runner-up via `--variant description-only`.
- For low-text statements (e.g. one-clause condition statements), raise `--min-score` to 0.05 to suppress noise — or drop it to 0 to inspect every candidate.
- The `tokens` field on each mapping shows exactly what the scorer saw — useful for diagnosing why a match did or didn't happen.

## Validation

- Spot-check at least 5 mappings against the source policy.
- Confirm `framework-tags` on each condition-statement match what the condition title declared (e.g. `["cmmc", "nist-800-171"]`).
- Confirm `related-procedure-ids` matches the source xlsx for the picked control row.
- Sanity-check AC-family hit rate when mapping an Access Control policy to a NIST catalog: should be 80%+ with `section-aware`.

## Limitations

- No semantic embeddings yet — pure token overlap with IDF weighting and a synonyms list. Misses paraphrases (e.g. "two-factor" ↔ "multi-factor") unless the synonym is in the list.
- Currently only parses xlsx with a sheet shaped like the NIST `Level 2` sheet (header row 1, `SORT ID` / `Control Name` / `Control Description` columns). Other catalog shapes need a sheet adapter.
- The mapper does not write back into the policy JSON. To embed control IDs into the policy file's `mapped-controls` arrays, do that as a downstream step against the condensed JSON.
