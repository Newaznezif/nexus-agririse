/**
 * The Phase 5 evidence-PDF assertions, in one module.
 *
 * Two harnesses call it. `check-report-data.mjs` hands it the bundle this afternoon's publishers
 * actually answered; `check-pdf-render.mjs` hands it deterministic fixtures for the states a live
 * afternoon will not hand anyone — a source behind schedule, a chart with no honest series, every
 * publisher refusing at once, a demo workspace, a report written in Ge'ez script. Both are then
 * held to exactly the same page, which is the point: a fixture cannot be made to pass by a softer
 * rule than the live case is held to, and a live case cannot be excused by a rule written for it.
 *
 * What is asserted against the *block program* (`lib/report/pdfDocument.ts`) and what against the
 * *rendered bytes* is deliberate. Long sentences are checked in the blocks, because autoTable
 * re-wraps text at a column width and a wrapped sentence is then no longer a substring of anything.
 * Short tokens — a publisher's number, an evidence id, `Page 3 of 8`, the demo mark — are checked
 * in the extracted page text, because those survive wrapping. What only exists as bytes (a font
 * embedded, glyphs round-tripping out of a Type0/CIDFontType2 subset) is checked through
 * `ctx.extract`, which reads a written file back with `pdftotext -enc UTF-8`.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NO_PAYLOAD_CODES } from './provenance-rule.mjs';

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');

/** jsPDF's standard fonts are WinAnsi; a character outside this table cannot be drawn with them. */
const NOT_WINANSI = /[^\x20-\x7e\xa0-\xff€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™šœžŸ]/;

/** The renderer's own cell rule, restated here as an oracle: a blank stays a dash, never a zero. */
export const asCell = (v) => (v === null || v === undefined || v === ''
  ? '—'
  : typeof v === 'number'
    ? Number.isInteger(v) ? String(v) : v.toFixed(2)
    : typeof v === 'boolean'
      ? (v ? 'yes' : 'no')
      : String(v));

const CP1252 = { '\x80': '€', '\x82': '‚', '\x83': 'ƒ', '\x84': '„', '\x85': '…', '\x86': '†', '\x87': '‡', '\x88': 'ˆ', '\x89': '‰', '\x8a': 'Š', '\x8b': '‹', '\x8c': 'Œ', '\x8e': 'Ž', '\x91': '‘', '\x92': '’', '\x93': '“', '\x94': '”', '\x95': '•', '\x96': '–', '\x97': '—', '\x98': '˜', '\x99': '™', '\x9a': 'š', '\x9b': '›', '\x9c': 'œ', '\x9e': 'ž', '\x9f': 'Ÿ' };

export const flatten = (document) => document.blocks
  .flatMap((block) => {
    if (block.type === 'page-break') return [];
    if (block.type === 'table') return [block.head.join(' '), ...block.rows.map((row) => row.join(' '))];
    if (block.type === 'kv') return block.rows.map((row) => row.join(' '));
    if (block.type === 'box') return [block.title, ...block.lines];
    if (block.type === 'chart') return [block.title, block.caption, ...block.series.map((s) => `${s.label} ${s.points.map((p) => `${p.x}=${p.y}`).join(' ')}`)];
    if (block.type === 'chart-unavailable') return [block.title, block.reason, block.caption];
    return [block.text];
  })
  .join('\n');

/** Every string the document means to print, walking the same shape the renderer walks. */
export function documentStrings(document) {
  const out = [];
  const push = (v) => { if (typeof v === 'string' && v.length > 0) out.push(v); };
  push(document.filename);
  push(document.demoNotice);
  push(document.footer);
  for (const line of document.cover.lines) push(line);
  for (const column of [document.cover.left, document.cover.right]) {
    push(column.heading);
    for (const line of column.lines) push(line);
  }
  for (const block of document.blocks) {
    if (block.type === 'page-break') continue;
    if (block.type === 'table') { push(block.head.join(' ')); for (const row of block.rows) push(row.join(' ')); continue; }
    if (block.type === 'kv') { for (const row of block.rows) push(row.join(' ')); continue; }
    if (block.type === 'box') { push(block.title); for (const line of block.lines) push(line); continue; }
    if (block.type === 'chart') { push(block.title); push(block.caption); for (const s of block.series) push(`${s.label} ${s.points.map((p) => `${p.x}=${p.y}`).join(' ')}`); continue; }
    if (block.type === 'chart-unavailable') { push(block.title); push(block.reason); push(block.caption); continue; }
    push(block.text);
  }
  return out;
}

/**
 * The same strings one at a time. `flatten` joins a table row into a line to read like a page; a
 * round trip against an external extractor has to compare a *cell*, because a PDF places a cell in
 * its own column and puts a line break wherever the column width ran out.
 */
export function documentCells(document) {
  const out = [];
  const push = (v) => { if (typeof v === 'string' && v.length > 0) out.push(v); };
  for (const line of document.cover.lines) push(line);
  for (const column of [document.cover.left, document.cover.right]) { push(column.heading); for (const line of column.lines) push(line); }
  for (const block of document.blocks) {
    if (block.type === 'page-break') continue;
    if (block.type === 'table') { for (const cellValue of [...block.head, ...block.rows.flat()]) push(cellValue); continue; }
    if (block.type === 'kv') { for (const row of block.rows) { push(row[0]); push(row[1]); } continue; }
    if (block.type === 'box') { push(block.title); for (const line of block.lines) push(line); continue; }
    if (block.type === 'chart') { push(block.title); push(block.caption); for (const s of block.series) push(s.label); continue; }
    if (block.type === 'chart-unavailable') { push(block.title); push(block.reason); push(block.caption); continue; }
    push(block.text);
  }
  return out;
}

