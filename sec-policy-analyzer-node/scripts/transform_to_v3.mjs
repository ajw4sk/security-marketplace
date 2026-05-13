#!/usr/bin/env node
/**
 * v2 → v3 schema transform.
 *
 * Reads a parsed `*_policy_only.json` (and optional `*_complete_associations.json`)
 * produced by parse_policy_v2.mjs and emits an additional v3 file:
 *
 *   <stem>_policy_only.v3.json
 *   <stem>_complete_associations.v3.json   (only if input complete file is given)
 *
 * v3 changes vs v2 (additive — v2 stays byte-for-byte compatible):
 *   - Compact reference-ids:
 *       polcsec-7         → s7
 *       polcond-1         → c1
 *       polstmt-1         → r1
 *       polsubstmt-1      → embedded as `.1` after the parent statement (e.g. r1.1)
 *       polrole-1         → role1
 *       polscope-1        → sc1
 *       polasn-1          → x1   (matches the [x1] inline placeholder)
 *     So `nist-access-control-2026-polcsec-9-polcond-4-polstmt-1`
 *      → `nist-access-control-2026-s9-c4-r1`
 *   - On every transformed object: `legacy-reference-id` preserves the v2 form.
 *   - `policy-conditions[].framework-tags`: detected from the condition title
 *     (e.g. "Policy conditions for CMMC 2.0 and NIST 800-171" → ["cmmc","nist-800-171"]).
 *     Empty array means "inherits the policy-level framework-tags".
 *   - schema-version bumped to "v3"; `v2-source-file` field added.
 *
 * Usage:
 *   transform_to_v3.mjs --policy-only <path.json> [--complete <path.json>] [--out-dir <dir>]
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const FRAMEWORK_PATTERNS = [
  [/\bnist[-_ ]?800[-_ ]?53\b/i,    'nist-800-53'],
  [/\bnist[-_ ]?800[-_ ]?171\b/i,   'nist-800-171'],
  [/\bnist[-_ ]?800[-_ ]?172\b/i,   'nist-800-172'],
  [/\biso[-_ ]?27018\b/i,           'iso-27018'],
  [/\biso[-_ ]?27001\b/i,           'iso-27001'],
  [/\bsoc[-_ ]?2\b/i,               'soc-2'],
  [/\bpci[-_ ]?dss\b/i,             'pci-dss'],
  [/\bcmmc\b/i,                     'cmmc'],
  [/\bhipaa\b/i,                    'hipaa'],
  [/\bgdpr\b/i,                     'gdpr'],
  [/\bferpa\b/i,                    'ferpa'],
  [/\bfedramp\b/i,                  'fedramp'],
  [/cyber[-_ ]?essentials/i,        'cyber-essentials'],
];

function detectFrameworkTags(text) {
  if (!text) return [];
  const out = new Set();
  for (const [rx, tag] of FRAMEWORK_PATTERNS) if (rx.test(text)) out.add(tag);
  return [...out];
}

// ─── id rewrite helpers ────────────────────────────────────────────────────
const ID_RULES = [
  [/polcsec-(\d+)/g,    (_,n) => `s${n}`],
  [/polcond-(\d+)/g,    (_,n) => `c${n}`],
  [/polstmt-(\d+)-polsubstmt-(\d+)/g, (_,a,b) => `r${a}.${b}`],
  [/polsubstmt-(\d+)/g, (_,n) => `.${n}`], // safety net (shouldn't be reached after the joined rule)
  [/polstmt-(\d+)/g,    (_,n) => `r${n}`],
  [/polrole-(\d+)/g,    (_,n) => `role${n}`],
  [/polresp-(\d+)/g,    (_,n) => `resp${n}`],
  [/polscope-(\d+)/g,   (_,n) => `sc${n}`],
  [/polasn-(\d+)/g,     (_,n) => `x${n}`],
];

function compactRef(s) {
  if (typeof s !== 'string' || !s) return s;
  let out = s;
  for (const [rx, fn] of ID_RULES) out = out.replace(rx, fn);
  return out;
}

// Walk an arbitrary JSON tree and compact every reference-id-like string field.
// We only rewrite values; key names stay the same so consumers find their fields.
const REWRITE_KEYS = new Set([
  'reference-id',
  'parent-reference-id',
  'section-reference-id',
  'condition-reference-id',
  'host-reference-id',
  'related-policy-statement-ids',
  'policy-statement-ids',
]);

function transformValue(v) {
  if (Array.isArray(v)) return v.map(transformValue);
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      if (REWRITE_KEYS.has(k) && typeof val === 'string') {
        out[k] = compactRef(val);
        if (k === 'reference-id' && val) out['legacy-reference-id'] = val;
      } else if (REWRITE_KEYS.has(k) && Array.isArray(val)) {
        out[k] = val.map(compactRef);
      } else {
        out[k] = transformValue(val);
      }
    }
    return out;
  }
  return v;
}

// ─── condition framework-tag annotation ────────────────────────────────────
function annotateConditions(doc) {
  const sections = doc?.policy?.['policy-requirements'];
  if (!Array.isArray(sections)) return;
  for (const sec of sections) {
    const conds = sec['policy-conditions'];
    if (!Array.isArray(conds)) continue;
    for (const cond of conds) {
      const title = cond['policy-condition-title'] || '';
      const tags = detectFrameworkTags(title);
      // Insert near the top of the object for readability.
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.policyOnly) { usage(); process.exit(args.help ? 0 : 2); }
  if (!fs.existsSync(args.policyOnly)) { console.error('not found:', args.policyOnly); process.exit(2); }
  const inDir = path.dirname(path.resolve(args.policyOnly));
  const outDir = args.outDir ? path.resolve(args.outDir) : inDir;
  fs.mkdirSync(outDir, { recursive: true });

  const v2 = JSON.parse(fs.readFileSync(args.policyOnly, 'utf8'));
  const v3 = transformValue(v2);
  v3['schema-version'] = 'v3';
  v3['v2-source-file'] = path.basename(args.policyOnly);
  annotateConditions(v3);

  const base = path.basename(args.policyOnly).replace(/\.json$/i, '');
  const outPath = path.join(outDir, `${base}.v3.json`);
  fs.writeFileSync(outPath, JSON.stringify(v3, null, 2));
  console.log(`wrote: ${outPath}`);

  if (args.complete) {
    if (!fs.existsSync(args.complete)) { console.error('not found:', args.complete); process.exit(2); }
    const cv2 = JSON.parse(fs.readFileSync(args.complete, 'utf8'));
    const cv3 = transformValue(cv2);
    cv3['schema-version'] = 'v3';
    cv3['v2-source-file'] = path.basename(args.complete);
    annotateConditions(cv3);
    const cbase = path.basename(args.complete).replace(/\.json$/i, '');
    const cOut = path.join(outDir, `${cbase}.v3.json`);
    fs.writeFileSync(cOut, JSON.stringify(cv3, null, 2));
    console.log(`wrote: ${cOut}`);
  }
}

main();
