---
name: policy-parsing-v3-node
description: Use when the user asks to "parse to v3", "emit v3 policy JSON", "produce compact reference ids", "add framework-tags to conditions", or otherwise wants the v3 schema variant. v3 uses compact uppercase reference-ids (`SECT-NN`, `COND-NN`, `STMT-NN`, …), condition-level `framework-tags`, framework-coded `policy-id` (`PLCY-NNN-<CODE>-RRR-VV[A]`), and `legacy-reference-id` back-links for compatibility. Primary producer: `scripts/parse_policy_v3.mjs` (direct `.docx` → v3) via `run.sh parse-v3` / `/parse-policy-v3`. Supplementary producer: `scripts/transform_to_v3.mjs` (additive v2 JSON → v3) via `run.sh transform-v3`. Feeds the policy-controls-mapping skill.
version: 0.2.0
---

# Policy Parsing v3 — Node

## Purpose

The v3 schema is produced directly from a `.docx` by `scripts/parse_policy_v3.mjs` (driven by `run.sh parse-v3` / `/parse-policy-v3`). For pre-existing v2 outputs you want to upgrade in place, `scripts/transform_to_v3.mjs` (`run.sh transform-v3`) applies an additive rewrite — useful for backfilling but unnecessary on a fresh parse.

v3 carries:

- `schema-version: "v3"` at the top.
- Compact uppercase reference-ids — every non-top-level object uses the id family in the table below.
- `framework-tags` on every policy-condition, extracted from the condition title and union'd with the document-level `framework-tags`.
- Framework-coded `policy-id` of shape `PLCY-NNN-<CODE>-RRR-VV[A]`, with `policy-id-source` and parallel `framework-codes` / `frameworks` arrays at the top level.
- `legacy-reference-id` on every object that had a reference-id in v2, so v3 → v2 traceability is non-lossy.

Use this skill for **v3-first** workflows: producing v3 output, validating its structure, and confirming the linkage surface the `policy-controls-mapping` skill consumes.

The authoritative schema reference is **`references/schema-cheatsheet-v3.md`** in this skill — keep it and any consumer documentation in sync.

## When to Trigger

- User asks to produce v3 output, transform v2 → v3, generate compact ids, or attach framework-tags to conditions.
- A v2 `*_only.json` is present and the next downstream step (controls mapping, app ingest) needs v3 shape.
- User is debugging missing/wrong `framework-tags` on conditions, missing `legacy-reference-id` back-links, or a malformed `policy-id`.

Do **not** use for:

- Parsing the source `.docx` — use `policy-parsing-v2-node` / `/parse-policy-v2` first to produce the v2 JSON.
- Python-parser maintenance — that lives in the sibling repo.

## Producer (primary): direct `.docx` → v3

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/run.sh" parse-v3 ./<policy>.docx [--csv] [--policy-map] [--framework <tags>] [--policy-id <PLCY-…>]
```

Direct node invocation (debug, no wrapper defaults):

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/parse_policy_v3.mjs" \
  --docx ./<policy>.docx \
  --test-output-dir <dir> \
  [--csv-output <path.csv>] \
  [--policy-id PLCY-NNN-CODE-RRR-VV[A]] \
  [--framework iso-27001,soc-2] \
  [--policy-map] [--verbose]
```

The wrapper routes outputs into `${parsing-output-dir}/policy/` by default (alongside the optional CSV) and applies the CLI > env > `.local.md` > built-in resolution chain to every setting.

## Producer (supplementary): v2 JSON → v3

For pre-existing v2 outputs you want to upgrade in place:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/run.sh" transform-v3 \
  --policy-only ./<base>_only.json \
  [--complete   ./<base>_complete_associations.json] \
  [--out-dir <dir>]