/** Nothing may claim a status the evidence cannot confer, and nothing may claim a seal. */
export const FORBIDDEN = ['NX-AUTH', 'VERIFIED', 'AUTHORIZED BY', 'Authorized Profile', 'Digitally Signed', 'System Auth Code', 'Lead Manager Signature', 'Encrypting', 'Trend Progression', 'Impact Allocation', 'Sourcing Strategy', 'Arbitrage Capture'];

export function statusClaims(text) {
  const hit = FORBIDDEN.filter((word) => text.includes(word));
  // A status word is only allowed inside a sentence that denies it: "not signed", "no session was
  // verified", "printing one would be simulating authorization". Denial is the point of those
  // sentences, so the oracle recognises the counterfactual as well as the plain negation.
  const bare = [...text.matchAll(/\b(signed|sealed|encrypted|verified|certified|authoriz\w*|hash\w*|tamper\w*)\b/gi)]
    .map((m) => {
      const before = text.slice(Math.max(0, m.index - 90), m.index);
      const sentence = before.slice(before.lastIndexOf('.') + 1);
      return /\b(not|never|no|without|simulat\w*|fabricat\w*|rather than|instead of)\b/i.test(sentence) ? null : `${sentence.slice(-40)}«${m[0]}»`;
    })
    .filter((v) => v !== null);
  return { hit, bare };
}

/** Everything the document means to print — blocks plus the cover, footer and filename. */
export const corpus = (document) => documentStrings(document).join('\n');

