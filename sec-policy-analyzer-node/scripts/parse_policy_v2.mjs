#!/usr/bin/env node
/**
 * AI-Free Policy Parser — v2 (Node port)
 *
 * Same CLI surface and JSON/CSV output shape as the Python parser shipped by
 * the sec-policy-analyzer plugin. Reads .docx via adm-zip and parses
 * word/document.xml with fast-xml-parser.
 *
 * Behavior preserved from the Python parser:
 *   - pol* id family (polcsec/polstmt/polsubstmt/polcond/polasn/polrole/polresp/polscope)
 *   - reference-id with full ancestor chain on every non-top-level object
 *   - 7 default sections always present (purpose..policy-and-procedures)
 *   - *** delimited conditions + legacy unwrapped "Policy conditions for X" trigger
 *   - Lead-in scrubbing (Symplicity shall:, {{organization.name}} shall:)
 *   - Bracketed selectors (priority 0) + curated inline patterns
 *   - scopes[] and assets{personnel,infrastructure,applications} on every
 *     statement-shaped object (always emitted)
 *   - --policy-map mode: collapses 8 inline linkage fields into policy-map-id
 *   - --csv-output flat CSV with the same column schema
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import AdmZip from 'adm-zip';
import { XMLParser } from 'fast-xml-parser';

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const DEFAULT_SECTION_TYPES = [
  [1, 'purpose',                                       'Purpose'],
  [2, 'scope',                                         'Scope'],
  [3, 'roles-and-responsibilities',                    'Roles and Responsibilities'],
  [4, 'management-commitment',                         'Management Commitment'],
  [5, 'coordination-among-organizational-entities',    'Coordination Among Other Organization Entities'],
  [6, 'compliance',                                    'Compliance'],
  [7, 'policy-and-procedures',                         'Policy and Procedures'],
];

// Whole-line lead-ins to drop. NOTE: this only matches lines that are EXACTLY
// "Symplicity shall(:)" or "{{organization.name}} shall(:)" — substantive
// sentences ending in "shall:" are preserved.
const SHALL_LEAD_IN_RE = /^\s*(?:symplicity|\{\{organization\.name\}\})\s+shall\s*[:,]?\s*$/i;
const SECTION_HEADING_RE = /^(\d+(?:\.\d+)*)\s+(.+)$/;
const POLICY_CONDITION_RE = /^\s*policy\s+conditions?\s+for\b/i;
const CONDITION_DELIM_RE  = /^\s*\*{3,}\s*$/;
const SELECTOR_RE = /\[([^\[\]]+?)\]/g;

const SPELLED_NUMBER =
  'zero|one|two|three|four|five|six|seven|eight|nine|ten|' +
  'eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|' +
  'twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety';

/**
 * Curated inline-assignment patterns. Each entry: { rx, type, name, prio }.
 * Lower prio wins on overlap (bracketed = 0 by convention).
 */
const INLINE_SELECTOR_SPECS = [
  { rx: new RegExp(`\\b(?:${SPELLED_NUMBER})\\s*\\(\\d+\\)`, 'gi'),                     type: 'numeric-value',             name: 'numeric value',         prio: 1 },
  { rx: /\b(?:a|the)\s+defined\s+number\b/gi,                                            type: 'defined-number',            name: 'defined number',        prio: 2 },
  { rx: /\b(?:a|the)\s+defined\s+period(?:\s+of\s+\w+)?\b/gi,                            type: 'defined-period',            name: 'defined period',        prio: 3 },
  { rx: /\bperiodically\b/gi,                                                            type: 'frequency-periodic',        name: 'frequency',             prio: 4 },
  { rx: /\bas\s+applicable\b/gi,                                                         type: 'applicability-conditional', name: 'applicability condition', prio: 5 },
  { rx: /\bwhen(?:ever)?\s+possible\b/gi,                                                type: 'applicability-conditional', name: 'applicability condition', prio: 6 },
  { rx: /\b(?:where|as)\s+appropriate\b/gi,                                              type: 'applicability-conditional', name: 'applicability condition', prio: 7 },
  { rx: /\bif\s+necessary\b/gi,                                                          type: 'applicability-conditional', name: 'applicability condition', prio: 8 },
];

const FRAMEWORK_PATTERNS = [
  [/\bnist[-_ ]?800[-_ ]?53\b/i,    'nist-800-53'],
  [/\bnist[-_ ]?800[-_ ]?171\b/i,   'nist-800-171'],
  [/\bnist[-_ ]?800[-_ ]?172\b/i,   'nist-800-172'],
  [/\bnist\b/i,                     'nist'],
  [/\biso[-_ ]?27018\b/i,           'iso-27018'],
  [/\biso[-_ ]?27001\b/i,           'iso-27001'],
  [/\biso\b/i,                      'iso-27001'],
  [/\bsoc[-_ ]?2\b/i,               'soc-2'],
  [/\bsoc\b/i,                      'soc-2'],
  [/\bpci[-_ ]?dss\b/i,             'pci-dss'],
  [/\bpci\b/i,                      'pci-dss'],
  [/\bcmmc\b/i,                     'cmmc'],
  [/\bhipaa\b/i,                    'hipaa'],
  [/\bgdpr\b/i,                     'gdpr'],
  [/\bferpa\b/i,                    'ferpa'],
  [/cyber[-_ ]?essentials/i,        'cyber-essentials'],
];

