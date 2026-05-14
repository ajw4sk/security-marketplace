#!/usr/bin/env node
/**
 * Policy-to-Controls mapper.
 *
 * Given a parsed policy JSON (v2 or v3 produced by this plugin) and a controls
 * catalog (currently: the NIST Controls and Procedures .xlsx with a "Level 2"
 * sheet), emit a mapping JSON associating each policy statement with the
 * top-scoring catalog controls + their related procedures.
 *
 * Usage:
 *   map_controls.mjs --policy <policy_only.json> --controls <catalog.xlsx>
 *                    [--sheet "Level 2"] [--out <path.json>] [--top 5]
 *                    [--min-score 0.05] [--variant balanced|name-boost|description-only]
 *
 * Output JSON shape:
 *   {
 *     "policy-id", "policy-title", "schema-version-in", "controls-source",
 *     "controls-sheet", "variant", "top", "min-score",
 *     "controls": [{ "control-id", "control-family", "control-name",
 *                    "description", "related-procedure-ids", ... }],
 *     "mappings": [{
 *        "policy-ref-id", "policy-legacy-ref-id", "section", "condition",
 *        "kind", "text", "framework-tags",
 *        "candidates": [{
 *           "control-id", "control-name", "score",
 *           "matched-tokens", "name-hits", "description-hits",
 *           "related-procedure-ids"
 *        }]
 *     }]
 *   }
 *
 * Dependencies: only adm-zip + fast-xml-parser (already in this plugin's deps).
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import AdmZip from 'adm-zip';
import { XMLParser } from 'fast-xml-parser';

// ─── xlsx reader (minimal, no external lib) ──────────────────────────────
function readXlsxSheets(xlsxPath) {
  const zip = new AdmZip(xlsxPath);
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

  // Workbook → list of sheets with name + relId
  const wb = parser.parse(zip.getEntry('xl/workbook.xml').getData().toString('utf8'));
  const wbSheets = wb.workbook.sheets.sheet;
  const sheetsMeta = (Array.isArray(wbSheets) ? wbSheets : [wbSheets]).map((s) => ({
    name: s['@_name'],
    sheetId: s['@_sheetId'],
    rId: s['@_r:id'] || s['@_id'],
  }));

  // rels: rId → target path
  const rels = parser.parse(zip.getEntry('xl/_rels/workbook.xml.rels').getData().toString('utf8'));
  const rArr = rels.Relationships.Relationship;
  const rIdMap = Object.fromEntries((Array.isArray(rArr) ? rArr : [rArr]).map((r) => [r['@_Id'], r['@_Target']]));

  // Shared strings
  const ssEntry = zip.getEntry('xl/sharedStrings.xml');
  let strings = [];
  if (ssEntry) {
    const ss = parser.parse(ssEntry.getData().toString('utf8'));
    const si = ss.sst.si || [];
    strings = (Array.isArray(si) ? si : [si]).map((s) => {
      if (typeof s === 'string') return s;
      if (s.t != null) return typeof s.t === 'string' ? s.t : (s.t['#text'] || '');
      if (s.r) {
        const rs = Array.isArray(s.r) ? s.r : [s.r];
        return rs.map((r) => (typeof r.t === 'string' ? r.t : (r.t?.['#text'] || ''))).join('');
      }
      return '';
    });
  }

  function colNum(ref) {
    const letters = ref.replace(/[0-9]/g, '');
    let n = 0;
    for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n;
  }
  function cellVal(c) {
    if (c == null) return '';
    if (c['@_t'] === 's') return strings[parseInt(c.v, 10)] || '';
    if (c['@_t'] === 'inlineStr') return c.is?.t || '';
    if (c['@_t'] === 'str') return c.v == null ? '' : String(c.v);
    return c.v == null ? '' : String(c.v);
  }

  function readSheet(targetPath) {
    const full = targetPath.startsWith('xl/') ? targetPath : `xl/${targetPath}`;
    const e = zip.getEntry(full);
    if (!e) return [];
    const ws = parser.parse(e.getData().toString('utf8'));
    const rowsRaw = ws.worksheet.sheetData?.row || [];
    const rows = (Array.isArray(rowsRaw) ? rowsRaw : [rowsRaw]);
    const out = [];
    for (const r of rows) {
      const cs = r.c ? (Array.isArray(r.c) ? r.c : [r.c]) : [];
      const row = {};
      for (const c of cs) {
        const ref = c['@_r'] || '';
        const col = colNum(ref);
        row[col] = cellVal(c);
      }
      out.push(row);
    }
    return out;
  }

  function sheetByName(name) {
    const meta = sheetsMeta.find((s) => s.name === name);
    if (!meta) return null;
    const target = rIdMap[meta.rId];
    if (!target) return null;
    return readSheet(target);
  }

  return { sheetsMeta, sheetByName };
}

// ─── controls catalog parser (NIST xlsx, "Level 2" sheet) ────────────────
function loadControlsFromNistXlsx(xlsxPath, sheetName) {
  const { sheetsMeta, sheetByName } = readXlsxSheets(xlsxPath);
  const name = sheetName || 'Level 2';
  const rows = sheetByName(name);
  if (!rows || rows.length === 0) {
    throw new Error(`sheet "${name}" not found or empty in ${xlsxPath} (available: ${sheetsMeta.map((s) => s.name).join(', ')})`);
  }
  // header detection: row 0 has column titles
  const header = rows[0];
  function findCol(re) {
    for (const [k, v] of Object.entries(header)) {
      if (re.test(String(v))) return Number(k);
    }
    return -1;
  }
  const colFamily   = findCol(/control\s*family/i);
  const colSortId   = findCol(/sort\s*id|control\s*id/i);
  const colName     = findCol(/control\s*name/i);
  const colDesc     = findCol(/control\s*description/i);
  const colDiscuss  = findCol(/discussion/i);
  const colRelated  = findCol(/related\s*controls/i);
  const colProc     = findCol(/related\s*procedures$/i);
  const colProcId   = findCol(/related\s*procedure\s*id/i);
  const colParams   = findCol(/tx-?ramp\s*parameters/i);

  if (colSortId < 0 || colName < 0 || colDesc < 0) {
    throw new Error(`could not find required columns in sheet "${name}"`);
  }

  const controls = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const sortId = (row[colSortId] || '').toString().trim();
    if (!sortId) continue;
    let procIds = [];
    try {
      const raw = (row[colProcId] || '').toString().trim();
      if (raw.startsWith('[')) procIds = JSON.parse(raw);
    } catch { /* ignore parse errors */ }
    let procs = [];
    try {
      const raw = (row[colProc] || '').toString().trim();
      if (raw.startsWith('[')) procs = JSON.parse(raw);
    } catch {}
    controls.push({
      'control-id': sortId,
      'control-family': (row[colFamily] || '').toString().trim(),
      'control-name': (row[colName] || '').toString().trim(),
      'description': (row[colDesc] || '').toString().trim(),
      'discussion': colDiscuss >= 0 ? (row[colDiscuss] || '').toString().trim() : '',
      'related-controls': colRelated >= 0 ? (row[colRelated] || '').toString().trim() : '',
      'parameters': colParams >= 0 ? (row[colParams] || '').toString().trim() : '',
      'related-procedures': procs,
      'related-procedure-ids': procIds,
    });
  }
  return controls;
}