/** Read a rendered PDF back: page count, the page text, and the fonts it carries. */
export async function renderPdf(result, outFile) {
  const bytes = Buffer.from(await result.blob.arrayBuffer());
  if (outFile) writeFileSync(outFile, bytes);
  const raw = bytes.toString('latin1');
  // Only content streams hold page text. Matching literals across the whole file also catches the
  // binary of an embedded font, which is not text and must not be read as though it were.
  const pages = (raw.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  const content = [...raw.matchAll(/stream\r?\n([\s\S]*?)endstream/g)]
    .map((m) => m[1])
    .filter((s) => s.includes('Tj') && !s.includes('\x00'))
    .join('\n');
  return {
    filename: result.filename,
    size: bytes.length,
    unrendered: result.unrendered,
    pages,
    compressed: (raw.match(/\/FlateDecode/g) ?? []).length,
    fonts: [...raw.matchAll(/\/BaseFont\s*\/([A-Za-z0-9+\-.]+)/g)].map((m) => m[1]),
    type0: (raw.match(/\/Type0/g) ?? []).length,
    tounicode: (raw.match(/\/ToUnicode/g) ?? []).length,
    text: (content.match(/\((?:[^()\\]|\\.)*\)/g) ?? [])
      .map((literal) => literal.slice(1, -1).replace(/\\([()\\])/g, '$1'))
      .join('\n')
      .replace(/[\x80-\x9f]/g, (c) => CP1252[c] ?? c),
  };
}

/** The font descriptor the product ships, read from disk so a Node harness needs no browser. */
export async function unicodeFontFromDisk(ts) {
  const { ABYSSINICA_FONT } = await ts('services/pdfUnicodeFont.ts');
  const file = resolvePath(ROOT, 'public/fonts', ABYSSINICA_FONT.fileName);
  if (!existsSync(file)) return null;
  return { ...ABYSSINICA_FONT, base64: readFileSync(file).toString('base64') };
}

const codePointName = (char) => `U+${char.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`;
const unsupportedIn = (value) => [...new Set([...value].filter((c) => NOT_WINANSI.test(c)))];
const squeeze = (value) => value.replace(/\s+/g, ' ').trim();

/* ---------------------------------------------------------------- one scenario ---------------------------------------------------------------- */

/**
 * Every page rule, run against one bundle: the block program first, then the rendered bytes, then
 * the interpretation half, then — when the harness can read a PDF back — the text extraction.
 * Returns what it built so the caller can add scenario-specific assertions without re-rendering.
 */
export async function checkPdfDocument(ctx, { label, bundle }) {
  const { assert, note, describeReport, buildEvidencePdf, generateEvidencePdf, VALUE_KIND_WORD } = ctx;
  const tag = (title) => `pdf[${label}]: ${title}`;
  const isDemo = bundle.meta.mode === 'demo';

  /* -- the block program: what the report says -- */
  const doc = buildEvidencePdf({ bundle, payload: null });
  const text = flatten(doc);
  const said = corpus(doc);
  const blocks = doc.blocks;
  const bundleTables = bundle.sections.flatMap((s) => s.evidence.flatMap((e) => e.tables));
  const bundleCharts = bundle.sections.flatMap((s) => s.evidence.flatMap((e) => e.charts));
  const dataTables = blocks.filter((b) => b.type === 'table' && b.head.length > 1);

  assert(tag('the document is a cover plus the five groups the bundle is made of'), blocks.filter((b) => b.type === 'page-break').length === 4, blocks.filter((b) => b.type === 'page-break').length);
  assert(tag('the cover lines are all filled in'), doc.cover.lines.every((line) => line !== ''), doc.cover.lines);
  assert(tag('the file is named for the workspace it belongs to'), isDemo ? /DEMO_/.test(doc.filename) : /_Evidence_Report_/.test(doc.filename) && !/DEMO_/.test(doc.filename), doc.filename);
  assert(tag('the filename carries this bundle’s own reference'), doc.filename.includes(bundle.meta.reference), doc.filename);
  assert(tag('the demo wording is the bundle’s own, and a production bundle carries none'), doc.demoNotice === (isDemo ? bundle.meta.demoNotice : null), doc.demoNotice);
  assert(tag('the headline is the state model’s, not a second computation'), text.includes(describeReport({ loading: false, error: null, bundle }).headline), undefined);
  assert(tag('the page never contradicts its own workspace'), isDemo
    ? /DEMO/.test(said) && !/Production workspace/.test(said)
    : !/DEMO/.test(said) && /Production workspace/.test(said), { isDemo, hits: (said.match(/DEMO/g) ?? []).length });

  for (const table of bundleTables) {
    const expected = table.rows.map((row) => table.columns.map((c) => asCell(row[c.key])));
    const block = dataTables.find((b) => b.rows.length === expected.length && expected.every((row, i) => row.join('\u0000') === b.rows[i].join('\u0000')));
    if (!assert(tag(`${table.evidenceId} reaches the page as the publisher’s own rows`), block !== undefined, { rows: expected.length, heads: dataTables.map((b) => b.head.join('/')) })) continue;
    const blanks = table.rows.flatMap((r) => table.columns.map((c) => r[c.key])).filter((v) => v === null || v === undefined || v === '').length;
    assert(tag(`${table.evidenceId} prints each blank the publisher left as a dash, never a zero`), expected.flat().filter((v) => v === '—').length === blanks, { blanks });
    if (table.rowsOmitted > 0) {
      assert(tag(`${table.evidenceId} counts the ${table.rowsOmitted} rows it does not show`), text.includes(String(table.rowsOmitted)) && /row.{0,2} not shown|further row/i.test(text), table.omissionNote);
    }
    assert(tag(`${table.evidenceId} states the units, kind, coverage and both dates of its rows`), text.includes(table.provenance.units || 'not stated')
      && text.includes(VALUE_KIND_WORD[table.provenance.valueKind]) && text.includes(table.provenance.coverage)
      && text.includes(table.provenance.observedAt ?? 'not stated'), { units: table.provenance.units, coverage: table.provenance.coverage });
  }

  for (const chart of bundleCharts) {
    const plotted = !chart.unavailableReason && chart.series.some((s) => s.points.length > 0);
    const found = blocks.find((b) => b.type === 'chart' && b.title === chart.title && b.series.length === chart.series.length
      && b.series.every((s, i) => s.label === chart.series[i].label && s.points.length === chart.series[i].points.length
        && s.points.every((p, j) => p.x === chart.series[i].points[j].x && p.y === chart.series[i].points[j].y)));
    const refusedBlock = blocks.find((b) => b.type === 'chart-unavailable' && b.title === chart.title);
    if (plotted) {
      if (!assert(tag(`${chart.evidenceId} is plotted from its own points, not a shape the renderer chose`), found !== undefined, chart.series.map((s) => s.points.length))) continue;
      const escaped = chart.units.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      assert(tag(`${chart.evidenceId} names units, value kind, spatial basis and its dates in the caption`), new RegExp(escaped).test(found.caption)
        && found.caption.includes(VALUE_KIND_WORD[chart.valueKind]) && /observed /.test(found.caption) && /retrieved /.test(found.caption), found.caption);
      const gaps = chart.series.flatMap((s) => s.points).filter((p) => p.y === null).length;
      if (gaps > 0) assert(tag(`${chart.evidenceId} says how many published points have no value`), new RegExp(`${gaps} with no value`).test(found.caption), { gaps, caption: found.caption });
    } else {
      assert(tag(`${chart.evidenceId} keeps its chart area and prints the contract’s own reason`), refusedBlock !== undefined && refusedBlock.reason === chart.unavailableReason, chart.unavailableReason);
      assert(tag(`${chart.evidenceId} is never drawn as a series`), found === undefined, undefined);
    }
  }

  const derived = bundle.sections.flatMap((s) => s.evidence.flatMap((e) => e.derived));
  if (derived.length > 0) {
    assert(tag('a figure this app computed is labelled as one, with its formula and its inputs'), derived.every((d) => blocks.some((b) => b.type === 'kv'
      && b.rows.some(([k]) => /computed by this application/.test(k))
      && b.rows.some(([k, v]) => k === 'Arithmetic performed' && v === d.formula)
      && b.rows.some(([k, v]) => k === 'Evidence ids it consumed' && v === d.inputs.join(', ')))), derived.map((d) => d.formula));
  }

  const stale = bundle.meta.sourceRegister.filter((e) => e.stale || e.state === 'stale');
  if (stale.length > 0) assert(tag('a source behind schedule is disclosed as behind schedule, with both dates'), /behind schedule/.test(text) && stale.every((e) => text.includes(e.evidenceId) && text.includes(e.observedAt ?? 'not stated')), stale.map((e) => e.evidenceId));
  const refused = bundle.meta.sourceRegister.filter((e) => e.state === 'unavailable');
  if (refused.length > 0) assert(tag('a source that did not answer is disclosed as did not answer'), /did not answer/.test(text) && refused.every((e) => text.includes(e.evidenceId)), refused.map((e) => e.evidenceId));
  const undated = refused.filter((e) => e.retrievedAt === null);
  if (undated.length > 0) {
    // Checked in the sources row itself, not as words somewhere in the PDF: a date in the Retrieved
    // column claims this server downloaded the file, and a refusal has no download to date.
    const rowFor = (id) => blocks.filter((b) => b.type === 'table' && (b.head ?? []).includes('Retrieved'))
      .flatMap((b) => b.rows).find((r) => r[0] === id);
    assert(tag('a refusal reaches the sources page with no fetch date, only “not stated”'), undated.every((e) => {
      const row = rowFor(e.evidenceId);
      return row !== undefined && row[5] === 'not stated';
    }), undated.map((e) => ({ id: e.evidenceId, row: rowFor(e.evidenceId) })));
  }
  assert(tag('every evidence id in the register is printed on the sources page'), bundle.meta.sourceRegister.every((e) => text.includes(e.evidenceId)), bundle.meta.sourceRegister.filter((e) => !text.includes(e.evidenceId)).map((e) => e.evidenceId));
  assert(tag('no licence, link or observation date is invented: only what the register holds is printed'), (() => {
    const licensed = bundle.meta.sourceRegister.filter((e) => e.license.trim() !== '');
    const linked = bundle.meta.sourceRegister.filter((e) => e.sourceUrl.trim() !== '');
    return licensed.every((e) => text.includes(e.license)) && linked.every((e) => text.includes(e.sourceUrl));
  })(), bundle.meta.sourceRegister.filter((e) => e.license.trim() !== '' && !text.includes(e.license)).map((e) => e.evidenceId));
  assert(tag('an empty register field is printed as not supplied, never filled in'), blocks.filter((b) => b.type === 'table').every((b) => !b.rows.flat().includes('')), undefined);
  assert(tag('every warning the bundle carries is printed with its code and its evidence id'), bundle.meta.warnings.every((w) => text.includes(w.message) && text.includes(w.code) && (w.evidenceId === null || text.includes(w.evidenceId))), bundle.meta.warnings.filter((w) => !text.includes(w.message)).map((w) => w.code));
  assert(tag('the scope of the report is the bundle’s own words, and the same words on every page'), (() => {
    const coverScope = doc.cover.lines[1].replace(/^Scope: /, '');
    return said.includes(doc.cover.lines[1]) && text.includes(coverScope) && /Spatial basis/.test(said) && /Scope of these figures/.test(text);
  })(), { cover: doc.cover.lines[1], sections: text.match(/Scope of these figures[^\n]{0,60}/g) });
  assert(tag('each section states the scope its own figures were read at'), bundle.sections.every((s) => text.includes(s.title)), bundle.sections.map((s) => s.title));
  assert(tag('a section nothing answered prints its own reason instead of an empty chart'), bundle.sections.filter((s) => s.status === 'unavailable').every((s) => text.includes(s.unavailableReason ?? '§')), undefined);
  assert(tag('no interpretation in hand is stated as such, not papered over'), /No interpretation was generated/.test(text), undefined);
  assert(tag('nothing claims a signature, a seal, an authorisation or an encryption'), (() => {
    const { hit, bare } = statusClaims(said);
    return hit.length === 0 && bare.length === 0;
  })(), statusClaims(said));

  /* -- the rendered file, read back out of its own bytes -- */
  const result = await generateEvidencePdf({ bundle, payload: null }, ctx.unicodeFont ?? null);
  const outFile = ctx.outDir === null ? null : resolvePath(ctx.outDir, `${label.replace(/[^\w.-]+/g, '_')}.pdf`);
  const rendered = await renderPdf(result, outFile);
  const needsFont = ctx.documentNeedsUnicodeFont(doc);

  assert(tag('jsPDF writes the report in Node'), rendered.size > 1000 && rendered.pages >= (ctx.minPages ?? 5), { size: rendered.size, pages: rendered.pages });
  assert(tag('the page text is stored uncompressed, so it can be read back'), needsFont || rendered.compressed === 0, { compressed: rendered.compressed, needsFont });
  assert(tag('the rendered file is named for the bundle it prints'), rendered.filename === doc.filename, rendered.filename);
  assert(tag('the drawing layer hands back the characters it could not render'), Array.isArray(rendered.unrendered), rendered.unrendered);
  assert(tag('a publisher value in the bundle appears in the rendered page text'), (() => {
    const value = bundleTables.flatMap((t) => t.rows.flatMap((r) => t.columns.map((c) => r[c.key]))).find((v) => typeof v === 'number' && v !== 0);
    return value === undefined || rendered.text.includes(asCell(value));
  })(), undefined);
  assert(tag('an evidence id printed in the blocks is printed on the page'), bundle.meta.sourceRegister.length === 0 || rendered.text.includes(bundle.meta.sourceRegister[0].evidenceId), undefined);
  assert(tag('a rendered page carries no status or signature claim'), (() => {
    const { hit, bare } = statusClaims(rendered.text);
    return hit.length === 0 && bare.length === 0;
  })(), statusClaims(rendered.text));
  assert(tag('every page is numbered and framed as the same product line'), new RegExp(`Page 1 of ${rendered.pages}`).test(rendered.text) && /Nexus AgriRise/.test(rendered.text), { pages: rendered.pages });
  assert(tag('a character the standard fonts cannot hold is turned into words a reader can follow'), (() => {
    const spoken = ctx.pdfSafe('Σ(price) → deviation');
    return spoken !== 'Σ(price) → deviation' && !NOT_WINANSI.test(spoken);
  })(), ctx.pdfSafe('Σ(price) → deviation'));
  assert(tag('the page text the renderer wrote is printable text, not control characters'), !/[\x00-\x08\x0e\x0f\x1f]/.test(rendered.text), undefined);
  if (isDemo) assert(tag('a demo file is marked on every page of the rendered file'), (rendered.text.match(/DEMO — NOT LIVE DATA/g) ?? []).length >= rendered.pages, { marks: (rendered.text.match(/DEMO — NOT LIVE DATA/g) ?? []).length, pages: rendered.pages });
  note(`rendered ${label}: ${rendered.pages} pages, ${rendered.size} bytes, ${bundleTables.length} tables, ${bundleCharts.filter((c) => !c.unavailableReason).length} plotted series groups, ${needsFont ? 'Unicode face asked for' : 'Latin script only'}.`);

  /* -- the interpretation half, from the package the same bundle produces -- */
  const pkg = ctx.buildEvidencePackage(bundle);
  let gate = null;
  let payload = null;
  let insightsText = null;
  if (pkg.facts.length > 0) {
    const fact = pkg.facts[0];
    gate = ctx.validateFindings(bundle, pkg, [
      { text: `The published figure is ${fact.value} ${fact.units}.`, cites: [fact.evidenceId], kind: 'observation' },
      { text: 'Every market in the country doubled in price.', cites: [fact.evidenceId], kind: 'interpretation' },
    ], 'fixture-model');
    payload = ctx.buildInsightsPayload(pkg, gate, 'fixture-model');
    const withInsights = buildEvidencePdf({ bundle, payload });
    insightsText = flatten(withInsights);
    assert(tag('an accepted sentence is printed with the evidence ids it cites'), gate.accepted.length === 0 || (insightsText.includes(gate.accepted[0].text) && gate.accepted[0].cites.every((id) => insightsText.includes(id))), { accepted: gate.accepted.length });
    assert(tag('a sentence the gate dropped is listed with its reason, not hidden'), gate.rejected.length === 0 || (/Dropped by the evidence check/.test(insightsText) && gate.rejected.every((r) => insightsText.includes(r.reason))), gate.rejected.map((r) => r.reason));
    assert(tag('the interpretation names the model that wrote it'), insightsText.includes('fixture-model'), undefined);
    assert(tag('what the model’s own budget left out is disclosed next to its sentences'), pkg.truncated === null ? /Nothing: the package/.test(insightsText) : /most recent points|facts\b/.test(insightsText), pkg.truncated);
    const mismatch = buildEvidencePdf({ bundle, payload: { ...payload, reference: 'NX-REF-FROM-ANOTHER-READ' } });
    assert(tag('an interpretation from another read is withheld rather than re-anchored'), flatten(mismatch).includes('Interpretation withheld') && !flatten(mismatch).includes(`The published figure is ${fact.value} ${fact.units}.`), undefined);
    const renderedInsights = await renderPdf(await generateEvidencePdf({ bundle, payload }, ctx.unicodeFont ?? null), null);
    assert(tag('the interpretation travels in the same file as the figures it cites'), renderedInsights.pages >= rendered.pages && /Interpretation/.test(renderedInsights.text), { pages: renderedInsights.pages });
  } else {
    note(`${label}: the bundle carries no figures, so the evidence package has no facts and the interpretation half has nothing to check.`);
  }

  /* -- what a PDF reader on the command line sees in the written file -- */
  let extracted = null;
  if (ctx.extract && outFile) {
    extracted = squeeze(await ctx.extract(outFile));
    assert(tag('pdftotext reads the same report out of the file the renderer wrote'), extracted.includes(squeeze(doc.cover.title[0])) && extracted.includes(bundle.meta.reference), extracted.slice(0, 160));
    assert(tag('an independent extractor finds a publisher’s number, not only our own regex'), (() => {
      const value = bundleTables.flatMap((t) => t.rows.flatMap((r) => t.columns.map((c) => r[c.key]))).find((v) => typeof v === 'number' && v !== 0);
      return value === undefined || extracted.includes(asCell(value));
    })(), undefined);
    assert(tag('the extractor finds no status or signature claim either'), (() => {
      const { hit, bare } = statusClaims(extracted);
      return hit.length === 0 && bare.length === 0;
    })(), statusClaims(extracted));
  }

  return { doc, text, blocks, rendered, outFile, extracted, pkg, gate, payload, insightsText };
}

/* ---------------------------------------------------------------- script coverage ---------------------------------------------------------------- */

/**
 * What a script the standard fonts cannot hold must survive: drawn with the embedded face when that
 * face holds the code point, replaced by words when the renderer has a word for it, and otherwise
 * shown as a visible `[?]` with the code points listed at the end of the file. Never deleted, never
 * a blank, and never a question mark that arrived there by accident.
 */
export async function checkUnicodeRendering(ctx, { label, bundle, unicodeFont, outFile }) {
  const { assert, note, buildEvidencePdf, generateEvidencePdf, pdfSafe } = ctx;
  const tag = (title) => `pdf[${label}]: ${title}`;
  const doc = buildEvidencePdf({ bundle, payload: null });
  const asked = [...new Set(documentStrings(doc).flatMap(unsupportedIn))];
  assert(tag('this document really does ask for a character the standard fonts cannot hold'), asked.length > 0, documentStrings(doc).filter((v) => !isWinAnsiWhole(v)).slice(0, 3));
  if (asked.length === 0) return null;
  const holds = (char) => unicodeFont !== null && unicodeFont.extraRanges.some(([lo, hi]) => char.codePointAt(0) >= lo && char.codePointAt(0) <= hi);
  const drawable = asked.filter(holds);
  const lost = asked.filter((char) => !holds(char) && pdfSafe(char) === '[?]');

  const rendered = await renderPdf(await generateEvidencePdf({ bundle, payload: null }, unicodeFont), outFile);
  const names = lost.map(codePointName);
  const dropped = asked.filter((char) => !holds(char) && !lost.includes(char) && pdfSafe(char) === char);

  assert(tag('the characters it asks for are all accounted for'), dropped.length === 0 && drawable.length + lost.length === asked.length, { asked, drawable, lost, dropped });
  assert(tag('a character no font in the file holds is reported to the exporter, not swallowed'), rendered.unrendered.slice().sort().join(' ') === names.slice().sort().join(' '), { unrendered: rendered.unrendered, expected: names });

  if (unicodeFont !== null) {
    assert(tag('the embedded face is written into the file as a Unicode font with a character table'), rendered.type0 >= 1 && rendered.tounicode >= 1 && rendered.fonts.some((name) => name.includes(unicodeFont.postScriptName)), rendered.fonts);
    assert(tag('a Latin-only document would never have paid for that font'), ctx.documentNeedsUnicodeFont(doc) === true, undefined);
  } else {
    assert(tag('without the embedded face nothing is silently replaced: the gap is printed on the page'), lost.length === 0 || /\[\?\]/.test(rendered.text), undefined);
    assert(tag('and the file says which characters it could not draw'), lost.length === 0 || (/Characters this file could not render/.test(rendered.text) && names.every((n) => rendered.text.includes(n))), names);
  }

  let extracted = null;
  if (ctx.extract !== null && outFile !== null) {
    extracted = squeeze(await ctx.extract(outFile));
    for (const value of [...new Set(documentCells(doc).filter((v) => !isWinAnsiWhole(v) && unsupportedIn(v).every(holds)))]) {
      const fragment = squeeze(value).split(' ').find((word) => !isWinAnsiWhole(word));
      // A cell can be wrapped by the table, so what must survive is the word the publisher wrote,
      // not the sentence around it — unless the whole string fits on one line, which is checked too.
      const found = extracted.includes(squeeze(value));
      assert(tag(`an external reader gets “${value.slice(0, 30)}” back out of the file`), found || (fragment !== undefined && squeeze(extracted).includes(fragment)), { fragment, extracted: extracted.slice(0, 200) });
    }
    assert(tag('nothing that the embedded face holds shows up as a placeholder'), (() => {
      const placeholders = (extracted.match(/\[\?\]/g) ?? []).length;
      const askedFor = [...new Set(documentCells(doc).flatMap(unsupportedIn))].filter((c) => !holds(c) && pdfSafe(c) === '[?]');
      return placeholders === 0 || askedFor.length > 0;
    })(), undefined);
  }
  note(`${label}: ${asked.length} characters outside WinAnsi — ${drawable.length} drawn with the embedded face, ${lost.length} disclosed as unrenderable (${names.join(', ') || 'none'}), ${rendered.unrendered.length} reported to the exporter.`);
  return { rendered, drawable, lost, asked, extracted, docText: flatten(doc) };
}

/* ---------------------------------------------------------------- the legacy record ---------------------------------------------------------------- */

/**
 * The stored-analysis export is not an evidence report: it holds a paragraph a model wrote in an
 * earlier session, and nothing measurable. It keeps the same page furniture and must say plainly
 * what it is not, so the old fabricated charts, auth codes and signature lines are the first thing
 * these rules look for. The same record is built here for both harnesses, since a fixture record is
 * the only honest input for a file whose whole subject is stored text.
 */
export async function checkRecordPdf(ctx, { label = 'record', outFile = null } = {}) {
  const { assert, buildRecordPdf, generatePDFReport } = ctx;
  const tag = (title) => `pdf[${label}]: ${title}`;
  const input = {
    datasetName: 'Teff prices',
    datasetCountry: 'Ethiopia',
    insightId: 'a1b2c3d4-0000-0000-0000-000000000000',
    summary: 'A stored summary paragraph held on the analysis record.',
    riskLevel: 'High',
    trend: 'Bullish',
    createdAt: '2026-11-01T09:00:00.000Z',
    requestedBy: 'Ada Tester',
    requestedRole: 'Market Lead',
  };

  const record = buildRecordPdf(input);
  const said = corpus(record);
  assert(tag('no chart of any kind is drawn for a stored record'), !record.blocks.some((b) => b.type === 'chart' || b.type === 'chart-unavailable'), record.blocks.map((b) => b.type));
  assert(tag('it states it carries no publisher evidence and no source register'), /no source register/.test(said) && /no publisher evidence/.test(said), undefined);
  assert(tag('the name on it is labelled a browser choice, not an authorisation'), /No authentication behind it/.test(said) && /not a signature/.test(said), undefined);
  assert(tag('a stored risk or trend label is never drawn as a chart or an allocation'), !/pie|allocation|histogram/i.test(said), said.match(/pie|allocation|histogram/i)?.[0]);
  // The layout sets the risk label in capitals, as it does the names in the footer, so the label is
  // checked for the word it is rather than for the case the record happens to store it in.
  assert(tag('what it prints is the record’s own stored strings'), input.summary.split('. ').every((part) => said.includes(part)) && said.includes(input.trend) && said.toUpperCase().includes(input.riskLevel.toUpperCase()) && said.includes(input.datasetName), undefined);

  // A stored record is Latin text: it must not pay for the Unicode face the product loads on demand.
  const rendered = await renderPdf(await generatePDFReport(
    { id: 'd1', user_id: 'u', name: input.datasetName, country: input.datasetCountry, type: 'csv', file_url: '', created_at: '' },
    { id: input.insightId, user_id: 'u', dataset_id: 'd1', summary: input.summary, risk_level: input.riskLevel, trend: input.trend, created_at: input.createdAt },
    input.requestedBy,
    input.requestedRole,
    null,
  ), outFile);
  assert(tag('the rendered record is drawn with the standard faces, since it holds nothing else'), ctx.documentNeedsUnicodeFont(record) === false && !/Abyssinica/i.test(rendered.fonts.join(' ')), rendered.fonts);
  assert(tag('the rendered record prints none of the fabricated claims'), FORBIDDEN.filter((w) => rendered.text.includes(w)).length === 0, FORBIDDEN.filter((w) => rendered.text.includes(w)));
  assert(tag('a rendered record claims no status it cannot confer'), (() => {
    const { hit, bare } = statusClaims(rendered.text);
    return hit.length === 0 && bare.length === 0;
  })(), statusClaims(rendered.text));
  assert(tag('the stored strings reach the rendered file as stored'), rendered.text.includes(input.summary) && /Risk level|A stored summary/.test(rendered.text), rendered.text.slice(0, 120));

  let extracted = null;
  if (ctx.extract !== null && outFile !== null) {
    extracted = squeeze(await ctx.extract(outFile));
    const { hit, bare } = statusClaims(extracted);
    assert(tag('an external reader finds none of the old fabricated claims in the file'), hit.length === 0 && bare.length === 0, { hit, bare });
  }
  return { record, rendered, extracted };
}

/* ---------------------------------------------------------------- wiring ---------------------------------------------------------------- */

/**
 * The source-level rules: the drawing layer cannot reach the data, the panel hands it the current
 * read, and the legacy button no longer dresses a stored record up as an audited report.
 */
export function checkPdfWiring(ctx) {
  const { assert, VALUE_KIND_WORD } = ctx;
  const read = (rel) => readFileSync(resolvePath(ROOT, rel), 'utf8');

  const panelLabel = read('components/data/ProvenanceLabel.tsx');
  const fromSource = Object.fromEntries([...panelLabel.matchAll(/\b(observed|modeled|forecast|estimated|imputed):\s*\{\s*label:\s*'([^']+)'/g)].map((m) => [m[1], m[2]]));
  assert('wiring: the value-kind words the PDF prints are the words the dashboard prints', Object.keys(fromSource).length === 5 && Object.entries(fromSource).every(([k, v]) => VALUE_KIND_WORD[k] === v), { panel: fromSource, pdf: VALUE_KIND_WORD });

  const renderer = read('services/pdfExport.ts');
  const body = renderer.replace(/^import[\s\S]*?from '@\/lib\/report\/pdfDocument';/m, '');
  assert('wiring: the drawing layer reads no publisher field, so every figure arrives through a block', !/\.(provenance|observedAt|retrievedAt|valueKind|sourceRegister|rowsOmitted|unavailableReason|license|coverage)\b/.test(body), body.match(/\.(provenance|observedAt|valueKind|unavailableReason)\b/g));
  assert('wiring: no clock in the drawing layer, so no date the bundle does not carry', !/new Date\(\)|Date\.now\(\)/.test(renderer) && !/formatDateTime/.test(renderer), renderer.match(/new Date\(\)|Date\.now\(\)/)?.[0]);
  assert('wiring: the fabricated drawings are gone', !/drawHistogram|drawPieChart|Trend Progression|Impact Allocation/.test(renderer), undefined);
  assert('wiring: a chart is drawn only from the points a block carries', /if \(values\.length === 0\)/.test(renderer) && /point\.y === null/.test(renderer) && !/Math\.random\(/.test(renderer), undefined);
  assert('wiring: the page geometry and identity of the previous layout are kept', /const MARGIN = 25/.test(renderer) && /doc\.rect\(10, 10, pageWidth - 20, pageHeight - 20\)/.test(renderer) && /doc\.rect\(0, 0, pageWidth, 60, 'F'\)/.test(renderer) && /doc\.setFontSize\(42\)/.test(renderer) && /'plain'[\s\S]*theme: block\.theme/.test(renderer) && /Page \$\{page\} of \$\{total\}/.test(renderer), undefined);
  assert('wiring: text is fitted to a typeface that can hold it, and the gap is made visible when none can', /function isWinAnsi|const isWinAnsi/.test(renderer) && /fontHolds/.test(renderer) && /addFileToVFS/.test(renderer) && /addFont/.test(renderer) && /out \+= '\[\?\]'/.test(renderer), renderer.match(/addFileToVFS|fontHolds|\[\?\]/g));
  assert('wiring: the Unicode face is asked for only when the document needs it', /documentNeedsUnicodeFont/.test(renderer) && /const withFont = /.test(renderer), undefined);
  assert('wiring: the exporter tells the caller what it could not render', /unrendered: \[\.\.\.unrendered\]/.test(renderer), undefined);

  const fontModule = read('services/pdfUnicodeFont.ts');
  assert('wiring: the embedded font is one file, named, and its claimed ranges are stated', /AbyssinicaSIL-Regular\.ttf/.test(fontModule) && /extraRanges/.test(fontModule), undefined);
  const license = read('public/fonts/LICENSE-abyssinica.txt');
  assert('wiring: the font ships under a licence that allows embedding', /SIL OPEN FONT LICENSE/i.test(license) && /Copyright/.test(license), license.slice(0, 60));
  assert('wiring: the font file itself is present', existsSync(resolvePath(ROOT, 'public/fonts/AbyssinicaSIL-Regular.ttf')), undefined);

  const panel = read('components/report/InsightReportPanel.tsx');
  assert('wiring: the panel hands the PDF the bundle it is showing, and its interpretation', /generateEvidencePdf\(\{ bundle, payload: insights\.payload \}, loadUnicodeFont\)/.test(panel), panel.match(/generateEvidencePdf\([^\n]*/)?.[0]);
  assert('wiring: a read in flight, a failed read, no read and an all-refused read cannot export', /if \(report\.loading\)/.test(panel) && /if \(insights\.loading\)/.test(panel) && /view\.state === 'error'/.test(panel) && /view\.state === 'no-data'/.test(panel) && /view\.state === 'idle'/.test(panel), undefined);
  assert('wiring: the export waits when the form no longer matches the read on the page', /buildReportQuery\(given\(\)\) !== report\.queriedAs/.test(panel), panel.match(/formDiverged[\s\S]{0,140}/)?.[0]);
  assert('wiring: the button is disabled by the same predicate it explains', /disabled=\{exportHint !== null \|\| exporting\}/.test(panel) && /\{exportHint !== null && !exporting && <p/.test(panel), undefined);
  assert('wiring: a failed export is reported as a failure', /Could not build the PDF/.test(panel), undefined);
  assert('wiring: characters the file could not draw are stated in the UI too', /unrendered/.test(panel) && /exportNotice/.test(panel), panel.match(/unrendered[^\n]*/)?.[0]);

  const button = read('components/ExportButton.tsx');
  assert('wiring: the legacy button passes the same font source', /generatePDFReport\([\s\S]{0,200}loadUnicodeFont\)/.test(button), button.match(/generatePDFReport\([\s\S]{0,120}/)?.[0]);
  assert('wiring: its label no longer claims encryption', !/Encrypt/i.test(button) && /Preparing record/.test(button), button.match(/Encrypt\w*/)?.[0]);
  assert('wiring: no artificial delay stands in for work', !/setTimeout\(resolve, \d+\)/.test(button), button.match(/setTimeout\(resolve, \d+\)/)?.[0]);
  assert('wiring: the profile picker no longer calls itself an authorisation', !/Authorized/.test(button) && /Name[dD] on the record/.test(button), button.match(/Authorized \w+/)?.[0]);
}

/**
 * A fixture bundle has to be a well-formed one or it proves nothing about the contract, so these
 * checks run over the fixtures before the PDF assertions do.
 */
export function checkBundleShape(assert, bundle) {
  const ids = new Set();
  assert(`fixture ${bundle.meta.reference}: four sections in the contract’s order`, bundle.sections.map((s) => s.id).join(',') === 'climate,geospatial,market,economy', bundle.sections.map((s) => s.id));
  assert(`fixture: the register has one line per evidence item`, bundle.meta.sourceRegister.length === bundle.sections.flatMap((s) => s.evidence).length, { register: bundle.meta.sourceRegister.length });
  assert(`fixture: coverage matches the sections’ own statuses`, bundle.sections.every((s) => bundle.meta.coverage[s.id] === s.status), bundle.meta.coverage);
  for (const section of bundle.sections) {
    const errors = section.evidence.filter((e) => e.error !== null);
    // The same rule `lib/report/buildReportBundle.ts` `section()` applies, so a fixture that
    // mislabels its own state is caught before it can mislead a PDF assertion.
    const expected = section.evidence.length === 0 || errors.length === section.evidence.length
      ? 'unavailable'
      : errors.length === 0 ? 'ready' : 'partial';
    assert(`fixture ${section.id}: its status is what its answers imply`, section.status === expected, { status: section.status, expected, answered: section.evidence.length - errors.length, errored: errors.length });
    assert(`fixture ${section.id}: a section with something to show states no reason`, (section.unavailableReason === null) === (section.status !== 'unavailable'), section.unavailableReason);
    for (const item of section.evidence) {
      assert(`fixture ${item.evidenceId}: ids are unique`, !ids.has(item.evidenceId), item.evidenceId);
      ids.add(item.evidenceId);
      assert(`fixture ${item.evidenceId}: a refusal carries no payload`, item.error === null || (item.tables.length === 0 && item.derived.length === 0 && item.charts.every((c) => c.series.every((s) => s.points.length === 0))), { error: item.error?.code });
      // The connector's own fetch-time rule, applied to the fixture before any PDF reads it. The same
      // list `check-report-data.mjs` pins against `lib/data/sources.ts` on every live run, so a fixture
      // cannot be held to a softer contract than the afternoon's real publishers are.
      const dated = item.error === null || !NO_PAYLOAD_CODES.has(item.error.code);
      assert(`fixture ${item.evidenceId}: ${dated ? 'an answer carries the time it was fetched' : 'a refusal dates no fetch'}`,
        dated ? typeof item.provenance.retrievedAt === 'string' && !Number.isNaN(Date.parse(item.provenance.retrievedAt))
          : item.provenance.retrievedAt === null && item.provenance.stale === true,
        { code: item.error?.code, retrievedAt: item.provenance.retrievedAt });
      assert(`fixture ${item.evidenceId}: its register line carries the same fetch time as its evidence`,
        bundle.meta.sourceRegister.find((e) => e.evidenceId === item.evidenceId)?.retrievedAt === item.provenance.retrievedAt,
        { evidence: item.provenance.retrievedAt, register: bundle.meta.sourceRegister.find((e) => e.evidenceId === item.evidenceId)?.retrievedAt });
      for (const table of item.tables) {
        assert(`fixture ${table.evidenceId}: every column of every row is a declared key`, table.rows.every((row) => Object.keys(row).every((k) => table.columns.some((c) => c.key === k))), table.columns.map((c) => c.key));
        assert(`fixture ${table.evidenceId}: a cut table says why and how many`, table.rowsOmitted === 0 || (table.rowsOmitted > 0 && typeof table.omissionNote === 'string' && table.omissionNote.length > 10), { omitted: table.rowsOmitted, note: table.omissionNote });
      }
      for (const chart of item.charts) {
        assert(`fixture ${chart.evidenceId}: a refused chart carries no series`, chart.unavailableReason === null || chart.series.every((s) => s.points.length === 0), chart.unavailableReason);
      }
    }
  }
}

const isWinAnsiWhole = (value) => !NOT_WINANSI.test(value);
export { NOT_WINANSI as UNSAFE_CHAR, codePointName, unsupportedIn, squeeze };