const SCOPE_INTRODUCER_RE = /\b(covers|applies\s+to|includes|extends\s+to|encompasses|governs)\b\s+([\s\S]+?)(?:\.|$)/gi;
const SCOPE_PREFIX_TRIM    = /^(?:access\s+to|use\s+of|all\s+aspects\s+of|the\s+use\s+of|every)\s+/i;
const SCOPE_LEADING_ARTICLES = /^(?:the|a|an|any|other)\s+/i;
const SCOPE_SUBORDINATE_RE = /,\s*whether\s+[^,]+(?=,)/gi;
const SCOPE_CATEGORY_RULES = [
  [/\b(systems?|resources?|applications?|infrastructure|networks?|assets?|servers?|databases?|endpoints?|devices?)\b/i, 'system'],
  [/\b(employees?|contractors?|vendors?|users?|individuals?|personnel|staff|workers?|consultants?|interns?)\b/i,         'actor'],
  [/\b(facilit(?:y|ies)|premises?|locations?|sites?|offices?)\b/i,                                                       'location'],
  [/\b(processes?|operations?|activit(?:y|ies)|workflows?|services?)\b/i,                                                'process'],
  [/\b(data|information|records?|content|documents?)\b/i,                                                                'data'],
  [/\b(third[\s-]?part(?:y|ies)|partners?|suppliers?)\b/i,                                                               'third-party'],
];

let USE_POLICY_MAP = false;

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

const slugify = (s) => (String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'policy');

const detectFrameworks = (...texts) => {
  const found = [];
  for (const t of texts) {
    if (!t) continue;
    for (const [rx, slug] of FRAMEWORK_PATTERNS) {
      if (rx.test(t) && !found.includes(slug)) found.push(slug);
    }
  }
  return found;
};

const derivePolicyId = (docxPath, title, explicitId) => {
  if (explicitId) return [slugify(explicitId), 'cli'];
  const stem = path.basename(docxPath, path.extname(docxPath));
  const stemSlug = slugify(stem);
  if (stemSlug && stemSlug !== 'policy') return [stemSlug, 'filename'];
  if (title) return [slugify(title), 'title'];
  return ['policy', 'default'];
};

const emptyAssets = () => ({ personnel: {}, infrastructure: {}, applications: {} });

const emptyLinkage = () => {
  const base = { scopes: [], assets: emptyAssets() };
  if (USE_POLICY_MAP) { base['policy-map-id'] = ''; return base; }
  return Object.assign(base, {
    'mapped-controls': [],
    'evidence-tasks': [],
    'security-portal-ids': [],
    'privacy-portal-ids': [],
    'jira-projects': [],
    'jira-project-id': '',
    'jira-components': [],
    'related-policy-statement-ids': [],
  });
};

const joinLines = (lines) => {
  const cleaned = lines.map((l) => String(l || '').trim()).filter(Boolean);
  return cleaned.length ? cleaned.join('\n') : null;
};

// ────────────────────────────────────────────────────────────────────────────
// .docx → paragraphs (text + ilvl + heading-level)
// ────────────────────────────────────────────────────────────────────────────

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  preserveOrder: true,
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
});

/**
 * Walk a fast-xml-parser preserveOrder tree, collecting paragraphs with:
 *   { text, ilvl, headingLevel }
 *
 * The tree is an array of nodes; each node is an object with a single tag key
 * whose value is either a string (text) or an array of child nodes.
 */
function extractParagraphs(docxPath) {
  const zip = new AdmZip(docxPath);
  const docXml = zip.readAsText('word/document.xml');
  if (!docXml) throw new Error(`word/document.xml missing in ${docxPath}`);
  const tree = xmlParser.parse(docXml);

  const paragraphs = [];

  const tagOf = (node) => Object.keys(node).find((k) => k !== ':@' && !k.startsWith('@_'));
  const childrenOf = (node) => {
    const tag = tagOf(node);
    const v = node[tag];
    return Array.isArray(v) ? v : [];
  };

  // recursive walk to collect <w:p> nodes anywhere (handles tables, sdt, etc.)
  function walkForParagraphs(nodes) {
    for (const node of nodes || []) {
      const tag = tagOf(node);
      if (tag === 'p') {
        paragraphs.push(parseParagraph(node));
        continue;
      }
      walkForParagraphs(childrenOf(node));
    }
  }

  function parseParagraph(pNode) {
    const kids = childrenOf(pNode);
    let textBuf = '';
    let ilvl = null;
    let headingLevel = null;

    for (const child of kids) {
      const tag = tagOf(child);
      if (tag === 'pPr') {
        for (const pp of childrenOf(child)) {
          const ppTag = tagOf(pp);
          if (ppTag === 'pStyle') {
            const val = (pp[':@'] || {})['@_val'] || '';
            const m = /^Heading(\d+)$/.exec(val);
            if (m) headingLevel = parseInt(m[1], 10);
            else if (val === 'Title') headingLevel = 0;
          } else if (ppTag === 'numPr') {
            for (const np of childrenOf(pp)) {
              const npTag = tagOf(np);
              if (npTag === 'ilvl') {
                const v = (np[':@'] || {})['@_val'];
                ilvl = v != null ? parseInt(v, 10) : 0;
              }
            }
            if (ilvl == null) ilvl = 0;
          }
        }
      } else if (tag === 'r') {
        for (const rChild of childrenOf(child)) {
          const rTag = tagOf(rChild);
          if (rTag === 't') {
            const val = rChild[rTag];
            if (Array.isArray(val)) {
              for (const sub of val) {
                if (sub['#text']) textBuf += String(sub['#text']);
              }
            } else if (typeof val === 'string') {
              textBuf += val;
            }
          } else if (rTag === 'tab') {
            textBuf += '\t';
          } else if (rTag === 'br') {
            textBuf += '\n';
          }
        }
      } else if (tag === 'hyperlink') {
        // hyperlink runs nest <w:r> children
        for (const hChild of childrenOf(child)) {
          if (tagOf(hChild) === 'r') {
            for (const rChild of childrenOf(hChild)) {
              if (tagOf(rChild) === 't') {
                const val = rChild['t'];
                if (Array.isArray(val)) {
                  for (const sub of val) if (sub['#text']) textBuf += String(sub['#text']);
                } else if (typeof val === 'string') textBuf += val;
              }
            }
          }
        }
      }
    }

    return { text: textBuf, ilvl, headingLevel };
  }

  // top of tree: skip xml declaration node, descend into <w:document>/<w:body>
  for (const top of tree) {
    const tag = tagOf(top);
    if (tag === 'document') {
      for (const docChild of childrenOf(top)) {
        if (tagOf(docChild) === 'body') walkForParagraphs(childrenOf(docChild));
      }
    }
  }

  return paragraphs;
}