// ─── tokenization & scoring ──────────────────────────────────────────────
const STOPWORDS = new Set(`
a about above after again against all am an and any are aren as at be because been
before being below between both but by can cannot could did do does doing don down
during each few for from further had has have having he her here hers herself him
himself his how i if in into is it its itself just like me more most must my myself
no nor not now of off on once only or other our ours ourselves out over own re same
she should so some such than that the their theirs them themselves then there these
they this those through to too under until up very was we were what when where which
while who whom why will with would you your yours yourself yourselves shall must may
might also based using upon e g i e etc within across via define defined including
include includes per via system systems user users symplicity organization
organizational entities information policy policies procedure procedures
`.trim().split(/\s+/));

const SYNONYMS = {
  account: ['accounts'],
  accounts: ['account'],
  logout: ['log-out', 'log-off', 'logoff', 'sign-out'],
  remote: ['remoteaccess', 'tele', 'vpn'],
  wireless: ['wifi', 'wi-fi'],
  privileged: ['privilege'],
  audit: ['audits', 'auditing'],
  disable: ['disabling', 'disabled'],
  enable: ['enabling', 'enabled'],
  least: ['minimum'],
  privilege: ['privileged', 'privileges'],
  separation: ['segregation'],
  duties: ['duty'],
  attribute: ['attributes'],
  role: ['roles', 'rbac'],
  discretionary: ['dac'],
};

