/**
 * Temporary: run the Phase 5 PDF oracle over a bundle the live publishers produced today.
 *
 * The live harness (`check-report-data.mjs`) stops at its first price probe because HDX's edge
 * now refuses server-side clients ("Blocked due to bot activity", reported as `publisher_blocked`).
 * This runs the same oracle (`pdf-checks.mjs`) over a real bundle whose market section is therefore
 * unavailable, so the PDF rules are still proven against live provenance rather than only against
 * fixtures.
 */

import { register } from 'node:module';
import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkPdfDocument, checkRecordPdf, unicodeFontFromDisk } from './pdf-checks.mjs';

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolvePath(ROOT, join('artifacts', 'pdf'));
register(pathToFileURL(resolvePath(ROOT, 'scripts/ts-report-hooks.mjs')).href, import.meta.url);
const ts = (rel) => import(pathToFileURL(resolvePath(ROOT, rel)).href);

let checks = 0;
let failures = 0;
const assert = (label, cond, detail) => {
  checks += 1;
  if (cond) return true;
  failures += 1;
  console.log(`  FAIL  ${label}${detail === undefined ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
  return false;
};
const note = (line) => console.log(`  note  ${line}`);
const extractText = (file) => {
  const run = spawnSync('pdftotext', ['-enc', 'UTF-8', file, '-'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (run.error || run.status !== 0) throw new Error(`pdftotext: ${run.error?.message ?? run.stderr}`);
  return run.stdout;
};

const { buildReportBundle } = await ts('lib/report/buildReportBundle.ts');
const { describeReport } = await ts('lib/report/reportState.ts');
const { buildEvidencePdf, buildRecordPdf, VALUE_KIND_WORD } = await ts('lib/report/pdfDocument.ts');
const { buildEvidencePackage } = await ts('lib/report/evidencePackage.ts');
const { buildInsightsPayload, validateFindings } = await ts('lib/report/findings.ts');
const { documentNeedsUnicodeFont, generateEvidencePdf, generatePDFReport, pdfSafe } = await ts('services/pdfExport.ts');

const unicodeFont = await unicodeFontFromDisk(ts);
const ctx = {
  assert, note, ts, describeReport, buildEvidencePackage, validateFindings, buildInsightsPayload,
  buildEvidencePdf, generateEvidencePdf, pdfSafe, VALUE_KIND_WORD, documentNeedsUnicodeFont,
  buildRecordPdf, generatePDFReport, unicodeFont, extract: extractText, outDir: OUT_DIR,
};

mkdirSync(OUT_DIR, { recursive: true });

// caller: null because no token was verified in this process — the route does that, and a bundle
// built here must not print a confirmed-session line this run cannot stand behind.
const build = await buildReportBundle({ months: 6, composites: 3, caller: null });
if (!assert('live: a bundle was built', build.ok === true, build.error)) process.exit(2);
const bundle = build.bundle;
console.log(`  note  scope ${JSON.stringify(bundle.meta.scope)} mode ${bundle.meta.mode}`);
for (const s of bundle.sections) console.log(`  note  section ${s.id}: ${s.status}, ${s.evidence.length} evidence, reason ${s.unavailableReason ?? 'none'}`);
const view = describeReport({ loading: false, error: null, bundle });
console.log(`  note  describeReport state ${view.state} — ${view.headline}`);

await checkPdfDocument(ctx, { label: 'live bundle 03 Nov', bundle });
await checkRecordPdf(ctx, { label: 'record', outFile: join(OUT_DIR, 'live-analysis-record.pdf') });

console.log(`\n${checks - failures}/${checks} assertions passed.`);
process.exit(failures > 0 ? 1 : 0);