function parseDocxIntoSections(docxPath) {
  const paragraphs = extractParagraphs(docxPath);
  let title = '';
  const sections = [];
  let current = null;

  for (const p of paragraphs) {
    const text = (p.text || '').trim();
    if (!text) continue;
    const h = p.headingLevel;

    if (h === 1 && !title) { title = text; continue; }

    if (h === 2 || h === 3) {
      if (current) sections.push(current);
      const m = SECTION_HEADING_RE.exec(text);
      const number      = m ? m[1] : '';
      const headingTitle = m ? m[2].trim() : text;
      current = { number, title: headingTitle, headingLevel: h, paragraphs: [] };
      continue;
    }

    if (!current) current = { number: '', title: 'Preamble', headingLevel: 0, paragraphs: [] };
    current.paragraphs.push({ text, ilvl: p.ilvl });
  }

  if (current) sections.push(current);
  return [title, sections];
}

// ────────────────────────────────────────────────────────────────────────────
// Section helpers
// ────────────────────────────────────────────────────────────────────────────

const findRawSection = (sections, pattern) => {
  const rx = pattern instanceof RegExp ? pattern : new RegExp(pattern, 'i');
  for (const s of sections) if (rx.test(s.title)) return s;
  return null;
};

const extractSimpleSection = (sections, pattern) => {
  const s = findRawSection(sections, pattern);
  if (!s) return '';
  return s.paragraphs.map((p) => p.text).join('\n') || '';
};

function categorizeScope(itemText) {
  for (const [rx, label] of SCOPE_CATEGORY_RULES) if (rx.test(itemText)) return label;
  return null;
}

function extractScopes(scopeStatement, scopeSectionReferenceId) {
  if (!scopeStatement) return [];
  let cleaned = scopeStatement;
  cleaned = cleaned.replace(/\([^)]*\)/g, '');
  cleaned = cleaned.replace(SCOPE_SUBORDINATE_RE, '');
  cleaned = cleaned.replace(/\bwhether\s+[^,\.]+/gi, '');
  cleaned = cleaned.replace(/\s+/g, ' ');

  const items = [];
  const seen = new Set();
  let nextIdx = 1;

  for (const m of cleaned.matchAll(SCOPE_INTRODUCER_RE)) {
    const introducer = m[1].trim().toLowerCase().replace(/\s+/g, ' ');
    let listText = m[2].trim().replace(/[,.;]+$/, '');
    listText = listText.replace(SCOPE_PREFIX_TRIM, '');
    listText = listText.replace(/^all\s+(?=\w)/i, '');

    const parts = listText.split(/\s*,\s*(?:and\s+)?|\s+and\s+/);
    for (const raw of parts) {
      let item = raw.trim().replace(/[,.;:]+$/, '');
      item = item.replace(SCOPE_LEADING_ARTICLES, '');
      item = item.replace(/^all\s+/i, '');
      item = item.trim();
      if (!item || item.length < 3) continue;
      if (/^(?:and|or|the|a|an|any|all|other)$/i.test(item)) continue;
      const key = item.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      const localId = `polscope-${nextIdx}`;
      items.push({
        'scope-id': localId,
        'reference-id': `${scopeSectionReferenceId}-${localId}`,
        'scope-item': item,
        category: categorizeScope(item),
        introducer,
        'matched-text': raw.trim(),
      });
      nextIdx++;
    }
  }
  return items;
}

// ────────────────────────────────────────────────────────────────────────────
// Selector replacement
// ────────────────────────────────────────────────────────────────────────────

function findAllSelectorMatches(text) {
  const matches = [];
  for (const m of text.matchAll(SELECTOR_RE)) {
    const phrase = m[1].trim();
    matches.push({ start: m.index, end: m.index + m[0].length, style: 'bracketed', type: slugify(phrase), name: phrase, prio: 0 });
  }
  for (const spec of INLINE_SELECTOR_SPECS) {
    spec.rx.lastIndex = 0;
    for (const m of text.matchAll(spec.rx)) {
      matches.push({ start: m.index, end: m.index + m[0].length, style: 'inline', type: spec.type, name: spec.name, prio: spec.prio });
    }
  }
  matches.sort((a, b) => a.start - b.start || a.prio - b.prio);
  const filtered = [];
  let lastEnd = -1;
  for (const m of matches) {
    if (m.start >= lastEnd) { filtered.push(m); lastEnd = m.end; }
  }
  return filtered;
}

function replaceSelectors(text, ctx) {
  const matches = findAllSelectorMatches(text || '');
  if (!matches.length) return text;
  const out = [];
  let pos = 0;
  let n = 0;
  for (const m of matches) {
    out.push(text.slice(pos, m.start));
    n += 1;
    const placeholder = `[x${n}]`;
    out.push(placeholder);
    const originalSpan = text.slice(m.start, m.end);
    const localSid = `polasn-${n}`;
    const record = {
      'selector-id': localSid,
      'reference-id': `${ctx.hostReferenceId}-${localSid}`,
      'policy-id': ctx.policyId,
      'policy-section-id': ctx.sectionId,
      'policy-statement-id': ctx.statementId,
      'policy-substatement-id': ctx.substatementId,
      'policy-condition-id': ctx.conditionId,
      'host-id': ctx.hostId,
      'host-reference-id': ctx.hostReferenceId,
      placeholder,
      'selector-style': m.style,
      'selector-type': m.type,
      selector: m.style === 'inline' ? m.name : originalSpan.replace(/^\[|\]$/g, ''),
      'matched-text': originalSpan,
    };
    if (m.style === 'inline' && m.type === 'numeric-value') {
      const paren = /\((\d+)\)/.exec(originalSpan);
      if (paren) record['numeric-value'] = parseInt(paren[1], 10);
    }
    ctx.selectorsOut.push(record);
    pos = m.end;
  }
  out.push(text.slice(pos));
  return out.join('');
}