function tokenize(text) {
  if (!text) return [];
  const lowered = text.toLowerCase().replace(/\[[^\]]+\]/g, ' ');
  const raw = lowered.match(/[a-z][a-z0-9-]{1,}/g) || [];
  const out = [];
  const seen = new Set();
  for (let t of raw) {
    if (STOPWORDS.has(t)) continue;
    if (t.length < 3) continue;
    if (/^\d+$/.test(t)) continue;
    if (!seen.has(t)) { seen.add(t); out.push(t); }
    const syns = SYNONYMS[t];
    if (syns) for (const s of syns) if (!seen.has(s)) { seen.add(s); out.push(s); }
  }
  return out;
}

function buildControlIndex(controls) {
  // Per control: tokenized name + description + discussion. Also build a
  // global document frequency so we can downweight ubiquitous tokens.
  const df = Object.create(null);
  const indexed = controls.map((c) => {
    const nameTokens = new Set(tokenize(c['control-name']));
    const descTokens = new Set(tokenize(c['description']));
    const discTokens = new Set(tokenize(c['discussion']));
    const all = new Set([...nameTokens, ...descTokens, ...discTokens]);
    for (const t of all) df[t] = (df[t] || 0) + 1;
    return { ...c, _name: nameTokens, _desc: descTokens, _disc: discTokens, _all: all };
  });
  return { indexed, df, N: indexed.length };
}

function score(stmtTokens, control, df, N, variant, sectionTokens) {
  const stmt = new Set(stmtTokens);
  if (!stmt.size) return { score: 0, matched: [], nameHits: [], descHits: [] };
  let s = 0;
  const matched = [];
  const nameHits = [];
  const descHits = [];

  // weights per variant
  let wName, wDesc, wDisc, idfPow, sectionBoost = 0;
  if (variant === 'name-boost')        { wName = 3.0; wDesc = 1.0; wDisc = 0.4; idfPow = 1.0; }
  else if (variant === 'description-only') { wName = 0.0; wDesc = 1.0; wDisc = 0.0; idfPow = 1.0; }
  else if (variant === 'section-aware') { wName = 2.0; wDesc = 1.0; wDisc = 0.5; idfPow = 1.0; sectionBoost = 1.5; }
  else /* balanced (default) */         { wName = 2.0; wDesc = 1.0; wDisc = 0.5; idfPow = 1.0; }

  for (const t of stmt) {
    const idf = Math.log(1 + N / (1 + (df[t] || 0)));
    const w = Math.pow(idf, idfPow);
    if (control._name.has(t)) { s += wName * w; matched.push(t); nameHits.push(t); }
    else if (control._desc.has(t)) { s += wDesc * w; matched.push(t); descHits.push(t); }
    else if (control._disc.has(t)) { s += wDisc * w; matched.push(t); }
  }
  // section-aware: boost when control name overlaps section-title tokens.
  if (sectionBoost && sectionTokens && sectionTokens.length) {
    let overlap = 0;
    for (const t of sectionTokens) if (control._name.has(t)) overlap++;
    if (overlap > 0) s *= (1 + sectionBoost * (overlap / sectionTokens.length));
  }
  // Normalize by total possible if all stmt tokens matched the strongest field.
  const wMax = Math.max(wName, wDesc, wDisc) || 1;
  const maxPossible = stmt.size * wMax * Math.log(1 + N) || 1;
  return { score: s / maxPossible, matched, nameHits, descHits };
}