```

| Flag | Purpose |
|---|---|
| `--policy-only` | Required. Path to v2 `*_only.json`. |
| `--complete` | Optional. Path to v2 `*_complete_associations.json`; if provided, a v3 sibling is emitted alongside. |
| `--out-dir` | Output directory (defaults to the input file's directory). |

Use this only when re-parsing the source `.docx` isn't an option; otherwise prefer the direct parser above.

## v3 ID family

Every local id is short. Every non-top-level object also carries a `reference-id` with the full ancestor chain prefixed by `policy-id`.

| Entity | Local id | Reference-id pattern |
|---|---|---|
| Policy (top-level) | `PLCY-NN` | *(none — `policy-id` is the prefix)* |
| Section | `sect-id`: `SECT-NN` | `<policy-id>-SECT-NN` |
| Role | `role-id`: `ROLE-NN` | `<section-ref>-ROLE-NN` |
| Responsibility | `RESP-id`: `RESP-NN` | *(same row as role)* |
| Scope item | `scope-id`: `SCOP-NN` | `<section-ref>-SCOP-NN` |
| Policy statement | `policy-statement-id`: `STMT-NN` | `<parent-ref>-STMT-NN` |
| Policy substatement | `policy-substatement-id`: `SUST-NN` | `<statement-ref>-SUST-NN` |
| Policy condition | `policy-condition-id`: `COND-NN` | `<section-ref>-COND-NN` |
| Assignment selector | `selector-id`: `SLCT-N` | `<host-ref>-SLCT-N` |

Default sections (`SECT-01` through `SECT-07`) are always emitted in order: `purpose`, `scope`, `roles-and-responsibilities`, `management-commitment`, `coordination-among-organizational-entities`, `compliance`, `policy-and-procedures`. Numbered sections (`SECT-08`+) carry `policy-statements` and optional `policy-conditions`.

## `policy-id` format

`PLCY-<NNN>-<CODE>-<RRR>-<VV>[A]`

- `NNN` — company-wide policy counter (every policy ever issued), starts at `001`.
- `CODE` — framework code from `defaults/default-frameworks.json` (e.g. `NI100` for NIST 800-53, `SO115` for SOC 2). Use `MULT500-NN` when one policy covers multiple real frameworks.
- `RRR` — index within that framework's policy set (1st NIST 800-53 policy = `001`).
- `VV` — version of this policy (`01` for the first cut; each rewrite bumps).
- `[A]` — optional single-letter variant suffix when the same logical policy ships in multiple org-specific variants.

The first three segments (`NNN-CODE-RRR`) stay stable across versions and variants; only `VV` and the variant letter change. The top-level `policy-version-history` array chains earlier versions/variants.

For multi-framework policies, `framework-tags` and `framework-codes` enumerate every real framework even though the `CODE` segment is `MULT500-NN`.

## Per-statement fields

Always present on statement-shaped objects:

```json
{
  "scopes": [],
  "assets": { "personnel": {}, "infrastructure": {}, "applications": {} }
}
```

Plus either the eight inline linkage fields (default) — `mapped-controls`, `evidence-tasks`, `security-portal-ids`, `privacy-portal-ids`, `jira-projects`, `jira-project-id`, `jira-components`, `related-policy-statement-ids` — or, under `--policy-map`, a single `policy-map-id` plus a top-level `policy-map` registry.

## Conditions and `framework-tags`

Conditions are detected from `***`-delimited blocks; the first `Policy conditions for X` line inside the block becomes the title, where `X` names the framework(s). The v3 transform extracts those framework names into `framework-tags` on the condition object, normalised to the slug column of the framework registry (e.g. `Policy conditions for CMMC 2.0 and NIST 800-171` → `["cmmc", "nist-800-171"]`).

## Downstream control + procedure linkage

v3 is the canonical input to the `policy-controls-mapping` skill. The mapper writes:

- `linked_procedure_ids: string[]` — procedure IDs lifted from the controls catalog.
- `linked_procedures: object[]` — embedded procedure objects per the app recommendation format.

Procedure recommendation shape (see `references/schema-cheatsheet-v3.md` for the full field list): `procedure_id, control_name, control_ids, sort_ids, procedure_name, external_control_id, evidence_tasks, tb_id, category_code, review_date, owner, reviewer, status, analyzer_id, sportal_id, pportal_id, jwork_id, _row`.

## Validation Checklist

- Top-level `schema-version` is exactly `"v3"`.
- `policy-id` matches `PLCY-NNN-<CODE>-RRR-VV[A]`; `framework-codes` lists the codes that appear in the id (or every real framework when the id uses `MULT500-NN`).
- Every non-top-level object has a `reference-id` that begins with `policy-id` and uses only the v3 id family above (`SECT-NN`, `COND-NN`, `STMT-NN`, `SUST-NN`, `ROLE-NN`, `RESP-NN`, `SCOP-NN`, `SLCT-N`). No bare integers, no legacy id segments in v3 ref-ids.
- Every object that carried a reference-id in v2 also has a `legacy-reference-id`; the chain reconstructs unambiguously back to the v2 file.
- Default sections `SECT-01`–`SECT-07` are present in order with the expected `section-type` values.
- Every `policy-condition` has a non-empty `framework-tags` array using slugs from `defaults/default-frameworks.json`.
- Statement-shaped objects expose all eight linkage fields (default-empty), or — under `--policy-map` mode — a single `policy-map-id` with the top-level `policy-map` registry populated.
- ID nesting: each child reference-id contains its parent reference-id end-to-end.

## Authoritative source files

- **Primary producer:** `scripts/parse_policy_v3.mjs` (direct `.docx` → v3).
- **Supplementary producer:** `scripts/transform_to_v3.mjs` (v2 JSON → v3, additive).
- **Coded registries (do not hardcode in the script):** `defaults/default-frameworks.json`, `defaults/default-categories.json`, `defaults/default-assets.json`.
- **Shape contracts:** `templates/template-{policy,control,procedure,framework,category,evidence-task,asset-*}.json` — when adding a v3 field, update the matching template.
- **Schema cheatsheet:** `references/schema-cheatsheet-v3.md`.

## Iteration

v3 is non-destructive: rerun the transform any time. For the same v2 input, output is deterministic — diff v3 against the prior v3 to catch regressions in the transform; diff `legacy-reference-id` columns against v2 ref-ids to confirm the back-link is intact.