// ────────────────────────────────────────────────────────────────────────────
// Builders: roles, statements, conditions, sections
// ────────────────────────────────────────────────────────────────────────────

function buildRoles(raw, sectionReferenceId) {
  if (!raw || !raw.paragraphs?.length) return null;
  const roles = [];
  let idx = 0;
  for (const para of raw.paragraphs) {
    const text = para.text;
    if (SHALL_LEAD_IN_RE.test(text)) continue;
    idx += 1;
    const roleLocal = `polrole-${idx}`;
    roles.push({
      'role-id': roleLocal,
      'resp-id': `polresp-${idx}`,
      'reference-id': `${sectionReferenceId}-${roleLocal}`,
      role: '',
      responsibility: text,
    });
  }
  return roles.length ? roles : null;
}

function splitSectionByConditions(raw) {
  const chunks = [];
  let state = 'main';
  let curTitle = null;
  let curParas = [];
  const flush = () => {
    if (curParas.length || curTitle != null) chunks.push([curTitle, curParas.slice()]);
    curTitle = null;
    curParas = [];
  };
  for (const para of raw.paragraphs) {
    const text = para.text;
    if (CONDITION_DELIM_RE.test(text)) {
      flush();
      state = state === 'main' ? 'cond' : 'main';
      continue;
    }
    if (state === 'cond') {
      if (curTitle == null && POLICY_CONDITION_RE.test(text)) { curTitle = text.trim(); continue; }
      curParas.push(para);
      continue;
    }
    if (POLICY_CONDITION_RE.test(text)) {
      flush();
      curTitle = text.trim();
      state = 'cond';
      continue;
    }
    curParas.push(para);
  }
  flush();
  return chunks;
}

function buildStatementsBlock(paragraphs, ctx) {
  if (!paragraphs?.length) return null;
  const { policyId, sectionId, sectionReferenceId, parentReferenceId, conditionId, selectorsOut } = ctx;

  const statements = [];
  let stmtCounter = 0;
  let currentStmt = null;
  let currentStmtLocal = null;
  let currentStmtRef = null;

  const makeStmt = (text) => {
    stmtCounter += 1;
    currentStmtLocal = `polstmt-${stmtCounter}`;
    currentStmtRef   = `${parentReferenceId}-${currentStmtLocal}`;
    const replaced = replaceSelectors(text, {
      policyId, sectionId,
      sectionReferenceId,
      statementId: currentStmtLocal,
      substatementId: null,
      conditionId,
      hostId: currentStmtLocal,
      hostReferenceId: currentStmtRef,
      selectorsOut,
    });
    return Object.assign({
      'policy-statement-id': currentStmtLocal,
      'reference-id': currentStmtRef,
      'policy-statement': replaced,
    }, emptyLinkage());
  };

  for (const para of paragraphs) {
    const text = para.text;
    const ilvl = para.ilvl;
    if (SHALL_LEAD_IN_RE.test(text)) continue;

    if (ilvl == null || ilvl === 0) {
      currentStmt = makeStmt(text);
      statements.push(currentStmt);
    } else {
      if (!currentStmt || !currentStmtRef) {
        currentStmt = makeStmt(text);
        statements.push(currentStmt);
        continue;
      }
      const subs = (currentStmt['policy-substatements'] ||= []);
      const subIdx = subs.length + 1;
      const subLocal = `polsubstmt-${subIdx}`;
      const subRef   = `${currentStmtRef}-${subLocal}`;
      const replaced = replaceSelectors(text, {
        policyId, sectionId,
        sectionReferenceId,
        statementId: currentStmtLocal,
        substatementId: subLocal,
        conditionId,
        hostId: subLocal,
        hostReferenceId: subRef,
        selectorsOut,
      });
      subs.push(Object.assign({
        'policy-substatement-id': subLocal,
        'reference-id': subRef,
        'policy-substatement': replaced,
      }, emptyLinkage()));
    }
  }
  return statements.length ? statements : null;
}

function buildDefaultSection({ policyId, sectIndex, sectionType, canonicalTitle, raw, selectorsOut }) {
  const sectLocal = `polcsec-${sectIndex}`;
  const sectRef   = `${policyId}-${sectLocal}`;
  const base = {
    'sect-id': sectLocal,
    'reference-id': sectRef,
    'section-number': raw?.number || '',
    'section-title': raw?.title || canonicalTitle,
    'section-type': sectionType,
  };
  const paras = raw?.paragraphs || [];

  if (sectionType === 'purpose') {
    base['purpose'] = joinLines(paras.map((p) => p.text));
  } else if (sectionType === 'scope') {
    const scopeText = joinLines(paras.map((p) => p.text));
    base['scope']  = scopeText;
    base['scopes'] = extractScopes(scopeText, sectRef).length ? extractScopes(scopeText, sectRef) : null;
  } else if (sectionType === 'roles-and-responsibilities') {
    base['roles-and-responsibilities'] = buildRoles(raw, sectRef);
  } else if (sectionType === 'management-commitment') {
    base['management-commitment'] = joinLines(paras.map((p) => p.text));
  } else if (sectionType === 'coordination-among-organizational-entities') {
    base['coordination-among-organizational-entities'] = joinLines(paras.map((p) => p.text));
  } else if (sectionType === 'compliance') {
    base['compliance'] = joinLines(paras.map((p) => p.text));
  } else if (sectionType === 'policy-and-procedures') {
    base['policy-and-procedures'] = buildStatementsBlock(paras, {
      policyId,
      sectionId: sectLocal,
      sectionReferenceId: sectRef,
      parentReferenceId: sectRef,
      conditionId: null,
      selectorsOut,
    });
  }
  return base;
}