// ─── policy walker ───────────────────────────────────────────────────────
function walkPolicy(doc) {
  const out = [];
  const policyId = doc['policy-id'];
  const policyTags = doc['framework-tags'] || [];
  const sections = doc?.policy?.['policy-requirements'] || [];
  for (const sec of sections) {
    const sectionInfo = {
      'section-number': sec['section-number'],
      'section-title': sec['section-title'],
      'section-reference-id': sec['reference-id'],
    };

    // Top-level statements (section-type === policy-section/policy-and-procedures)
    const topStmts = sec['policy-statements'] || sec['policy-and-procedures'] || [];
    for (const st of topStmts) {
      out.push({
        kind: 'statement',
        section: sectionInfo,
        condition: null,
        'framework-tags': policyTags,
        'policy-ref-id': st['reference-id'],
        'policy-legacy-ref-id': st['legacy-reference-id'] || st['reference-id'],
        'policy-statement-id': st['policy-statement-id'],
        text: st['policy-statement'] || st['policy-substatement'] || '',
      });
      for (const sub of st['policy-substatements'] || []) {
        out.push({
          kind: 'substatement',
          section: sectionInfo,
          condition: null,
          'framework-tags': policyTags,
          'policy-ref-id': sub['reference-id'],
          'policy-legacy-ref-id': sub['legacy-reference-id'] || sub['reference-id'],
          'policy-statement-id': sub['policy-substatement-id'],
          'parent-ref-id': st['reference-id'],
          text: sub['policy-substatement'] || '',
        });
      }
    }
    // Conditions
    for (const cond of sec['policy-conditions'] || []) {
      const condInfo = {
        'condition-id': cond['policy-condition-id'],
        'condition-title': cond['policy-condition-title'],
        'condition-reference-id': cond['reference-id'],
        'framework-tags': cond['framework-tags'] || [],
        'framework-tags-inherited': cond['framework-tags-inherited'] !== false ? (cond['framework-tags']?.length ? false : true) : false,
      };
      const condTags = (condInfo['framework-tags']?.length ? condInfo['framework-tags'] : policyTags);
      for (const st of cond['policy-statements'] || []) {
        out.push({
          kind: 'condition-statement',
          section: sectionInfo,
          condition: condInfo,
          'framework-tags': condTags,
          'policy-ref-id': st['reference-id'],
          'policy-legacy-ref-id': st['legacy-reference-id'] || st['reference-id'],
          'policy-statement-id': st['policy-statement-id'],
          text: st['policy-statement'] || '',
        });
        for (const sub of st['policy-substatements'] || []) {
          out.push({
            kind: 'condition-substatement',
            section: sectionInfo,
            condition: condInfo,
            'framework-tags': condTags,
            'policy-ref-id': sub['reference-id'],
            'policy-legacy-ref-id': sub['legacy-reference-id'] || sub['reference-id'],
            'policy-statement-id': sub['policy-substatement-id'],
            'parent-ref-id': st['reference-id'],
            text: sub['policy-substatement'] || '',
          });
        }
      }
    }
  }
  return out;
}

// ─── argv ────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = {
    policy: '', controls: '', sheet: 'Level 2', out: '', top: 5,
    minScore: 0.05, variant: 'balanced',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = () => argv[++i];
    if (a === '--policy') out.policy = v();
    else if (a === '--controls') out.controls = v();
    else if (a === '--sheet') out.sheet = v();
    else if (a === '--out') out.out = v();
    else if (a === '--top') out.top = parseInt(v(), 10);
    else if (a === '--min-score') out.minScore = parseFloat(v());
    else if (a === '--variant') out.variant = v();
    else if (a === '--condensed-out') out.condensedOut = v();
    else if (a === '-h' || a === '--help') out.help = true;
  }
  return out;
}

