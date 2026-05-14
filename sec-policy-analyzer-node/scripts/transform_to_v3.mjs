#!/usr/bin/env node
/**
 * v2 → v3 schema transform.
 *
 * Reads a parsed `*_policy_only.json` (and optional `*_complete_associations.json`)
 * produced by `parse_policy_v2.mjs` and emits an additive v3 sibling file:
 *
 *   <stem>_policy_only.v3.json
 *   <stem>_complete_associations.v3.json   (only when the input complete file is given)
 *
 * Output shape matches `parse_policy_v3.mjs` so a direct v3 parse and a
 * transform of the equivalent v2 file produce the same v3 structure:
 *
 *   - schema-version: "v3"
 *   - policy-id rewritten to framework-coded PLCY-NNN-<CODE>-RRR-VV[A] form
 *     (using defaults/default-frameworks.json for tag → code mapping)
 *   - framework-codes + frameworks arrays at the top level
 *   - Compact uppercase id family for every local id and reference-id:
 *       polcsec-7  → SECT-07
 *       polcond-1  → COND-01
 *       polstmt-1  → STMT-01
 *       polsubstmt-1 → SUST-01
 *       polrole-1  → ROLE-01
 *       polresp-1  → RESP-01
 *       polscope-1 → SCOP-01
 *       polasn-1   → SLCT-01
 *   - legacy-reference-id on every object that had a v2 reference-id (the
 *     original v2 form preserved verbatim)
 *   - policy-conditions[].framework-tags detected from the condition title
 *     (e.g. "Policy conditions for CMMC 2.0 and NIST 800-171"
 *      → ["nist-800-171","cmmc"])
 *
 * Usage:
 *   transform_to_v3.mjs --policy-only <path.json> [--complete <path.json>] [--out-dir <dir>]
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ─── Framework detection (precise + fallback) ──────────────────────────────
// Precise patterns: exact framework + revision. Used everywhere except
// document-level fallback so "NIST 800-171" doesn't also tag nist-800-53.
const FRAMEWORK_PATTERNS_PRECISE = [
  [/\bnist[-_ ]?800[-_ ]?53\b/i,    'nist-800-53'],
  [/\bnist[-_ ]?800[-_ ]?171\b/i,   'nist-800-171'],
  [/\bnist[-_ ]?800[-_ ]?172\b/i,   'nist-800-172'],
  [/\bnist[-_ ]?csf[-_ ]?2\b/i,     'nist-csf-2'],
  [/\bnist[-_ ]?csf\b/i,            'nist-csf'],
  [/\bnist[-_ ]?ai[-_ ]?rmf\b/i,    'nist-ai-rmf'],
  [/\btx[-_ ]?ramp\b/i,             'tx-ramp'],
  [/\biso[-_ ]?27001\b/i,           'iso-27001'],
  [/\biso[-_ ]?42001\b/i,           'iso-42001'],
  [/\bsoc[-_ ]?2\b/i,               'soc-2'],
  [/\bpci[-_ ]?dss\b/i,             'pci-dss'],
  [/\bcsa[-_ ]?star\b/i,            'csa-star'],
  [/\bcyber[-_ ]?essentials\b/i,    'cyber-essentials'],
  [/\bhipaa\b/i,                    'hipaa'],
  [/\bferpa\b/i,                    'ferpa'],
  [/\bgdpr\b/i,                     'gdpr'],
  [/\bcmmc\b/i,                     'cmmc'],
  [/\bhecvat\b/i,                   'hecvat'],
];

function detectFrameworkTags(text) {
  if (!text) return [];
  const out = new Set();
  for (const [rx, tag] of FRAMEWORK_PATTERNS_PRECISE) if (rx.test(text)) out.add(tag);
  return [...out];
}

// ─── Framework registry (defaults/default-frameworks.json) ─────────────────
function loadFrameworkRegistry() {
  const regPath = path.join(__dirname, '..', 'defaults', 'default-frameworks.json');
  if (fs.existsSync(regPath)) {
    try { return JSON.parse(fs.readFileSync(regPath, 'utf-8')); } catch (e) {
      console.error(`WARN: could not parse ${regPath}: ${e?.message || e}`);
    }
  }
  return { frameworks: {} };
}

// v2 used a few ambiguous fuzzy slugs (e.g. "nist" without a revision). Map
// each to the canonical v3 slug the registry knows about so transformed v2
// docs end up with the same framework-codes a direct v3 parse would produce.
const V2_TAG_ALIASES = {
  nist:   'nist-800-53',
  iso:    'iso-27001',
  soc:    'soc-2',
  pci:    'pci-dss',
};

function normalizeTags(tags) {
  const out = [];
  const seen = new Set();
  for (const tag of tags || []) {
    const canon = V2_TAG_ALIASES[tag] || tag;
    if (!seen.has(canon)) { out.push(canon); seen.add(canon); }
  }
  return out;
}

function tagsToCodes(tags, registry) {
  const codes = [];
  const seen = new Set();
  for (const tag of tags || []) {
    for (const [code, info] of Object.entries(registry.frameworks || {})) {
      if (info.tag === tag && !seen.has(code)) { codes.push(code); seen.add(code); }
    }
  }
  return codes;
}

function codesToDisplayNames(codes, registry) {
  return codes.map((c) => {
    const info = (registry.frameworks || {})[c];
    if (!info) return c;
    return info.edition ? `${info.name} ${info.edition}` : info.name;
  });
}

function buildV3PolicyId(frameworkCodes) {
  let code;
  if (frameworkCodes.length > 1) code = 'MULT500-01';
  else if (frameworkCodes.length === 1) code = frameworkCodes[0];
  else code = 'XX000';
  return `PLCY-001-${code}-001-01`;
}

// ─── ID rewrites (v2 pol* → v3 compact uppercase, zero-padded) ────────────
const pad2 = (n) => String(n).padStart(2, '0');

// Compound rule first so "polstmt-1-polsubstmt-2" lands as "STMT-01-SUST-02"
// without a stray double-rewrite of the inner polstmt.
const ID_RULES = [
  [/polcsec-(\d+)/g,    (_, n) => `SECT-${pad2(n)}`],
  [/polcond-(\d+)/g,    (_, n) => `COND-${pad2(n)}`],
  [/polsubstmt-(\d+)/g, (_, n) => `SUST-${pad2(n)}`],
  [/polstmt-(\d+)/g,    (_, n) => `STMT-${pad2(n)}`],
  [/polrole-(\d+)/g,    (_, n) => `ROLE-${pad2(n)}`],
  [/polresp-(\d+)/g,    (_, n) => `RESP-${pad2(n)}`],
  [/polscope-(\d+)/g,   (_, n) => `SCOP-${pad2(n)}`],
  [/polasn-(\d+)/g,     (_, n) => `SLCT-${pad2(n)}`],
];

function compactRef(s) {
  if (typeof s !== 'string' || !s) return s;
  let out = s;
  for (const [rx, fn] of ID_RULES) out = out.replace(rx, fn);
  return out;
}

// Keys whose VALUE is a reference-id-shaped string we should rewrite (and on
// which we should attach legacy-reference-id back-links for primary refs).
const REF_KEYS_PRIMARY  = new Set(['reference-id']);
const REF_KEYS_ARRAY    = new Set(['related-policy-statement-ids', 'policy-statement-ids']);
const REF_KEYS_SCALAR   = new Set([
  'parent-reference-id',
  'section-reference-id',
  'condition-reference-id',
  'host-reference-id',
]);

// Keys whose VALUE is a bare local id (one segment) to rewrite as well.
// Note: `policy-id` is NOT included here — it's reconstructed from frameworks
// at the top level by replacePolicyId() since v3 uses PLCY-NNN-CODE-RRR-VV[A].
const LOCAL_ID_KEYS = new Set([
  'sect-id',
  'policy-condition-id',
  'policy-statement-id',
  'policy-substatement-id',
  'role-id',
  'resp-id',
  'scope-id',
  'selector-id',
  'host-id',
  'policy-section-id',
]);

function transformValue(v) {
  if (Array.isArray(v)) return v.map(transformValue);
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      if (REF_KEYS_PRIMARY.has(k) && typeof val === 'string') {
        out[k] = compactRef(val);
        if (val) out['legacy-reference-id'] = val;
      } else if (REF_KEYS_SCALAR.has(k) && typeof val === 'string') {
        out[k] = compactRef(val);
      } else if (REF_KEYS_ARRAY.has(k) && Array.isArray(val)) {
        out[k] = val.map(compactRef);
      } else if (LOCAL_ID_KEYS.has(k) && typeof val === 'string') {
        out[k] = compactRef(val);
      } else {
        out[k] = transformValue(val);
      }
    }
    return out;
  }
  return v;
}

// ─── Policy-id rewrite ─────────────────────────────────────────────────────
// Replace every occurrence of the v2 slug-style policy-id with the v3
// framework-coded form throughout reference-ids, host-reference-ids, etc.
function rewritePolicyIdInRefs(doc, oldId, newId) {
  if (!oldId || !newId || oldId === newId) return;
  const escaped = oldId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rx = new RegExp(escaped, 'g');

  function walk(v) {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (v && typeof v === 'object') {
      for (const [k, val] of Object.entries(v)) {
        if (typeof val === 'string'
            && (REF_KEYS_PRIMARY.has(k)
                || REF_KEYS_SCALAR.has(k)
                || k === 'legacy-reference-id')) {
          v[k] = val.replace(rx, newId);
        } else if (Array.isArray(val) && REF_KEYS_ARRAY.has(k)) {
          v[k] = val.map((s) => (typeof s === 'string' ? s.replace(rx, newId) : s));
        } else {
          walk(val);
        }
      }
    }
  }
  walk(doc);
}

// ─── Condition framework-tags annotation ──────────────────────────────────
function annotateConditions(doc) {
  const sections = doc?.policy?.['policy-requirements'];
  if (!Array.isArray(sections)) return;
  for (const sec of sections) {
    const conds = sec['policy-conditions'];
    if (!Array.isArray(conds)) continue;
    for (const cond of conds) {
      const title = cond['policy-condition-title'] || '';
      const tags = detectFrameworkTags(title);
      cond['framework-tags'] = tags;
      cond['framework-tags-inherited'] = tags.length === 0;
    }
  }
}

// ─── argv ─────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { policyOnly: '', complete: '', outDir: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = () => argv[++i];
    if (a === '--policy-only') out.policyOnly = v();
    else if (a === '--complete') out.complete = v();
    else if (a === '--out-dir') out.outDir = v();
    else if (a === '-h' || a === '--help') out.help = true;
  }
  return out;
}

function usage() {
  console.log(`Usage: transform_to_v3.mjs --policy-only <path.json> [--complete <path.json>] [--out-dir <dir>]`);
}

function transformDocument(doc, registry) {
  const v3 = transformValue(doc);

  // Top-level v3 framing.
  v3['schema-version'] = 'v3';

  // Normalize fuzzy v2 tag slugs (e.g. "nist" → "nist-800-53") so they line
  // up with the registry. Write the canonical list back so v3 consumers see
  // the same tag values a direct v3 parse would have produced.
  const rawTags = Array.isArray(v3['framework-tags']) ? v3['framework-tags'].slice() : [];
  const tags = normalizeTags(rawTags);
  v3['framework-tags'] = tags;

  // framework-codes from canonical framework-tags via registry.
  const codes = tagsToCodes(tags, registry);
  v3['framework-codes'] = codes;
  // Replace v2's `frameworks` (which may be empty or use v2 fuzzy names) with
  // the registry's display names so it matches a direct v3 parse.
  v3['frameworks'] = codesToDisplayNames(codes, registry);

  // Reconstruct policy-id in framework-coded form, then rewrite every ref-id
  // chain that still embeds the old slug.
  const oldPolicyId = typeof v3['policy-id'] === 'string' ? v3['policy-id'] : '';
  const newPolicyId = buildV3PolicyId(codes);
  v3['policy-id'] = newPolicyId;
  if (!v3['policy-id-source']) v3['policy-id-source'] = 'transform';
  rewritePolicyIdInRefs(v3, oldPolicyId, newPolicyId);

  // Condition framework-tag annotation (runs after the rest of the tree has
  // been rewritten so we annotate the v3-shaped objects).
  annotateConditions(v3);

  return v3;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.policyOnly) { usage(); process.exit(args.help ? 0 : 2); }
  if (!fs.existsSync(args.policyOnly)) { console.error('not found:', args.policyOnly); process.exit(2); }

  const registry = loadFrameworkRegistry();
  const inDir  = path.dirname(path.resolve(args.policyOnly));
  const outDir = args.outDir ? path.resolve(args.outDir) : inDir;
  fs.mkdirSync(outDir, { recursive: true });

  const v2 = JSON.parse(fs.readFileSync(args.policyOnly, 'utf8'));
  const v3 = transformDocument(v2, registry);
  v3['v2-source-file'] = path.basename(args.policyOnly);

  const base = path.basename(args.policyOnly).replace(/\.json$/i, '');
  const outPath = path.join(outDir, `${base}.v3.json`);
  fs.writeFileSync(outPath, JSON.stringify(v3, null, 2));
  console.log(`wrote: ${outPath}`);

  if (args.complete) {
    if (!fs.existsSync(args.complete)) { console.error('not found:', args.complete); process.exit(2); }
    const cv2 = JSON.parse(fs.readFileSync(args.complete, 'utf8'));
    const cv3 = transformDocument(cv2, registry);
    cv3['v2-source-file'] = path.basename(args.complete);
    const cbase = path.basename(args.complete).replace(/\.json$/i, '');
    const cOut = path.join(outDir, `${cbase}.v3.json`);
    fs.writeFileSync(cOut, JSON.stringify(cv3, null, 2));
    console.log(`wrote: ${cOut}`);
  }
}

main();