function buildNumberedPolicySection(raw, { policyId, sectIndex, selectorsOut }) {
  const sectLocal = `polcsec-${sectIndex}`;
  const sectRef   = `${policyId}-${sectLocal}`;
  const chunks = splitSectionByConditions(raw);

  const bodyParas = [];
  const conditionChunks = [];
  for (const [cTitle, cParas] of chunks) {
    if (cTitle == null) bodyParas.push(...cParas);
    else conditionChunks.push([cTitle, cParas]);
  }

  const statements = buildStatementsBlock(bodyParas, {
    policyId,
    sectionId: sectLocal,
    sectionReferenceId: sectRef,
    parentReferenceId: sectRef,
    conditionId: null,
    selectorsOut,
  });

  const conditions = [];
  let cIdx = 0;
  for (const [cTitle, cParas] of conditionChunks) {
    cIdx += 1;
    const condLocal = `polcond-${cIdx}`;
    const condRef   = `${sectRef}-${condLocal}`;
    const condStmts = buildStatementsBlock(cParas, {
      policyId,
      sectionId: sectLocal,
      sectionReferenceId: sectRef,
      parentReferenceId: condRef,
      conditionId: condLocal,
      selectorsOut,
    });
    conditions.push(Object.assign({
      'policy-condition-id': condLocal,
      'reference-id': condRef,
      'policy-condition-title': cTitle,
      'policy-statements': condStmts,
    }, emptyLinkage()));
  }

  return {
    'sect-id': sectLocal,
    'reference-id': sectRef,
    'section-number': raw.number || '',
    'section-title': raw.title || '',
    'section-type': 'policy-section',
    'policy-statements': statements,
    'policy-conditions': conditions.length ? conditions : null,
  };
}

function buildPolicyRequirements(sections, policyId) {
  const selectorsBySection = {};
  const selectorsFor = (sectLocal) => (selectorsBySection[sectLocal] ||= []);

  const rawPurpose    = findRawSection(sections, /\bpurpose\b|\bobjective\b/i);
  const rawScope      = findRawSection(sections, /\bscope\b/i);
  const rawRoles      = findRawSection(sections, /\broles\b.*\bresponsibilit/i);
  const rawMgmt       = findRawSection(sections, /management.?commitment/i);
  const rawCoord      = findRawSection(sections, /coordination/i);
  const rawCompliance = findRawSection(sections, /\bcompliance\b|enforcement/i);
  const rawPap        = findRawSection(sections, /policy\s+and\s+procedures?/i) || findRawSection(sections, /^policy$/i);

  const consumed = new Set([rawPurpose, rawScope, rawRoles, rawMgmt, rawCoord, rawCompliance, rawPap].filter(Boolean));

  const requirements = [];
  const rawByIdx = { 1: rawPurpose, 2: rawScope, 3: rawRoles, 4: rawMgmt, 5: rawCoord, 6: rawCompliance, 7: rawPap };

  for (const [idx, sectionType, canonical] of DEFAULT_SECTION_TYPES) {
    const sectLocal = `polcsec-${idx}`;
    requirements.push(buildDefaultSection({
      policyId,
      sectIndex: idx,
      sectionType,
      canonicalTitle: canonical,
      raw: rawByIdx[idx],
      selectorsOut: selectorsFor(sectLocal),
    }));
  }

  let sectIdx = 8;
  for (const s of sections) {
    if (consumed.has(s)) continue;
    if (!s.number) continue;
    const titleL = s.title.toLowerCase();
    if (['version history', 'approval', 'revision history'].some((t) => titleL.includes(t))) continue;
    const sectLocal = `polcsec-${sectIdx}`;
    requirements.push(buildNumberedPolicySection(s, { policyId, sectIndex: sectIdx, selectorsOut: selectorsFor(sectLocal) }));
    sectIdx += 1;
  }

  for (const k of Object.keys(selectorsBySection)) {
    if (!selectorsBySection[k].length) delete selectorsBySection[k];
  }
  return [requirements, { 'by-section': selectorsBySection }];
}

// ────────────────────────────────────────────────────────────────────────────
// Top-level JSON
// ────────────────────────────────────────────────────────────────────────────

function generateSummary(sections, metadata) {
  const purpose = extractSimpleSection(sections, /\bpurpose\b|\bobjective\b/i);
  if (purpose) {
    const sentences = purpose.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);
    if (sentences.length) return sentences.slice(0, 2).join('. ') + '.';
  }
  return `This policy defines ${metadata['policy-title'] || 'the standards'} for ${metadata['category'] || 'the organization'}.`;
}