function usage() {
  console.log(`Usage: map_controls.mjs --policy <path.json> --controls <catalog.xlsx>
       [--sheet "Level 2"] [--out <path.json>] [--top 5]
       [--min-score 0.05] [--variant balanced|name-boost|description-only]`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.policy || !args.controls) { usage(); process.exit(args.help ? 0 : 2); }
  if (!fs.existsSync(args.policy)) { console.error('policy not found:', args.policy); process.exit(2); }
  if (!fs.existsSync(args.controls)) { console.error('controls not found:', args.controls); process.exit(2); }

  const doc = JSON.parse(fs.readFileSync(args.policy, 'utf8'));
  const controls = loadControlsFromNistXlsx(args.controls, args.sheet);
  const { indexed, df, N } = buildControlIndex(controls);

  const items = walkPolicy(doc);

  const mappings = [];
  for (const it of items) {
    const stmtTokens = tokenize(it.text);
    if (!stmtTokens.length) continue;
    const sectionTokens = tokenize(it.section?.['section-title'] || '');
    const ranked = [];
    for (const c of indexed) {
      const r = score(stmtTokens, c, df, N, args.variant, sectionTokens);
      if (r.score >= args.minScore) ranked.push({ c, r });
    }
    ranked.sort((a, b) => b.r.score - a.r.score);
    const top = ranked.slice(0, args.top).map(({ c, r }) => ({
      'control-id': c['control-id'],
      'control-family': c['control-family'],
      'control-name': c['control-name'],
      score: +r.score.toFixed(4),
      'matched-tokens': r.matched,
      'name-hits': r.nameHits,
      'description-hits': r.descHits,
      'related-procedure-ids': c['related-procedure-ids'],
    }));
    mappings.push({
      'policy-ref-id': it['policy-ref-id'],
      'policy-legacy-ref-id': it['policy-legacy-ref-id'],
      'section': it.section,
      'condition': it.condition,
      'kind': it.kind,
      'framework-tags': it['framework-tags'],
      'text': it.text,
      'tokens': stmtTokens,
      'candidates': top,
    });
  }

  const outDoc = {
    'schema-version': 'map-v1',
    'policy-id': doc['policy-id'],
    'policy-title': doc['policy-title'],
    'schema-version-in': doc['schema-version'],
    'controls-source': path.basename(args.controls),
    'controls-sheet': args.sheet,
    'controls-count': controls.length,
    'variant': args.variant,
    'top': args.top,
    'min-score': args.minScore,
    'controls': controls.map((c) => ({
      'control-id': c['control-id'],
      'control-family': c['control-family'],
      'control-name': c['control-name'],
      'description': c['description'],
      'related-controls': c['related-controls'],
      'related-procedures': c['related-procedures'],
      'related-procedure-ids': c['related-procedure-ids'],
      'parameters': c['parameters'],
    })),
    'mappings': mappings,
  };

  // Summary stats
  const counts = { with: 0, without: 0 };
  for (const m of mappings) (m.candidates.length ? counts.with++ : counts.without++);
  outDoc.summary = {
    'mappings-total': mappings.length,
    'with-candidates': counts.with,
    'without-candidates': counts.without,
    'avg-top-score': mappings.length ? +(mappings.reduce((s, m) => s + (m.candidates[0]?.score || 0), 0) / mappings.length).toFixed(4) : 0,
  };

  if (args.out) {
    fs.writeFileSync(args.out, JSON.stringify(outDoc, null, 2));
    console.error(`wrote: ${args.out}`);
    console.error(`mappings: ${mappings.length}  with-candidates: ${counts.with}  avg-top-score: ${outDoc.summary['avg-top-score']}`);
  } else if (!args.condensedOut) {
    process.stdout.write(JSON.stringify(outDoc, null, 2));
  }

  // Condensed best-pick output (one row per policy statement, top-1 control).
  if (args.condensedOut) {
    const condensed = {
      'schema-version': 'map-condensed-v1',
      'policy-id': doc['policy-id'],
      'policy-title': doc['policy-title'],
      'controls-source': path.basename(args.controls),
      'controls-sheet': args.sheet,
      'variant': args.variant,
      'controls-count': controls.length,
      'mappings-total': mappings.length,
      'best-picks': mappings.map((m) => {
        const top = m.candidates[0];
        return {
          'policy-ref-id': m['policy-ref-id'],
          'policy-legacy-ref-id': m['policy-legacy-ref-id'],
          'section-number': m.section?.['section-number'],
          'section-title': m.section?.['section-title'],
          'section-ref-id': m.section?.['section-reference-id'],
          'condition-id': m.condition?.['condition-id'] || null,
          'condition-title': m.condition?.['condition-title'] || null,
          'condition-ref-id': m.condition?.['condition-reference-id'] || null,
          'framework-tags': m['framework-tags'],
          'kind': m.kind,
          'text': m.text,
          'control-id': top?.['control-id'] || null,
          'control-family': top?.['control-family'] || null,
          'control-name': top?.['control-name'] || null,
          'score': top?.score ?? 0,
          'related-procedure-ids': top?.['related-procedure-ids'] || [],
        };
      }),
    };
    fs.writeFileSync(args.condensedOut, JSON.stringify(condensed, null, 2));
    console.error(`wrote condensed: ${args.condensedOut}`);
  }
}

main();
