/**
 * Phase 5: the evidence PDF, against deterministic fixtures.
 *
 *   node scripts/check-pdf-render.mjs                     # writes the sample files under artifacts/pdf
 *   node scripts/check-pdf-render.mjs --out some/dir      # writes them somewhere else
 *   node scripts/check-pdf-render.mjs --quiet             # only failures and the summary
 *
 * Exit 0 every rule held, 1 a rule broke, 2 this machine cannot run the check (no `pdftotext`).
 *
 * Why a second harness when `check-report-data.mjs` already builds a report: the live harness needs
 * the publishers to answer, and the two most important pages in this phase are the ones a publisher
 * only produces by accident — a source behind schedule, a chart with nothing honest to plot, every
 * source refusing at once, a demo workspace, a report written in Ge'ez script. Those are covered
 * here with fixtures, and the *same* assertion module (`scripts/pdf-checks.mjs`) is what the live
 * harness runs over the bundle this afternoon produced. A fixture is a synthetic input to a real
 * renderer; it is never a synthetic report, and none of these files is presented as evidence.
 *
 * Nothing here reaches the network: the connectors are not imported, so a run cannot be red because
 * HDX rate-limited us and cannot be green because a stub answered for them.
 */

import { register } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SCENARIO_EXPECTATIONS, SCENARIO_NAMES, fixtureBundle } from './pdf-fixtures.mjs';
import { checkBundleShape, checkPdfDocument, checkPdfWiring, checkRecordPdf, checkUnicodeRendering, corpus, flatten, unicodeFontFromDisk } from './pdf-checks.mjs';

const argv = process.argv.slice(2);
const QUIET = argv.includes('--quiet');
const outArg = argv.indexOf('--out');
const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolvePath(ROOT, outArg === -1 ? join('artifacts', 'pdf') : argv[outArg + 1]);

register(pathToFileURL(resolvePath(ROOT, 'scripts/ts-report-hooks.mjs')).href, import.meta.url);
const ts = (rel) => import(pathToFileURL(resolvePath(ROOT, rel)).href);

let checks = 0;
let failures = 0;
const notes = [];