function buildPoliciesOnlyJson({ metadata, title, sections, baseName, policyId, policyIdSource, frameworkTags }) {
  const [requirements, selectorsIndex] = buildPolicyRequirements(sections, policyId);

  const out = {
    'schema-version': 'v2',
    'policy-id': policyId,
    'policy-id-source': policyIdSource,
    'framework-tags': frameworkTags,
  };
  if (USE_POLICY_MAP) {
    out['policy-map'] = {
      entries: {},
      controls: {},
      'evidence-tasks': {},
      'security-portal': {},
      'privacy-portal': {},
      'jira-projects': {},
      'jira-components': {},
    };
  }

  const scopeStatement = metadata['scope-statement'] || extractSimpleSection(sections, /\bscope\b/i);

  Object.assign(out, {
    'policy-title': metadata['policy-title'] || title,
    'policies-only-file': `${baseName}_only.json`,
    'associated-controls-file': `${baseName}_associated_controls.json`,
    'category': metadata['category'] || '',
    'status': metadata['status'] || 'draft',
    'jira-policy-id': metadata['jira-policy-id'] || '',
    'next-review-date': metadata['next-review-date'] || '',
    'latest-policy-review-date': metadata['latest-policy-review-date'] || '',
    'assignees': metadata['assignees'] || [],
    'reviewers': metadata['reviewers'] || [],
    'audits': metadata['audits'] || [],
    'frameworks': (metadata['frameworks'] && metadata['frameworks'].length) ? metadata['frameworks'] : frameworkTags,
    'toc': sections.map((s) => `${s.number} ${s.title}`.trim()),
    'summary': generateSummary(sections, metadata),
    'policy': {
      'introduction': extractSimpleSection(sections, /introduction/i),
      'purpose':       extractSimpleSection(sections, /\bpurpose\b|\bobjective\b/i),
      'scope': {
        'scope-statement': scopeStatement,
        'scopes': extractScopes(scopeStatement, `${policyId}-polcsec-2`),
        'products': metadata['products'] || [],
        'regions':  metadata['regions']  || [],
        'visibility': metadata['visibility'] || 'internal',
      },
      'roles-and-responsibilities': {
        'applicability': metadata['applicability'] || '',
        'responsibilities': metadata['roles-and-responsibilities'] || [],
      },
      'management-commitment': extractSimpleSection(sections, /management.?commitment/i),
      'authority':            extractSimpleSection(sections, /\bauthority\b/i),
      'compliance':           extractSimpleSection(sections, /\bcompliance\b|enforcement/i),
      'policy-requirements': requirements,
      'policy-exceptions': metadata['policy-exceptions'] || [],
    },
    'assignment-selectors': selectorsIndex,
    'policy-version-history': metadata['policy-version-history'] || [],
  });

  return out;
}

function loadControls(filepath) {
  const raw = fs.readFileSync(filepath, 'utf-8');
  const lines = raw.replace(/\r\n/g, '\n').split('\n').filter(Boolean);
  if (!lines.length) return [];
  // simple CSV split (matches python csv.DictReader behavior for these files)
  const splitRow = (line) => {
    const out = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQuotes) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i += 1; }
        else if (c === '"') inQuotes = false;
        else cur += c;
      } else {
        if (c === ',') { out.push(cur); cur = ''; }
        else if (c === '"') inQuotes = true;
        else cur += c;
      }
    }
    out.push(cur);
    return out;
  };
  const headers = splitRow(lines[0]);
  return lines.slice(1).map((ln) => {
    const cells = splitRow(ln);
    const o = {};
    headers.forEach((h, i) => { o[h] = cells[i] ?? ''; });
    return o;
  });
}

function mapControlsToPolicy(category, controls) {
  if (!category) return [];
  const out = [];
  for (const c of controls) {
    const policiesField = c['Policies'] || '';
    if (!policiesField.toLowerCase().includes(category.toLowerCase())) continue;
    const tugboatId = c['ID'] || '';
    out.push({
      frameworks: ['iso-27001'],
      title: c['Name'] || '',
      'certification-automation-id': c['Certification Automation ID #'] || '',
      'tugboat-id': tugboatId,
      code: c['Framework Codes'] || '',
      'jira-control-id': '',
      description: c['Description'] || '',
      'tugboat-url': tugboatId ? `https://my.tugboatlogic.com/org/13756/controls/${tugboatId}` : '',
      'related-evidence-tasks': [],
    });
  }
  return out;
}

function buildAssociatedControlsJson(metadata, controls, title, baseName, policyId) {
  return {
    'schema-version': 'v2',
    'policy-id': policyId,
    'policy-file': `${baseName}_only.json`,
    'policy-title': metadata['policy-title'] || title,
    'policy-category': metadata['category'] || '',
    'frameworks': metadata['frameworks'] || [],
    'associated-controls': controls,
  };
}

function buildCompleteAssociationsJson(policiesOnly, controlsJson) {
  const complete = { ...policiesOnly };
  complete['associated-controls'] = controlsJson['associated-controls'] || [];
  return complete;
}

// ────────────────────────────────────────────────────────────────────────────
// CSV emitter
// ────────────────────────────────────────────────────────────────────────────

const CSV_HEADERS = [
  'policy-id',
  'framework-tags',
  'section-id',
  'section-reference-id',
  'section-number',
  'section-title',
  'section-type',
  'condition-id',
  'condition-reference-id',
  'condition-title',
  'parent-statement-id',
  'parent-reference-id',
  'kind',
  'local-id',
  'reference-id',
  'text',
  'assignment-selectors',
  'scopes',
  'assets-personnel',
  'assets-infrastructure',
  'assets-applications',
  'policy-map-id',
  'mapped-controls',
  'evidence-tasks',
  'security-portal-ids',
  'privacy-portal-ids',
  'jira-projects',
  'jira-project-id',
  'jira-components',
  'related-policy-statement-ids',
];

const joined = (arr) => (arr || []).join('|');

function selectorsForText(text, selectorsIndex, hostReferenceId) {
  const placeholders = (text || '').match(/\[x\d+\]/g) || [];
  if (!placeholders.length) return '';
  const bySection = (selectorsIndex && selectorsIndex['by-section']) || {};
  const out = [];
  for (const sect of Object.values(bySection)) {
    for (const sel of sect) {
      if (sel['host-reference-id'] === hostReferenceId) out.push(`${sel.placeholder}=${sel.selector}`);
    }
  }
  return out.join('; ');
}

function csvRow({ policyId, frameworkTags, section, condition, parentLocalId, parentReferenceId, kind, obj, textField, localIdField, selectorsIndex }) {
  const a = obj.assets || {};
  return {
    'policy-id': policyId,
    'framework-tags': joined(frameworkTags),
    'section-id': section?.['sect-id'] || '',
    'section-reference-id': section?.['reference-id'] || '',
    'section-number': section?.['section-number'] || '',
    'section-title':  section?.['section-title']  || '',
    'section-type':   section?.['section-type']   || '',
    'condition-id':            condition?.['policy-condition-id'] || '',
    'condition-reference-id':  condition?.['reference-id']        || '',
    'condition-title':         condition?.['policy-condition-title'] || '',
    'parent-statement-id':     parentLocalId,
    'parent-reference-id':     parentReferenceId,
    'kind': kind,
    'local-id':     obj[localIdField],
    'reference-id': obj['reference-id'],
    'text':         obj[textField],
    'assignment-selectors': selectorsForText(obj[textField], selectorsIndex, obj['reference-id']),
    'scopes': joined(obj.scopes || []),
    'assets-personnel':      joined(Object.keys(a.personnel || {})),
    'assets-infrastructure': joined(Object.keys(a.infrastructure || {})),
    'assets-applications':   joined(Object.keys(a.applications || {})),
    'policy-map-id': obj['policy-map-id'] || '',
    'mapped-controls':              joined(obj['mapped-controls']),
    'evidence-tasks':               joined(obj['evidence-tasks']),
    'security-portal-ids':          joined(obj['security-portal-ids']),
    'privacy-portal-ids':           joined(obj['privacy-portal-ids']),
    'jira-projects':                joined(obj['jira-projects']),
    'jira-project-id':              obj['jira-project-id'] || '',
    'jira-components':              joined(obj['jira-components']),
    'related-policy-statement-ids': joined(obj['related-policy-statement-ids']),
  };
}