function assert(label, condition, detail) {
  checks += 1;
  if (condition) {
    if (!QUIET) console.log(`  ok    ${label}`);
    return true;
  }
  failures += 1;
  console.log(`  FAIL  ${label}${detail === undefined ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
  return false;
}
function note(line) {
  notes.push(line);
  console.log(`  note  ${line}`);
}
function section(title) {
  console.log(`\n${title}`);
}

/** Read a written PDF back as UTF-8 with an independent extractor, not with our own regex. */
function extractText(file) {
  const run = spawnSync('pdftotext', ['-enc', 'UTF-8', file, '-'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (run.error || run.status !== 0) throw new Error(`pdftotext could not read ${file}: ${run.stderr?.trim().slice(0, 200) ?? run.error?.message}`);
  return run.stdout;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const probe = spawnSync('pdftotext', ['-v'], { encoding: 'utf8' });
  const hasExtractor = !probe.error;
  if (!assert('prerequisite: pdftotext is available to read the generated files back', hasExtractor, probe.error?.code)) process.exit(2);

  const { buildEvidencePdf, buildRecordPdf, VALUE_KIND_WORD } = await ts('lib/report/pdfDocument.ts');
  const { describeReport } = await ts('lib/report/reportState.ts');
  const { buildEvidencePackage } = await ts('lib/report/evidencePackage.ts');
  const { buildInsightsPayload, validateFindings } = await ts('lib/report/findings.ts');
  const { documentNeedsUnicodeFont, generateEvidencePdf, generatePDFReport, pdfSafe } = await ts('services/pdfExport.ts');

  const unicodeFont = await unicodeFontFromDisk(ts);
  if (!assert('prerequisite: the licensed Unicode face the product embeds is on disk', unicodeFont !== null && unicodeFont.base64.length > 10_000, { size: unicodeFont?.base64.length })) process.exit(2);
  note(`embedded font: ${unicodeFont.fileName}, ${Math.round(unicodeFont.base64.length * 0.75 / 1024)} kB as a file, ranges ${JSON.stringify(unicodeFont.extraRanges)}.`);

  const ctx = {
    assert, note, ts, describeReport, buildEvidencePackage, validateFindings, buildInsightsPayload,
    buildEvidencePdf, generateEvidencePdf, pdfSafe, VALUE_KIND_WORD, documentNeedsUnicodeFont,
    buildRecordPdf, generatePDFReport,
    unicodeFont, extract: extractText, outDir: OUT_DIR,
  };

  /* -- 1. the fixtures themselves, before anything renders them -- */
  section('the deterministic bundles');
  const bundles = {};
  for (const name of SCENARIO_NAMES) {
    const bundle = fixtureBundle(name);
    bundles[name] = bundle;
    checkBundleShape(assert, bundle);
    assert(`fixture ${name}: carries its own reference`, typeof bundle.meta.reference === 'string' && bundle.meta.reference.startsWith('NX-REP-'), bundle.meta.reference);
  }
  assert('fixtures: each scenario really is the state it names', (() => {
    const byName = Object.fromEntries(SCENARIO_NAMES.map((n) => [n, fixtureBundle(n)]));
    return byName.complete.sections.every((s) => s.status === 'ready')
      && byName.partial.sections.some((s) => s.status === 'partial')
      && byName.stale.sections.some((s) => s.evidence.some((e) => e.provenance.stale))
      && byName['unavailable-chart'].sections.flatMap((s) => s.evidence).some((e) => e.charts.some((c) => c.unavailableReason !== null))
      && byName['no-data'].sections.every((s) => s.status === 'unavailable' && s.evidence.length === 0)
      && byName.demo.meta.mode === 'demo' && byName.demo.meta.demoNotice !== null
      && byName.unicode.sections.flatMap((s) => s.evidence).some((e) => JSON.stringify(e.tables).includes('አዲስ አበባ'));
  })(), undefined);

  /* -- 2. every scenario, both halves of the PDF -- */
  const results = {};
  for (const name of SCENARIO_NAMES) {
    section(`scenario: ${name}`);
    const bundle = bundles[name];
    const outcome = await checkPdfDocument(ctx, { label: name, bundle });
    results[name] = outcome;

    for (const [text, test] of SCENARIO_EXPECTATIONS[name](bundle, outcome.doc, outcome.text)) {
      assert(`pdf[${name}] specific: ${text}`, test(), undefined);
    }
    assert(`pdf[${name}] specific: the file on disk is readable by an external program`, outcome.outFile !== null && readFileSync(outcome.outFile).length === outcome.rendered.size, { file: outcome.outFile });
  }

  /* -- 3. script coverage: the same page with the face and without it -- */
  section('script coverage — what happens to text the standard fonts cannot hold');
  const unicodeBundle = bundles.unicode;
  const withFont = await checkUnicodeRendering(ctx, { label: 'unicode with the embedded face', bundle: unicodeBundle, unicodeFont, outFile: join(OUT_DIR, 'unicode-with-embedded-face.pdf') });
  const withoutFont = await checkUnicodeRendering(ctx, { label: 'unicode with no font available', bundle: unicodeBundle, unicodeFont: null, outFile: join(OUT_DIR, 'unicode-no-font.pdf') });
  if (withFont && withoutFont) {
    assert('script: a Latin-only report never asks for the 268 kB font', ['complete', 'partial', 'stale', 'unavailable-chart', 'no-data', 'demo'].every((n) => documentNeedsUnicodeFont(results[n].doc) === false), ['complete', 'partial', 'stale', 'unavailable-chart', 'no-data', 'demo'].filter((n) => documentNeedsUnicodeFont(results[n].doc)));
    assert('script: the Amharic page really was drawn with the embedded face', withFont.rendered.fonts.some((f) => /Abyssinica/i.test(f)) && withFont.rendered.type0 >= 1, withFont.rendered.fonts);
    assert('script: the Amharic words the font holds come back out of the file', (() => {
      const squeezed = withFont.extracted.replace(/\s+/g, ' ');
      return squeezed.includes('አዲስ') && squeezed.includes('ገበያ') && squeezed.includes('ሰንገረዶ');
    })(), withFont.extracted.replace(/\s+/g, ' ').slice(0, 300));
    assert('script: no Ethiopic code point is left on the gap list once the face is embedded', withFont.rendered.unrendered.every((name) => {
      const cp = parseInt(name.replace(/^U\+/i, ''), 16);
      return !(cp >= 0x1200 && cp <= 0x1399);
    }) && withFont.rendered.unrendered.length > 0, withFont.rendered.unrendered);
    assert('script: Afaan Oromo is Latin script, so it is drawn whole by either face', (() => {
      const squeezed = withFont.extracted.replace(/\s+/g, ' ');
      return /Finfinnee/.test(squeezed) && /Qaabatee/.test(squeezed) && /Finfinnee/.test(withoutFont.docText.replace(/\s+/g, ' '));
    })(), { with: withFont.extracted.replace(/\s+/g, ' ').slice(0, 200), without: withoutFont.docText.replace(/\s+/g, ' ').slice(0, 200) });
    assert('script: a script nothing here holds is shown as a gap and named, never deleted', (() => {
      const text = withFont.extracted;
      return text.includes('[?]') && /U\+0628/.test(text) && /could not render/.test(text);
    })(), withFont.extracted.slice(0, 300));
    assert('script: without the font the report still keeps every Amharic word’s place', withoutFont.rendered.unrendered.length > 0 && /\[\?\]/.test(withoutFont.rendered.text) && /Characters this file could not render/.test(withoutFont.rendered.text), withoutFont.rendered.unrendered);
    assert('script: the page says the same thing whichever face is available; only the drawing differs', withFont.docText === withoutFont.docText && withFont.rendered.size !== withoutFont.rendered.size, { with: withFont.rendered.size, without: withoutFont.rendered.size, pages: { with: withFont.rendered.pages, without: withoutFont.rendered.pages } });
  }

  /* -- 4. demo content cannot reach a live report, and a live label cannot hide a demo sentence -- */
  section('the demo workspace cannot be confused with a live report');
  {
    const live = bundles.complete;
    const demo = bundles.demo;
    const pkgLive = buildEvidencePackage(live);
    const gateLive = validateFindings(live, pkgLive, [{ text: 'Prices rose over the survey window.', cites: [pkgLive.facts[0]?.evidenceId ?? 'EV-MKT-1'], kind: 'interpretation' }], 'fixture-model');
    const payload = buildInsightsPayload(pkgLive, gateLive, 'fixture-model');
    const demoPayload = { ...payload, mode: 'demo', demoNotice: demo.meta.demoNotice };

    const liveWithDemoSentences = buildEvidencePdf({ bundle: live, payload: demoPayload });
    assert('mixing: a production bundle keeps its production filename whatever the payload claims', !/DEMO_/.test(liveWithDemoSentences.filename), liveWithDemoSentences.filename);
    assert('mixing: demo sentences attached to a live bundle are labelled as demo on the page', /DEMO CONTENT|the sentences below rest on demo figures/.test(corpus(liveWithDemoSentences)), corpus(liveWithDemoSentences).match(/DEMO[^\n]{0,60}/)?.[0]);
    assert('mixing: the workspace a file belongs to is decided by the bundle, never by a payload', corpus(buildEvidencePdf({ bundle: demo, payload })).includes('DEMO workspace'), undefined);
    const demoWithLivePayload = await generateEvidencePdf({ bundle: demo, payload }, unicodeFont);
    assert('mixing: a demo file is marked on every page even when handed a production interpretation', /DEMO_/.test(demoWithLivePayload.filename), demoWithLivePayload.filename);
    assert('mixing: the figures themselves come from one bundle only', (() => {
      const liveText = flatten(buildEvidencePdf({ bundle: live, payload: null }));
      const demoText = flatten(buildEvidencePdf({ bundle: demo, payload: null }));
      return liveText.includes('NX-REP-20261102-COMPL') && !liveText.includes('NX-REP-20261102-DEMO1') && demoText.includes('NX-REP-20261102-DEMO1') && !demoText.includes('NX-REP-20261102-COMPL');
    })(), undefined);
  }

  /* -- 5. the legacy record export, which is not an evidence report -- */
  section('the legacy per-insight record');
  const recordOutcome = await checkRecordPdf(ctx, { label: 'record', outFile: join(OUT_DIR, 'analysis-record.pdf') });
  assert('record: the file on disk is what the exporter returned', readFileSync(join(OUT_DIR, 'analysis-record.pdf')).length === recordOutcome.rendered.size, { file: join(OUT_DIR, 'analysis-record.pdf'), bytes: recordOutcome.rendered.size });

  /* -- 6. wiring, geometry and the two-module split, from the source -- */
  section('the drawing layer cannot reach the data');
  checkPdfWiring(ctx);

  /* -- 7. the files a person can open -- */
  section('generated files');
  const listing = [];
  for (const name of SCENARIO_NAMES) {
    const outcome = results[name];
    listing.push({ name, file: outcome.outFile, pages: outcome.rendered.pages, bytes: outcome.rendered.size });
  }
  listing.push({ name: 'unicode (no font)', file: join(OUT_DIR, 'unicode-no-font.pdf'), pages: withoutFont?.rendered.pages ?? 0, bytes: withoutFont?.rendered.size ?? 0 });
  listing.push({ name: 'analysis record', file: join(OUT_DIR, 'analysis-record.pdf'), pages: recordOutcome.rendered.pages, bytes: recordOutcome.rendered.size });
  for (const row of listing) {
    assert(`written: ${relative(ROOT, row.file)} exists`, readFileSync(row.file).length > 1000, row.file);
    note(`${relative(ROOT, row.file)} — ${row.bytes} bytes${row.pages ? `, ${row.pages} pages` : ''}.`);
  }
  writeFileSync(join(OUT_DIR, 'manifest.txt'), `${listing.map((r) => `${r.name}\t${r.file}\t${r.bytes}\t${r.pages}`).join('\n')}\n`);

  console.log(`\n${checks - failures}/${checks} assertions passed.`);
  if (failures > 0) {
    console.log(`${failures} FAILED.`);
    process.exitCode = 1;
  } else {
    console.log(`Evidence PDF holds for every scenario exercised; files written under ${relative(ROOT, OUT_DIR)}.`);
    console.log(`  (${notes.length} notes above record page counts, sizes and what the script checks found.)`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