function emitCsv(policiesOnly, csvPath) {
  const policyId = policiesOnly['policy-id'];
  const frameworkTags = policiesOnly['framework-tags'] || [];
  const selectorsIndex = policiesOnly['assignment-selectors'] || {};

  const rows = [];
  for (const section of policiesOnly.policy['policy-requirements'] || []) {
    const stmtLists = [];
    if (section['section-type'] === 'policy-and-procedures') stmtLists.push([null, section['policy-and-procedures'] || []]);
    else stmtLists.push([null, section['policy-statements'] || []]);
    for (const cond of section['policy-conditions'] || []) stmtLists.push([cond, cond['policy-statements'] || []]);

    for (const [cond, stmts] of stmtLists) {
      const insideCondition = cond != null;
      for (const stmt of stmts) {
        rows.push(csvRow({
          policyId, frameworkTags, section, condition: cond,
          parentLocalId: '', parentReferenceId: '',
          kind: insideCondition ? 'condition-statement' : 'statement',
          obj: stmt, textField: 'policy-statement', localIdField: 'policy-statement-id',
          selectorsIndex,
        }));
        for (const sub of stmt['policy-substatements'] || []) {
          rows.push(csvRow({
            policyId, frameworkTags, section, condition: cond,
            parentLocalId: stmt['policy-statement-id'],
            parentReferenceId: stmt['reference-id'],
            kind: insideCondition ? 'condition-substatement' : 'substatement',
            obj: sub, textField: 'policy-substatement', localIdField: 'policy-substatement-id',
            selectorsIndex,
          }));
        }
      }
    }
  }

  fs.mkdirSync(path.dirname(csvPath), { recursive: true });
  const escape = (v) => {
    const s = String(v ?? '');
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [CSV_HEADERS.join(',')];
  for (const r of rows) lines.push(CSV_HEADERS.map((h) => escape(r[h])).join(','));
  fs.writeFileSync(csvPath, lines.join('\n') + '\n', 'utf-8');
  console.log(`  Created: ${csvPath} (${rows.length} rows)`);
}

// ────────────────────────────────────────────────────────────────────────────
// IO + CLI
// ────────────────────────────────────────────────────────────────────────────

function writeJson(data, filepath) {
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  console.log(`  Created: ${filepath}`);
}

/** Parse a YAML file using a *very* small built-in subset. Only flat key:value
 *  and list/dict-of-objects support is needed for this plugin's metadata files
 *  — all richer YAML is an explicit non-goal. */
function loadYamlMaybe(filepath) {
  if (!filepath) return {};
  if (!fs.existsSync(filepath)) {
    console.error(`ERROR: YAML file not found: ${filepath}`);
    process.exit(1);
  }
  const txt = fs.readFileSync(filepath, 'utf-8');
  // delegate to JSON if the file is JSON
  const trimmed = txt.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try { return JSON.parse(trimmed); } catch { /* fall through */ }
  }
  // Minimal YAML: keys, scalars, simple [a, b] inline lists, simple objects of
  // "- key: value" entries. Documents that need richer YAML should pre-convert
  // to JSON or use the Python sibling plugin.
  const out = {};
  let curKey = null;
  let curList = null;
  for (const rawLine of txt.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;
    const body = line.trim();
    if (indent === 0 && body.includes(':')) {
      const [k, ...rest] = body.split(':');
      const v = rest.join(':').trim();
      curKey = k.trim();
      if (v === '') { out[curKey] = []; curList = out[curKey]; }
      else if (v.startsWith('[') && v.endsWith(']')) { out[curKey] = v.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean); curList = null; }
      else { out[curKey] = v.replace(/^["']|["']$/g, ''); curList = null; }
    } else if (curList && body.startsWith('-')) {
      curList.push(body.slice(1).trim().replace(/^["']|["']$/g, ''));
    }
  }
  return out;
}

function parseArgs(argv) {
  const args = { _verbose: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const eat = () => argv[++i];
    switch (a) {
      case '--docx':            case '-d': args.docx = eat(); break;
      case '--yaml':            case '-y': args.yaml = eat(); break;
      case '--controls':        case '-c': args.controls = eat(); break;
      case '--output-dir':      case '-o': args.outputDir = eat(); break;
      case '--test-output-dir': case '-t': args.testOutputDir = eat(); break;
      case '--csv-output':                 args.csvOutput = eat(); break;
      case '--policy-id':                  args.policyId = eat(); break;
      case '--framework':                  args.framework = eat(); break;
      case '--policy-map':                 args.policyMap = true; break;
      case '--verbose':         case '-v': args._verbose = true; break;
      case '--help':            case '-h': args._help = true; break;
      default:
        console.error(`Unknown arg: ${a}`);
        process.exit(2);
    }
  }
  // Env-var fallbacks (CLI > env > built-in). The .claude/sec-policy-analyzer-node.local.md
  // settings file is read by scripts/run.sh and exported as SEC_POLICY_* env
  // vars before this parser is invoked, so this single layer covers both.
  const envBool = (v) => /^(1|true|yes|on)$/i.test(String(v || ''));
  if (!args.controls  && process.env.SEC_POLICY_DEFAULT_CONTROLS)  args.controls  = process.env.SEC_POLICY_DEFAULT_CONTROLS;
  if (!args.framework && process.env.SEC_POLICY_DEFAULT_FRAMEWORK) args.framework = process.env.SEC_POLICY_DEFAULT_FRAMEWORK;
  if (!args.policyMap && envBool(process.env.SEC_POLICY_DEFAULT_POLICY_MAP)) args.policyMap = true;
  // Output mode is decided by run.sh, not the bare parser — keeps the parser
  // orthogonal: it requires explicit --output-dir or --test-output-dir.
  return args;
}

const HELP = `parse_policy_v2.mjs — Sec Policy Analyzer v2 parser (Node)

Usage:
  node parse_policy_v2.mjs --docx PATH (--output-dir DIR | --test-output-dir DIR) [opts]

Required:
  --docx PATH               Path to policy .docx
  one of:
    --output-dir DIR        Production output (writes into policies-only/, etc.)
    --test-output-dir DIR   Sandbox flat output

Options:
  --yaml PATH               Optional metadata YAML
  --controls PATH           Optional controls CSV
  --csv-output PATH         Also emit a flat CSV here
  --policy-id SLUG          Override the auto-derived policy-id
  --framework TAGS          Comma-separated extra framework tag(s) (iso-27001,soc-2)
  --policy-map              Compact mode: emit top-level policy-map registry +
                            replace 8 inline linkage fields with policy-map-id
  --verbose                 Print parse summary
  --help                    Show this help
`;

async function main() {
  const args = parseArgs(process.argv);
  if (args._help) { process.stdout.write(HELP); return; }
  if (!args.docx) { console.error('ERROR: --docx is required'); process.exit(2); }
  if (!args.outputDir && !args.testOutputDir) { console.error('ERROR: --output-dir or --test-output-dir is required'); process.exit(2); }
  if (!fs.existsSync(args.docx)) { console.error(`ERROR: DOCX file not found: ${args.docx}`); process.exit(1); }

  USE_POLICY_MAP = !!args.policyMap;

  let metadata = {};
  if (args.yaml) metadata = loadYamlMaybe(args.yaml);

  let controls = [];
  if (args.controls && fs.existsSync(args.controls)) controls = loadControls(args.controls);

  const docxPath = path.resolve(args.docx);
  let baseName = path.basename(docxPath, path.extname(docxPath));
  if (!baseName.endsWith('_policy')) baseName += '_policy';

  console.log(`Processing: ${path.basename(docxPath)}`);
  if (args._verbose) console.log(`  Base name: ${baseName}`);

  const [title, sections] = parseDocxIntoSections(docxPath);

  const [policyId, policyIdSource] = derivePolicyId(docxPath, title, args.policyId);
  const frameworkTags = detectFrameworks(path.basename(docxPath), title);
  if (args.framework) {
    for (const tag of args.framework.split(',').map((s) => s.trim()).filter(Boolean)) {
      if (!frameworkTags.includes(tag)) frameworkTags.push(tag);
    }
  }

  if (args._verbose) {
    console.log(`  Title: ${title}`);
    console.log(`  Policy id: ${policyId}  (source: ${policyIdSource})`);
    console.log(`  Framework tags: ${JSON.stringify(frameworkTags)}`);
    console.log(`  Sections found: ${sections.length}`);
    for (const s of sections) {
      console.log(`    - H${s.headingLevel ?? '?'} ${s.number} ${s.title} (${s.paragraphs.length} paras)`);
    }
  }

  if (!Object.keys(metadata).length) metadata = { 'policy-title': title, 'category': '', 'frameworks': [] };

  const policiesOnly = buildPoliciesOnlyJson({
    metadata, title, sections, baseName, policyId, policyIdSource, frameworkTags,
  });

  const mappedControls = mapControlsToPolicy(metadata['category'] || '', controls);
  const controlsJson    = buildAssociatedControlsJson(metadata, mappedControls, title, baseName, policyId);
  const completeJson    = buildCompleteAssociationsJson(policiesOnly, controlsJson);

  if (args.testOutputDir) {
    const out = args.testOutputDir;
    writeJson(policiesOnly, path.join(out, `${baseName}_only.json`));
    writeJson(controlsJson, path.join(out, `${baseName}_associated_controls.json`));
    writeJson(completeJson, path.join(out, `${baseName}_complete_associations.json`));
  } else {
    const out = args.outputDir;
    writeJson(policiesOnly, path.join(out, 'policies-only',          `${baseName}_only.json`));
    writeJson(controlsJson, path.join(out, 'associated-controls',    `${baseName}_associated_controls.json`));
    writeJson(completeJson, path.join(out, 'complete-associations',  `${baseName}_complete_associations.json`));
  }

  if (args.csvOutput) emitCsv(policiesOnly, args.csvOutput);

  console.log(`SUCCESS: Processed ${path.basename(docxPath)}`);
}

main().catch((e) => { console.error(e?.stack || e); process.exit(1); });
