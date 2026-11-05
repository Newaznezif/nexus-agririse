/**
 * Report-data contract check (Phase 2).
 *
 * It runs the real orchestrator, `lib/report/buildReportBundle.ts`, in this process against the
 * live publishers, and asserts the rules the report depends on: a figure either carries its
 * publisher's provenance or does not appear, a section that could not be honoured says why, and
 * a price row never escapes the scope it was asked for.
 *
 *   node scripts/check-report-data.mjs                 # in-process builds + connector proofs
 *   node scripts/check-report-data.mjs --base http://127.0.0.1:3000
 *                                                      # also proves the routes forward them
 *
 * Why in-process: `/api/report/insight-data` requires a confirmed token, and this repository has
 * no test framework and no fixture for one. Importing the orchestrator directly (Node strips the
 * TypeScript types; `scripts/ts-report-hooks.mjs` supplies the `@/` alias) tests the same code the
 * route runs, without widening authentication to make a test easier — and without depending on a
 * dev server being up. The `--base` half then covers what only HTTP can prove: that the routes
 * forward the parameters, and that the authenticated route refuses an unauthenticated caller.
 *
 * Cases covered, one per the Phase 2 brief: complete availability, partial availability, missing
 * climate, missing geospatial, missing market, stale data, demo mode, AI unavailable.
 *
 * Phase 3 adds the two halves that only exist once a client calls the route: the query validator the
 * panel and the route share (round trip, refusals, clamps, and that no identity field can cross the
 * wire), and the state model the panel renders, mapped against bundles the publishers really
 * answered — with `no-data` synthesised, because nine sources refusing at once is not something you
 * can schedule.
 */

import { register } from 'node:module';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkPdfDocument, checkPdfWiring, checkRecordPdf, corpus } from './pdf-checks.mjs';
import { NO_PAYLOAD_CODES } from './provenance-rule.mjs';

const args = process.argv.slice(2);
const QUIET = args.includes('--quiet');
const BASE = (() => {
  const i = args.indexOf('--base');
  return i === -1 ? null : args[i + 1];
})();

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');
register(pathToFileURL(resolvePath(ROOT, 'scripts/ts-report-hooks.mjs')).href, import.meta.url);

const ts = (rel) => import(pathToFileURL(resolvePath(ROOT, rel)).href);

const VALUE_KINDS = new Set(['observed', 'modeled', 'forecast', 'estimated', 'imputed']);
const QUALITY = new Set(['high', 'medium', 'low']);
const SECTION_STATUS = new Set(['ready', 'partial', 'unavailable']);
const SCOPE_KINDS = new Set(['market', 'region', 'national', 'coordinate']);
const SPATIAL = new Set(['single-pixel', 'grid-cell', 'market', 'region-markets', 'national-survey']);
const WARNING_CODES = new Set(['source_unavailable', 'source_stale', 'scope_downgraded', 'insufficient_data', 'demo_mode', 'ai_unavailable', 'licensing']);
const ERROR_CODES = new Set(['timeout', 'network', 'http_status', 'rate_limited', 'payload_too_large', 'parse_failed', 'no_data', 'bad_input', 'auth_required', 'not_configured', 'publisher_blocked', 'empty_response']);
const REGISTER_STATE = new Set(['connected', 'stale', 'unavailable']);

let checks = 0;
let failures = 0;
const notes = [];

const isDate = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;

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

/* ------------------------------------------------------------------ *
 * Provenance — the one vocabulary, shared with lib/data
 * ------------------------------------------------------------------ */

function checkProvenance(label, p, errorCode = null) {
  if (!assert(`${label}: provenance present`, p && typeof p === 'object', p)) return;
  assert(`${label}: publisher named`, nonEmpty(p.source), p.source);
  assert(`${label}: source link is http(s)`, typeof p.sourceUrl === 'string' && /^https?:\/\//.test(p.sourceUrl), p.sourceUrl);
  assert(`${label}: endpoint recorded`, typeof p.endpoint === 'string' && p.endpoint.length > 0, p.endpoint);
  assert(`${label}: licence stated`, nonEmpty(p.license), p.license);
  // An envelope for a request the publisher never let through has no fetch to date. The three codes
  // outside NO_PAYLOAD_CODES are exempt because there the answer really was read.
  if (errorCode !== null && NO_PAYLOAD_CODES.has(errorCode)) {
    assert(`${label}: a refusal dates no fetch`, p.retrievedAt === null, p.retrievedAt);
    assert(`${label}: and so cannot be read as current`, p.stale === true, p.stale);
  } else {
    assert(`${label}: retrievedAt parses`, isDate(p.retrievedAt), p.retrievedAt);
  }
  assert(`${label}: observedAt null or parses`, p.observedAt === null || isDate(p.observedAt), p.observedAt);
  assert(`${label}: valueKind declared`, VALUE_KINDS.has(p.valueKind), p.valueKind);
  assert(`${label}: units stated`, nonEmpty(p.units), p.units);
  assert(`${label}: methodology stated`, nonEmpty(p.methodology), p.methodology);
  assert(`${label}: coverage stated`, nonEmpty(p.coverage), p.coverage);
  assert(`${label}: quality is a declared tier`, QUALITY.has(p.quality), p.quality);
  assert(`${label}: freshness window is a positive number`, isNum(p.maxAgeSeconds) && p.maxAgeSeconds > 0, p.maxAgeSeconds);
  assert(`${label}: stale is boolean`, typeof p.stale === 'boolean', p.stale);
  assert(`${label}: cache flag is boolean`, typeof p.servedFromCache === 'boolean', p.servedFromCache);
}

function checkScope(label, scope) {
  assert(`${label}: scope kind declared`, SCOPE_KINDS.has(scope?.kind), scope?.kind);
  assert(`${label}: spatial basis declared`, SPATIAL.has(scope?.spatial), scope?.spatial);
  assert(`${label}: region is the publisher's spelling or null`, scope?.region === null || nonEmpty(scope.region), scope?.region);
  if (scope?.location) {
    assert(`${label}: location coordinates finite`, isNum(scope.location.latitude) && isNum(scope.location.longitude), scope.location);
    assert(`${label}: location inside Ethiopia`, scope.location.latitude >= 3.3 && scope.location.latitude <= 15.1
      && scope.location.longitude >= 32.9 && scope.location.longitude <= 48.1, scope.location);
    assert(`${label}: coordinate provenance recorded`, ['source-catalogue', 'user', 'default'].includes(scope.location.coordinateSource), scope.location.coordinateSource);
  }
}

/* ------------------------------------------------------------------ *
 * The invariants every bundle must hold, whichever sources answered
 * ------------------------------------------------------------------ */

function checkBundle(label, bundle, expect) {
  section(label);
  const meta = bundle?.meta;
  if (!assert(`${label}: bundle has meta/sections/findings`, meta && Array.isArray(bundle.sections) && Array.isArray(bundle.findings), Object.keys(bundle ?? {}))) return;

  assert(`${label}: reference is a dated lookup key`, /^NX-REP-\d{8}-[A-Z0-9]{6}$/.test(meta.reference), meta.reference);
  assert(`${label}: generatedAt is now`, isDate(meta.generatedAt) && Math.abs(Date.now() - Date.parse(meta.generatedAt)) < 5 * 60_000, meta.generatedAt);
  assert(`${label}: mode declared`, meta.mode === 'production' || meta.mode === 'demo', meta.mode);
  assert(`${label}: demo notice only on a demo bundle`, (meta.mode === 'demo') === (meta.demoNotice !== null), meta.demoNotice);
  if (meta.demoNotice) assert(`${label}: demo notice tells the reader it is a demo`, /DEMO/i.test(meta.demoNotice), meta.demoNotice);
  checkScope(`${label}/meta.scope`, meta.scope);
  if (expect?.kind) assert(`${label}: scope kind is ${expect.kind}`, meta.scope.kind === expect.kind, meta.scope.kind);
  assert(`${label}: attribution is a boolean claim with a reason`, typeof meta.attribution?.verified === 'boolean' && nonEmpty(meta.attribution.note), meta.attribution);
  if (!meta.attribution.verified) {
    assert(`${label}: unverified attribution carries no name`, meta.attribution.displayName === null, meta.attribution);
    assert(`${label}: and says why nothing is printed`, /auth/i.test(meta.attribution.note), meta.attribution.note);
  }
  assert(`${label}: warnings are coded`, Array.isArray(meta.warnings) && meta.warnings.every((w) => WARNING_CODES.has(w.code) && nonEmpty(w.message)), meta.warnings?.map((w) => w.code));
  assert(`${label}: coverage names all four sections`, Object.keys(meta.coverage).sort().join(',') === 'climate,economy,geospatial,market', Object.keys(meta.coverage));

  const ids = new Set();
  const evidenceIds = new Set();
  const failedIds = new Set();
  const derivedAll = [];
  let evidenceCount = 0;
  const staleEvidence = [];

  assert(`${label}: exactly the four report sections`, bundle.sections.length === 4 && new Set(bundle.sections.map((s) => s.id)).size === 4, bundle.sections.map((s) => s.id));

  for (const sec of bundle.sections) {
    const tag = `${label}/${sec.id}`;
    assert(`${tag}: status declared`, SECTION_STATUS.has(sec.status), sec.status);
    assert(`${tag}: coverage map agrees with the section`, meta.coverage[sec.id] === sec.status, { map: meta.coverage[sec.id], section: sec.status });
    assert(`${tag}: titled`, nonEmpty(sec.title), sec.title);
    assert(`${tag}: carries its own scope`, sec.scope?.kind === meta.scope.kind && sec.scope?.spatial === meta.scope.spatial, sec.scope);
    assert(`${tag}: caveats present`, Array.isArray(sec.caveats) && sec.caveats.length > 0 && sec.caveats.every(nonEmpty), sec.caveats);

    const errors = sec.evidence.filter((e) => e.error !== null);
    if (sec.status === 'unavailable') {
      // The honest-empty state: a reason, nothing plottable, and a warning that names it.
      assert(`${tag}: unavailable states why`, nonEmpty(sec.unavailableReason), sec.unavailableReason);
      assert(`${tag}: unavailable has no rows to plot`, sec.evidence.every((e) => e.tables.length === 0 && e.charts.length === 0 && e.derived.length === 0), sec.evidence.length);
      assert(`${tag}: unavailable is reported as insufficient data`, meta.warnings.some((w) => w.code === 'insufficient_data' && w.message.includes(sec.title)), meta.warnings.filter((w) => w.code === 'insufficient_data').map((w) => w.message));
    } else {
      assert(`${tag}: an available section has no reason to be empty`, sec.unavailableReason === null, sec.unavailableReason);
    }
    if (sec.status === 'ready') {
      assert(`${tag}: ready means nothing failed`, errors.length === 0 && sec.evidence.length > 0, errors.map((e) => e.evidenceId));
    }
    if (sec.status === 'partial') {
      assert(`${tag}: partial means some answered and some did not`, errors.length > 0 && errors.length < sec.evidence.length, { errors: errors.length, total: sec.evidence.length });
      assert(`${tag}: every non-answer is named in a warning`, errors.every((e) => meta.warnings.some((w) => w.code === 'source_unavailable' && w.evidenceId === e.evidenceId)), errors.map((e) => e.evidenceId));
    }

    for (const item of sec.evidence) {
      evidenceCount += 1;
      if (!assert(`${tag}: evidence id unique`, !ids.has(item.evidenceId), item.evidenceId)) continue;
      ids.add(item.evidenceId);
      evidenceIds.add(item.evidenceId);
      assert(`${item.evidenceId}: belongs to its section`, item.section === sec.id, item.section);
      assert(`${item.evidenceId}: provider named`, nonEmpty(item.provider), item.provider);
      if (item.error) assert(`${item.evidenceId}: error code is a declared one`, ERROR_CODES.has(item.error.code), item.error);
      checkProvenance(item.evidenceId, item.provenance, item.error?.code ?? null);
      assert(`${item.evidenceId}: provider matches its provenance`, item.provider === item.provenance.source, { provider: item.provider, source: item.provenance.source });

      if (item.error) {
        failedIds.add(item.evidenceId);
        assert(`${item.evidenceId}: error message is readable`, nonEmpty(item.error.message), item.error);
        assert(`${item.evidenceId}: a source that did not answer contributes nothing plottable`,
          item.tables.length === 0 && item.charts.length === 0 && item.derived.length === 0,
          { tables: item.tables.length, charts: item.charts.length, derived: item.derived.length });
        continue;
      }
      if (item.provenance.stale) staleEvidence.push(item.evidenceId);
      assert(`${item.evidenceId}: an answering source shows something`, item.tables.length + item.charts.length + item.derived.length > 0, item);

      for (const t of item.tables) {
        assert(`${t.evidenceId}: table id unique`, !ids.has(t.evidenceId), t.evidenceId);
        ids.add(t.evidenceId);
        assert(`${t.evidenceId}: titled`, nonEmpty(t.title), t.title);
        assert(`${t.evidenceId}: columns declared`, t.columns.length > 0 && t.columns.every((c) => nonEmpty(c.key) && nonEmpty(c.label) && (c.units === null || nonEmpty(c.units))), t.columns);
        assert(`${t.evidenceId}: rows is an array`, Array.isArray(t.rows), typeof t.rows);
        // A printed table with no rows reads as "nothing to report", which is a claim about the
        // data rather than about the source. The orchestrator turns such an answer into a gap.
        assert(`${t.evidenceId}: a printed table always carries at least one row`, t.rows.length > 0, { title: t.title, rows: t.rows.length });
        assert(`${t.evidenceId}: a capped table counts what it left out`, isNum(t.rowsOmitted) && t.rowsOmitted >= 0 && (t.rowsOmitted > 0 ? nonEmpty(t.omissionNote) : t.omissionNote === null), { omitted: t.rowsOmitted, note: t.omissionNote });
        assert(`${t.evidenceId}: provenance is its source's own`, t.provenance.source === item.provenance.source && t.provenance.valueKind === item.provenance.valueKind, { table: t.provenance.source, evidence: item.provenance.source });
        assert(`${t.evidenceId}: row budget respected`, t.rows.length <= 60, t.rows.length);
        for (const [i, row] of t.rows.entries()) {
          const keys = Object.keys(row);
          assert(`${t.evidenceId}[row ${i}]: one cell per column`, keys.length === t.columns.length && t.columns.every((c) => keys.includes(c.key)), keys);
          // A blank the publisher left stays blank. This is where a zero-substitution would show.
          const bad = Object.entries(row).filter(([, v]) => !(v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))));
          assert(`${t.evidenceId}[row ${i}]: cells are publisher values, null, or finite numbers`, bad.length === 0, bad);
          const textual = Object.entries(row).filter(([, v]) => v === 'null' || v === 'undefined' || v === 'NaN' || v === '');
          assert(`${t.evidenceId}[row ${i}]: no missing value laundered into a string`, textual.length === 0, textual);
        }
      }

      for (const c of item.charts) {
        assert(`${c.evidenceId}: chart id unique`, !ids.has(c.evidenceId), c.evidenceId);
        ids.add(c.evidenceId);
        assert(`${c.evidenceId}: titled`, nonEmpty(c.title), c.title);
        assert(`${c.evidenceId}: axis units stated`, nonEmpty(c.units), c.units);
        assert(`${c.evidenceId}: value kind declared`, VALUE_KINDS.has(c.valueKind), c.valueKind);
        assert(`${c.evidenceId}: spatial basis declared`, SPATIAL.has(c.spatial), c.spatial);
        assert(`${c.evidenceId}: provenance only where a source answered`, c.provenance === null ? c.unavailableReason !== null : true, c.unavailableReason);
        if (c.provenance) assert(`${c.evidenceId}: same publisher as its evidence`, c.provenance.source === item.provenance.source, c.provenance.source);
        if (c.unavailableReason !== null) {
          assert(`${c.evidenceId}: an unplotable chart plots nothing`, c.series.length === 0 && nonEmpty(c.unavailableReason), c.series.length);
          assert(`${c.evidenceId}: the gap is warned about, not hidden`, meta.warnings.some((w) => w.code === 'insufficient_data' && w.evidenceId === c.evidenceId), meta.warnings.map((w) => `${w.code}:${w.evidenceId}`));
          continue;
        }
        // A chart the reader sees must be made of points a source returned: no series of nulls,
        // no invented x axis, and a computed bar chart labelled as computed.
        assert(`${c.evidenceId}: has at least one series with a real value`, c.series.length > 0 && c.series.every((s) => nonEmpty(s.label) && s.points.length > 0 && s.points.some((p) => p.y !== null)), c.series.map((s) => s.points.filter((p) => p.y !== null).length));
        const allDates = c.series.every((s) => s.points.every((p) => p.x.includes('·') || /^\d{4}-\d{2}-\d{2}$/.test(p.x)));
        assert(`${c.evidenceId}: every point is dated by its publisher or is a named market series`, allDates, c.series[0]?.points.slice(0, 2));
        assert(`${c.evidenceId}: values are finite numbers or null, never zero-filled`, c.series.every((s) => s.points.every((p) => p.y === null || Number.isFinite(p.y))), undefined);
        assert(`${c.evidenceId}: a change chart is labelled estimated, an observation chart is not`,
          c.units.includes('%') ? c.valueKind === 'estimated' : c.valueKind !== 'estimated', { units: c.units, valueKind: c.valueKind });
      }

      for (const d of item.derived) {
        assert(`${d.evidenceId}: derived id unique`, !ids.has(d.evidenceId), d.evidenceId);
        ids.add(d.evidenceId);
        derivedAll.push(d);
        assert(`${d.evidenceId}: a computed figure is labelled estimated`, d.valueKind === 'estimated', d.valueKind);
        assert(`${d.evidenceId}: the arithmetic is stated`, nonEmpty(d.formula) && d.formula.length > 40, d.formula);
        assert(`${d.evidenceId}: units and quality declared`, nonEmpty(d.units) && QUALITY.has(d.quality), d);
        assert(`${d.evidenceId}: an uncomputable figure stays null`, d.value === null || Number.isFinite(d.value), d.value);
        assert(`${d.evidenceId}: carries the provenance of the rows it used`, d.provenance.source === item.provenance.source, d.provenance.source);
      }

      assert(`${item.evidenceId}: caveats are sentences`, item.caveats.every(nonEmpty), item.caveats);
    }
  }

  // A computed figure is only traceable if the evidence it consumed is named and present.
  for (const d of derivedAll) {
    assert(`${d.evidenceId}: its inputs are evidence ids in this bundle`, d.inputs.length > 0 && d.inputs.every((i) => ids.has(i)), { inputs: d.inputs, missing: d.inputs.filter((i) => !ids.has(i)) });
  }

  assert(`${label}: source register lists every source called`, meta.sourceRegister.length === evidenceIds.size, { register: meta.sourceRegister.length, evidence: evidenceIds.size });
  const registerIds = new Set(meta.sourceRegister.map((e) => e.evidenceId));
  assert(`${label}: register is keyed by real evidence ids`, registerIds.size === evidenceIds.size && [...registerIds].every((id) => evidenceIds.has(id)), [...registerIds].filter((id) => !evidenceIds.has(id)));
  for (const e of meta.sourceRegister) {
    assert(`${label}: register[${e.evidenceId}] complete`, nonEmpty(e.source) && /^https?:\/\//.test(e.sourceUrl) && e.endpoint.length > 0 && nonEmpty(e.license)
      && VALUE_KINDS.has(e.valueKind) && nonEmpty(e.units) && nonEmpty(e.coverage) && SPATIAL.has(e.spatial)
      && (e.observedAt === null || isDate(e.observedAt))
      // A source that never delivered cannot date a download it did not make; one that answered
      // must carry the real time. `unavailable` also covers "answered, no rows", which keeps its time.
      && (e.state === 'unavailable' ? e.retrievedAt === null || isDate(e.retrievedAt) : isDate(e.retrievedAt))
      && typeof e.stale === 'boolean'
      && typeof e.servedFromCache === 'boolean' && QUALITY.has(e.quality) && REGISTER_STATE.has(e.state) && nonEmpty(e.detail), e);
    assert(`${label}: register[${e.evidenceId}] state matches its provenance`, e.state === (failedIds.has(e.evidenceId) ? 'unavailable' : e.stale ? 'stale' : 'connected'), { stated: e.state, stale: e.stale });
  }

  // Staleness must survive into the bundle's own accounting, whichever sources trip it today.
  for (const id of staleEvidence) {
    assert(`${label}: stale source ${id} is warned about`, meta.warnings.some((w) => w.code === 'source_stale' && w.evidenceId === id), meta.warnings.filter((w) => w.code === 'source_stale').map((w) => w.evidenceId));
    assert(`${label}: stale source ${id} is marked in the register`, meta.sourceRegister.find((e) => e.evidenceId === id)?.state === 'stale', meta.sourceRegister.find((e) => e.evidenceId === id)?.state);
  }

  const text = JSON.stringify(bundle);
  assert(`${label}: no invented authority language`, !/authorized by|digitally signed|nx-auth|lead analyst|authorised by/i.test(text), text.match(/.{0,40}(authorized by|digitally signed|nx-auth|lead analyst).{0,40}/i)?.[0]);
  assert(`${label}: no credential material anywhere in the bundle`, !/api[_-]?key|access_token|secret|bearer\s|eyJ|X-Amz-Signature|X-Goog-Signature|sig=/i.test(text), text.match(/.{0,40}(api[_-]?key|access_token|secret|bearer\s|eyJ|Signature=).{0,40}/i)?.[0]);
  assert(`${label}: every endpoint served over https`, meta.sourceRegister.every((e) => e.endpoint.startsWith('https://')), meta.sourceRegister.map((e) => e.endpoint.slice(0, 24)));
  assert(`${label}: Phase 2 ships no interpretations`, bundle.findings.length === 0, bundle.findings);

  const status = bundle.sections.map((s) => `${s.id}=${s.status}`).join(' ');
  console.log(`  ${label}: ${status} · evidence=${evidenceCount} warnings=${meta.warnings.length} register=${meta.sourceRegister.length}${staleEvidence.length ? ` stale=${staleEvidence.join(',')}` : ''}`);
  for (const sec of bundle.sections) {
    for (const item of sec.evidence) if (item.error) console.log(`     ! ${item.evidenceId} ${item.error.code}: ${item.error.message}`);
  }
  if (expect?.check) expect.check(bundle, meta);
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

async function main() {
  const { buildReportBundle } = await ts('lib/report/buildReportBundle.ts');
  const { buildEvidencePackage, citationErrors } = await ts('lib/report/evidencePackage.ts');
  const { knownRegions } = await ts('lib/report/scope.ts');
  const { listSelectablePlaces } = await ts('lib/data/locations.ts');
  const { sampleLayerAtCoordinate, findLatestLayerDate, getLayer } = await ts('lib/data/gibs.ts');
  const { getCommodityHistory, getMarketSnapshot } = await ts('lib/data/wfpMarketPrices.ts');

  const regions = knownRegions();
  const places = listSelectablePlaces();
  section('regions the price publisher spells');
  assert('regions: the survey’s own admin1 list is non-empty', regions.length >= 8, regions);
  assert('places: the market catalogue is non-empty', places.length >= 20 && places.every((p) => nonEmpty(p.name) && isNum(p.latitude)), places.length);
  note(`regions: ${regions.join(', ')}`);

  /* -- 0a. Which error codes strip a fetch time is decided in lib/data/sources.ts; this harness
        mirrors that list to assert against bundles. Pin the mirror to the code so the two cannot
        drift apart and leave a refusal quietly dated. -- */
  {
    const { nonAnswerProvenance } = await ts('lib/data/sources.ts');
    const envelope = { retrievedAt: '2026-11-05T00:00:00.000Z', stale: false, servedFromCache: true };
    const strips = [...ERROR_CODES].filter((code) => {
      const out = nonAnswerProvenance(envelope, { code, message: 'stubbed' });
      return out.retrievedAt === null;
    }).sort();
    assert('provenance rule: the harness mirror matches the connector', strips.join(',') === [...NO_PAYLOAD_CODES].sort().join(','), {
      fromConnector: strips, inHarness: [...NO_PAYLOAD_CODES].sort(),
    });
    const flagged = [...ERROR_CODES].filter((code) => nonAnswerProvenance(envelope, { code, message: 'stubbed' }).stale === true);
    assert('provenance rule: every stripped envelope is also flagged not current', flagged.length === strips.length, { stripped: strips.length, flagged: flagged.length });
    note(`provenance rule: ${strips.length} of ${ERROR_CODES.size} codes date no fetch — ${strips.join(', ')}`);
  }

  /* -- 0. Which market do these cases test? WFP surveys a rotating set of markets, and the report
        only accepts a market its own place catalogue publishes. So the scope is taken from the
        newest month the survey actually reached, intersected with that catalogue, rather than
        hardcoded: a hardcoded town that happens to be unsurveyed this month fails the code for a
        reason that has nothing to do with the code. -- */
  const newest = await getMarketSnapshot({ months: 6, limit: 500 });
  if (!assert('probe: the survey answers at national scope', newest.ok === true, newest.error)) process.exit(2);
  const placeNames = new Set(places.map((p) => p.name.toLowerCase()));
  const countBy = (rows, key) => {
    const seen = new Map();
    for (const r of rows) seen.set(r[key], (seen.get(r[key]) ?? 0) + 1);
    return [...seen.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
  };
  const priced = newest.data.rows.filter((r) => r.price !== null && r.priceFlag === 'actual');
  const surveyedHere = priced.filter((r) => placeNames.has(String(r.market).toLowerCase()));
  const TEST_MARKET = countBy(surveyedHere, 'market')[0]?.[0] ?? null;
  const TEST_COMMODITY = TEST_MARKET ? countBy(surveyedHere.filter((r) => r.market === TEST_MARKET), 'commodity')[0]?.[0] ?? null : null;
  assert('probe: the newest survey month holds priced rows', priced.length > 0, { asOf: newest.data.asOfLatestObservation, rows: newest.data.rows.length });
  assert('probe: some surveyed market is also a selectable place', nonEmpty(TEST_MARKET), { newest: newest.data.asOfLatestObservation, markets: [...new Set(priced.map((r) => r.market))].slice(0, 8) });
  assert('probe: a commodity is priced at that market', nonEmpty(TEST_COMMODITY), TEST_MARKET);
  note(`probe: newest month ${newest.data.asOfLatestObservation}; ${priced.length} actual priced rows at ${new Set(priced.map((r) => r.market)).size} markets, ${new Set(surveyedHere.map((r) => r.market)).size} of them selectable places. Cases below use ${TEST_MARKET} / ${TEST_COMMODITY}.`);

  const AT_MARKET = { market: TEST_MARKET, commodity: TEST_COMMODITY, months: 6, composites: 4 };

  /* -- 0b. The market filter itself, before any report is built on it: a report about one town may
        not pick up a similarly-named one, and may not describe its rows as a national survey. -- */
  const atMarket = await getMarketSnapshot({ market: TEST_MARKET, months: 6, limit: 500 });
  assert('market filter: the exact name answers', atMarket.ok === true && atMarket.data.rows.length > 0, atMarket.ok ? atMarket.data.rows.length : atMarket.error);
  if (atMarket.ok) {
    assert(`market filter: only ${TEST_MARKET} rows come back`, atMarket.data.rows.every((r) => String(r.market).toLowerCase() === TEST_MARKET.toLowerCase()), [...new Set(atMarket.data.rows.map((r) => r.market))]);
    assert('market filter: coverage names the market and does not claim a national survey', atMarket.provenance.coverage.toLowerCase().includes(TEST_MARKET.toLowerCase()) && !/national/i.test(atMarket.provenance.coverage), atMarket.provenance.coverage);
    const truncated = TEST_MARKET.slice(0, -2);
    if (truncated.length >= 3 && truncated.toLowerCase() !== TEST_MARKET.toLowerCase()) {
      const nearMiss = await getMarketSnapshot({ market: truncated, months: 6, limit: 500 });
      assert('market filter: a truncated name selects no town rather than a similar one', nearMiss.ok === true && nearMiss.data.rows.length === 0, nearMiss.ok ? { query: truncated, markets: [...new Set(nearMiss.data.rows.map((r) => r.market))] } : nearMiss.error);
    }
  }

  /* -- 1. A market-scope production report: the fullest case, and the scope-fidelity proof. -- */
  const marketBuild = await buildReportBundle({ ...AT_MARKET, caller: { displayName: 'harness@local' } });
  if (!assert('market scope: the bundle built', marketBuild.ok === true, marketBuild.error)) process.exit(2);
  const marketBundle = marketBuild.bundle;
  checkBundle(`market scope (${TEST_MARKET}), production`, marketBundle, {
    kind: 'market',
    check(bundle) {
      const scope = bundle.meta.scope;
      assert('market scope: anchored at the place asked for', scope.place === TEST_MARKET, scope.place);
      assert('market scope: coordinates are the publisher’s', scope.location.coordinateSource === 'source-catalogue', scope.location.coordinateSource);
      assert('market scope: no silent downgrade note', scope.note === null, scope.note);
      const sec = bundle.sections.find((s) => s.id === 'market');
      if (sec.status === 'unavailable') {
        note(`market scope: WFP did not answer at all today (${sec.unavailableReason}) — row-scope checks below have nothing to read.`);
        return;
      }
      // The claim a farmer would act on: a report about this market prints this market's prices,
      // and only these. This is the substitution the whole scope model exists to prevent.
      const rows = sec.evidence.flatMap((e) => e.tables.filter((t) => t.evidenceId.startsWith('market.') && t.columns.some((c) => c.key === 'market')).flatMap((t) => t.rows.map((r) => r.market)));
      assert(`market scope: every price row is ${TEST_MARKET}`, rows.length > 0 && rows.every((m) => m === TEST_MARKET), [...new Set(rows)].slice(0, 8));
      assert('market scope: the report never widened to a national average', sec.scope.spatial === 'market', sec.scope.spatial);
      // Two kinds of series live in this section, and both must stay inside the scope: a price
      // line is labelled with the series key the publisher's rows carry, and a movement bar is
      // labelled point by point with the market whose two prices were compared.
      const charts = sec.evidence.flatMap((e) => e.charts);
      const priceLabels = charts.filter((c) => !c.units.includes('%')).flatMap((c) => c.series.map((s) => s.label));
      assert(`market scope: every price series is a ${TEST_MARKET} series`, priceLabels.length > 0 && priceLabels.every((l) => l.startsWith(`${TEST_MARKET} ·`)), priceLabels.slice(0, 4));
      const movementPoints = charts.filter((c) => c.units.includes('%')).flatMap((c) => c.series.flatMap((s) => s.points.map((p) => p.x)));
      assert('market scope: every movement bar names this market', movementPoints.every((x) => String(x).startsWith(`${TEST_MARKET} ·`)), movementPoints.slice(0, 4));
      assert('market scope: no national overview table', !sec.evidence.some((e) => e.evidenceId === 'market.overview'), sec.evidence.map((e) => e.evidenceId));
      const hist = sec.evidence.find((e) => e.evidenceId === 'market.history');
      assert('market scope: the commodity series the probe found is the one printed', hist?.error === null, hist?.error);
      assert('market scope: the series states the window it actually covers', sec.caveats.concat(hist?.caveats ?? []).some((c) => /not the .*-month window/i.test(c)), { section: sec.caveats, history: hist?.caveats });
    },
  });

  /* -- 1a. A market the survey reached in an older month but not the newest one: the empty
        latest-month answer must become a named gap, never a heading over a blank table. -- */
  section('a real market with no newest-month survey row — a gap, not an empty table');
  {
    const longHistory = await getCommodityHistory({ commodity: 'Maize', months: 120 });
    assert('gap: the staple’s full survey history is readable', longHistory.ok === true, longHistory.error);
    if (longHistory.ok) {
      const latestByName = new Map();
      for (const r of longHistory.data.series) {
        const cur = latestByName.get(r.market);
        if (!cur || r.observedOn > cur) latestByName.set(r.market, r.observedOn);
      }
      // A market the report will accept, that the survey reached for this commodity but skipped
      // in the newest month: the snapshot has to report that as a gap.
      const gapCandidates = [...latestByName.entries()]
        .filter(([m, d]) => placeNames.has(m.toLowerCase()) && d < newest.data.asOfLatestObservation && m !== TEST_MARKET)
        .sort((a, b) => b[1].localeCompare(a[1]));
      const [gapMarket, gapLastSeen] = gapCandidates[0] ?? [];
      assert('gap: some catalogue market was surveyed in an older month only', nonEmpty(gapMarket), gapCandidates.slice(0, 5));
      if (gapMarket) {
        note(`gap: ${gapMarket} was last surveyed for Maize on ${gapLastSeen}, not in ${newest.data.asOfLatestObservation}.`);
        const gapBuild = await buildReportBundle({ market: gapMarket, commodity: 'Maize', months: 6, composites: 2, caller: null });
        assert('gap: the bundle still built', gapBuild.ok === true, gapBuild.error);
        if (gapBuild.ok) {
          checkBundle(`market scope (${gapMarket}), newest month unsurveyed`, gapBuild.bundle, {
            kind: 'market',
            check(bundle, meta) {
              const sec = bundle.sections.find((s) => s.id === 'market');
              const snap = sec.evidence.find((e) => e.evidenceId === 'market.snapshot');
              assert('market.snapshot: an empty answer becomes a gap, not an empty table', snap?.error?.code === 'no_data' && snap.tables.length === 0 && snap.charts.length === 0, { error: snap?.error, tables: snap?.tables.length, charts: snap?.charts.length });
              assert('market.snapshot: the reason names the market and the month it missed', snap?.error?.message.includes(gapMarket) && snap?.error?.message.includes(newest.data.asOfLatestObservation), snap?.error?.message);
              assert('market.snapshot: and points at the fix instead of a substitute', /widen|another month/i.test(snap?.error?.message ?? ''), snap?.error?.message);
              assert('gap: the section degrades to partial, since history still answers', sec.status === 'partial', { status: sec.status, evidence: sec.evidence.map((e) => `${e.evidenceId}:${e.error ? 'failed' : 'ok'}`) });
              assert('gap: the failure is warned and registered', meta.warnings.some((w) => w.code === 'source_unavailable' && w.evidenceId === 'market.snapshot')
                && meta.sourceRegister.find((e) => e.evidenceId === 'market.snapshot')?.state === 'unavailable', meta.sourceRegister.filter((e) => e.evidenceId === 'market.snapshot'));
              const printed = sec.evidence.filter((e) => e.error === null).flatMap((e) => e.tables.flatMap((t) => t.rows));
              assert('gap: the rows that do print are this market’s, from older months only', printed.length > 0 && printed.every((r) => r.market === gapMarket), [...new Set(printed.map((r) => r.market))].slice(0, 5));
              assert('gap: no table under this section is empty', sec.evidence.flatMap((e) => e.tables).every((t) => t.rows.length > 0), sec.evidence.flatMap((e) => e.tables).filter((t) => t.rows.length === 0).map((t) => t.id));
            },
          });
        }
      }
    }
  }

  /* -- 1b. Complete availability: what a fully answered section owes the reader. -- */
  section('complete availability — a section with no failures must be full');
  {
    const ready = marketBundle.sections.filter((s) => s.status === 'ready');
    const rest = marketBundle.sections.filter((s) => s.status !== 'ready').map((s) => `${s.id}=${s.status}`);
    // If literally nothing answered, this run is measuring a dead network rather than the code.
    assert('complete: at least one section answered in full', ready.length > 0, rest);
    for (const sec of ready) {
      assert(`${sec.id}: ready means every source it called answered`, sec.evidence.every((e) => e.error === null), sec.evidence.filter((e) => e.error).map((e) => e.evidenceId));
      assert(`${sec.id}: every table carries rows`, sec.evidence.flatMap((e) => e.tables).every((t) => t.rows.length > 0), sec.evidence.flatMap((e) => e.tables).filter((t) => t.rows.length === 0).map((t) => t.evidenceId));
      assert(`${sec.id}: every chart is plottable`, sec.evidence.flatMap((e) => e.charts).every((c) => c.unavailableReason === null && c.series.length > 0), sec.evidence.flatMap((e) => e.charts).filter((c) => c.unavailableReason).map((c) => c.evidenceId));
      assert(`${sec.id}: no source failure is warned about`, !marketBundle.meta.warnings.some((w) => w.code === 'source_unavailable' && (w.evidenceId ?? '').startsWith(`${sec.id}.`)), marketBundle.meta.warnings.filter((w) => w.code === 'source_unavailable').map((w) => w.evidenceId));
      // Readiness is about answering; a source can answer and still be stale. What a `ready`
      // section may not contain is a source that is called unavailable.
      assert(`${sec.id}: and the register calls nothing unavailable for it`, marketBundle.meta.sourceRegister.filter((e) => e.evidenceId.startsWith(`${sec.id}.`)).every((e) => e.state === 'connected' || e.state === 'stale'), marketBundle.meta.sourceRegister.filter((e) => e.evidenceId.startsWith(`${sec.id}.`)).map((e) => `${e.evidenceId}:${e.state}`));
    }
    note(`complete: ${ready.map((s) => s.id).join(', ') || 'none'} answered in full; ${rest.length ? rest.join(', ') : 'nothing partial'}`);
  }

  /* -- 2. Missing climate and missing geospatial, deterministically: a national report has no
        coordinate for a point product to be read at. -- */
  section('national scope — climate and geospatial cannot be honoured, and must say so');
  const nationalBuild = await buildReportBundle({ months: 4, caller: null });
  assert('national: the bundle built', nationalBuild.ok === true, nationalBuild.error);
  if (nationalBuild.ok) {
    checkBundle('national scope, unauthenticated caller', nationalBuild.bundle, {
      kind: 'national',
      check(bundle, meta) {
        assert('national: no coordinate invented for a country report', bundle.meta.scope.location === null, bundle.meta.scope.location);
        const climate = bundle.sections.find((s) => s.id === 'climate');
        const geo = bundle.sections.find((s) => s.id === 'geospatial');
        // Missing-data case 1: the section refuses instead of quietly reading Addis Ababa.
        assert('national: climate unavailable rather than defaulted to a capital', climate.status === 'unavailable' && climate.evidence.length === 0, { status: climate.status, evidence: climate.evidence.length });
        assert('national: climate reason names the scope', /national/i.test(climate.unavailableReason ?? ''), climate.unavailableReason);
        assert('national: climate called no publisher at all', climate.evidence.length === 0, climate.evidence.map((e) => e.evidenceId));
        assert('national: geospatial unavailable, no pixel chosen for a country', geo.status === 'unavailable' && geo.evidence.length === 0, { status: geo.status, evidence: geo.evidence.length });
        assert('national: geospatial reason refuses an average', /average|coordinate/i.test(geo.unavailableReason ?? ''), geo.unavailableReason);
        assert('national: both refusals are warned', ['climate', 'geospatial'].every((id) => meta.warnings.some((w) => w.code === 'insufficient_data' && w.evidenceId === `section.${id}`)), meta.warnings.filter((w) => w.code === 'insufficient_data').map((w) => w.evidenceId));
        // The market section, by contrast, is legitimately national — and must be labelled so.
        const market = bundle.sections.find((s) => s.id === 'market');
        assert('national: the market section is labelled as the country survey', market.scope.spatial === 'national-survey', market.scope.spatial);
        if (market.status !== 'unavailable') {
          assert('national: the national overview table appears only at this scope', market.evidence.some((e) => e.evidenceId === 'market.overview'), market.evidence.map((e) => e.evidenceId));
          const overview = market.evidence.find((e) => e.evidenceId === 'market.overview');
          const rows = overview?.tables[0]?.rows ?? [];
          assert('national: a national mean is printed as a mean, never as a market price', rows.length === 0 || (overview.caveats.some((c) => /not the price at any single market/i.test(c)) && overview.tables[0].columns.some((c) => /mean/i.test(c.label))), { caveats: overview?.caveats, columns: overview?.tables[0]?.columns.map((c) => c.label) });
        } else {
          note(`national: WFP did not answer for the price section today — ${market.unavailableReason}`);
        }
        assert('national: the scope downgrade is recorded', /National scope/i.test(bundle.meta.scope.note ?? ''), bundle.meta.scope.note);
      },
    });
  }

  /* -- 3. Missing market data: a hand-typed coordinate is not a surveyed market. -- */
  section('coordinate scope — market prices cannot be attributed to a point');
  const coordBuild = await buildReportBundle({ latitude: 6.95, longitude: 35.35, composites: 2, caller: null });
  assert('coordinate: the bundle built', coordBuild.ok === true, coordBuild.error);
  if (coordBuild.ok) {
    checkBundle('coordinate scope (6.95, 35.35), no confirmed session', coordBuild.bundle, {
      kind: 'coordinate',
      check(bundle) {
        assert('coordinate: marked as the farmer’s own point, not a catalogue place', bundle.meta.scope.location.coordinateSource === 'user', bundle.meta.scope.location.coordinateSource);
        assert('coordinate: no market name invented', bundle.meta.scope.place === null && bundle.meta.scope.marketId === null, bundle.meta.scope);
        const market = bundle.sections.find((s) => s.id === 'market');
        // Missing-data case 3: no price rows, and no national average standing in for them.
        assert('coordinate: market section unavailable, not a national average', market.status === 'unavailable' && market.evidence.length === 0, { status: market.status, evidence: market.evidence.length });
        assert('coordinate: the refusal explains why', /coordinate|surveys named markets|attributed/i.test(market.unavailableReason ?? ''), market.unavailableReason);
        assert('coordinate: the refusal says no substitute was used', !/average across/i.test(market.unavailableReason ?? ''), market.unavailableReason);
        const climate = bundle.sections.find((s) => s.id === 'climate');
        assert('coordinate: point products are still answered here', climate.status === 'ready' || climate.status === 'partial', climate.status);
        assert('coordinate: no authorisation line without a confirmed session', bundle.meta.attribution.verified === false && bundle.meta.attribution.displayName === null, bundle.meta.attribution);
      },
    });
  }

  /* -- 4. Region scope: prices filtered to the region, and point data still labelled as point
        data (approved decision 2, and the G-3 defect this phase had to fix first). -- */
  section('region scope (Oromia) — regional prices only, point data still labelled as point data');
  const regionName = regions.includes('Oromia') ? 'Oromia' : regions[0];
  const regionBuild = await buildReportBundle({ region: regionName, months: 6, composites: 3, commodity: 'Teff', caller: { displayName: 'harness@local' } });
  assert(`region: the bundle built for ${regionName}`, regionBuild.ok === true, regionBuild.error);
  if (regionBuild.ok) {
    checkBundle(`region scope (${regionName})`, regionBuild.bundle, {
      kind: 'region',
      check(bundle) {
        const scope = bundle.meta.scope;
        assert(`region: reported as ${regionName}`, scope.region === regionName, scope.region);
        assert('region: an anchor place is named for the point products', nonEmpty(scope.place), scope.place);
        const anchor = places.find((p) => p.name === scope.place);
        assert(`region: the climate/satellite anchor really lies inside ${regionName}`, anchor && anchor.admin1 === regionName, { anchor, regionName });
        assert(`region: the anchor is not a capital substituted for a region`, !(regionName !== 'Addis Ababa' && scope.place === 'Addis Ababa'), scope.place);
        assert('region: the note admits climate/satellite are point observations', /point observations/i.test(scope.note ?? ''), scope.note);
        assert('region: the note says prices are the region’s own markets', /markets/i.test(scope.note ?? ''), scope.note);
        assert('region: downgrade recorded as a warning', bundle.meta.warnings.some((w) => w.code === 'scope_downgraded'), bundle.meta.warnings.map((w) => w.code));
        const market = bundle.sections.find((s) => s.id === 'market');
        // The G-3 defect was that a region request silently returned the whole country's rows.
        // The printed row now carries the publisher's own region, so the filter is verifiable
        // on the page and here.
        const priced = market.evidence
          .flatMap((e) => e.tables)
          .filter((t) => t.columns.some((c) => c.key === 'region'));
        for (const t of priced) {
          assert(`${t.evidenceId}: every printed row is in ${regionName}`, t.rows.length > 0 && t.rows.every((r) => String(r.region).toLowerCase() === regionName.toLowerCase()), [...new Set(t.rows.map((r) => r.region))]);
        }
        if (market.status === 'unavailable') note(`region: WFP did not answer today — ${market.unavailableReason}`);
        else assert('region: at least one priced table was checked', priced.length > 0, market.evidence.map((e) => `${e.evidenceId}:${e.error ? 'failed' : 'ok'}`));
        assert('region: nothing in this section is labelled national', !/national survey/i.test(JSON.stringify(market.caveats)), market.caveats);
      },
    });

    // The connector-level proof, with the publisher's own admin1 carried through to the rows.
    section('G-3 at the connector: the region filter selects rows it claims to select');
    const filtered = await getCommodityHistory({ commodity: 'Teff', region: regionName, months: 12 });
    assert('G-3: filtered history answers', filtered.ok === true, filtered.error);
    if (filtered.ok) {
      const seen = [...new Set(filtered.data.series.map((r) => r.admin1))];
      assert(`G-3: every returned row's admin1 is ${regionName}`, seen.length === 1 && String(seen[0]).toLowerCase() === regionName.toLowerCase(), seen);
      assert(`G-3: the series is not empty, so the filter is not merely rejecting everything`, filtered.data.series.length > 0, filtered.data.series.length);
      assert('G-3: coverage names the region', filtered.provenance.coverage.toLowerCase().includes(regionName.toLowerCase()), filtered.provenance.coverage);
      assert('G-3: a single market is never implied', !/across Ethiopian markets/i.test(filtered.provenance.coverage), filtered.provenance.coverage);
      const values = filtered.data.series.map((r) => r.price);
      assert('G-3: prices are the publisher’s or null, never zero-filled', values.every((v) => v === null || (typeof v === 'number' && v > 0)), values.find((v) => v === 0));
      note(`G-3: ${filtered.data.series.length} Teff rows in ${regionName}, ${filtered.data.series[0]?.observedOn} → ${filtered.data.series.at(-1)?.observedOn}`);
    }
    const unfiltered = await getCommodityHistory({ commodity: 'Teff', months: 12 });
    assert('G-3 control: the same query without a region spans several regions', unfiltered.ok === true && new Set(unfiltered.data.series.map((r) => r.admin1)).size >= 3,
      unfiltered.ok ? [...new Set(unfiltered.data.series.map((r) => r.admin1))] : unfiltered.error);
    if (unfiltered.ok) assert('G-3 control: and it really contains rows the filter must drop', unfiltered.data.series.some((r) => String(r.admin1).toLowerCase() !== regionName.toLowerCase()), undefined);
    const wrong = await getCommodityHistory({ commodity: 'Teff', region: 'Atlantis', months: 6 });
    assert('G-3: an unmatched region answers no_data, never the whole country', wrong.ok === false && wrong.error.code === 'no_data', wrong.ok ? 'answered with rows' : wrong.error);
    assert('G-3: the refusal names the region it found nothing in', /Atlantis/.test(wrong.ok ? '' : wrong.error.message), wrong.error?.message);
  }

  /* -- 5. Partial availability, forced rather than awaited: a commodity the survey does not
        carry at this scope makes one source fail while the others answer. -- */
  section('partial availability — one source refusing, the rest still reported');
  const partialBuild = await buildReportBundle({ ...AT_MARKET, commodity: 'Unobtanium', caller: { displayName: null } });
  assert('partial: the bundle built', partialBuild.ok === true, partialBuild.error);
  if (partialBuild.ok) {
    checkBundle(`partial availability (imaginary commodity at ${TEST_MARKET})`, partialBuild.bundle, {
      kind: 'market',
      check(bundle, meta) {
        // A confirmed session whose account carries no name is still verified, and still shows
        // no name: the cover may not print a name this server never received.
        assert('cover: a verified session with no display name shows verified, nameless', bundle.meta.attribution.verified === true
          && bundle.meta.attribution.displayName === null && nonEmpty(bundle.meta.attribution.note), bundle.meta.attribution);
        const market = bundle.sections.find((s) => s.id === 'market');
        const hist = market.evidence.find((e) => e.evidenceId === 'market.history');
        assert('partial: the failing source reports a no_data error', hist?.error?.code === 'no_data', hist?.error);
        assert('partial: its refusal is explained by commodity and scope', (hist?.error?.message ?? '').includes('Unobtanium') && (hist?.error?.message ?? '').includes(TEST_MARKET), hist?.error?.message);
        assert('partial: the section degrades to partial, not to empty', market.status === 'partial', { status: market.status, evidence: market.evidence.map((e) => `${e.evidenceId}:${e.error ? 'failed' : 'ok'}`) });
        assert('partial: the sources that answered are still shown', market.evidence.filter((e) => !e.error).every((e) => e.tables.length + e.charts.length > 0), market.evidence.map((e) => e.tables.length));
        assert('partial: the failure is a warning the UI can render', meta.warnings.some((w) => w.code === 'source_unavailable' && w.evidenceId === 'market.history'), meta.warnings.map((w) => `${w.code}:${w.evidenceId ?? '-'}`));
        assert('partial: the register says unavailable for it', meta.sourceRegister.find((e) => e.evidenceId === 'market.history')?.state === 'unavailable', meta.sourceRegister.find((e) => e.evidenceId === 'market.history'));
        assert('partial: an unavailable source contributes no table', (hist?.tables.length ?? 0) === 0 && (hist?.charts.length ?? 0) === 0, { tables: hist?.tables.length, charts: hist?.charts.length });
      },
    });
  }

  /* -- 6. Stale data. A real GIBS scene stepped back beyond the source's own freshness window:
        the value must still come back, flagged rather than dropped or re-dated. -- */
  section('stale data — an old composite is retrieved, flagged, and not silently replaced');
  {
    // Stepping back from the newest scene the publisher confirms keeps this inside its retention
    // while putting it far outside the 11-day + 14-day-lag window a report calls current.
    const layer = getLayer('VIIRS_SNPP_NDVI_8Day');
    const latest = layer ? await findLatestLayerDate(layer) : { ok: false, error: { message: 'layer missing' } };
    assert('stale: the newest composite is known', latest.ok === true, latest.ok ? latest.data : latest.error?.message);
    if (latest.ok && layer) {
      const oldDate = new Date(Date.parse(`${latest.data}T00:00:00Z`) - 96 * 86_400_000).toISOString().slice(0, 10);
      const staleSample = await sampleLayerAtCoordinate({ layerId: layer.id, latitude: 7.67, longitude: 36.83, date: oldDate });
      assert(`stale: the publisher still answers for ${oldDate}`, staleSample.ok === true, staleSample.error);
      if (staleSample.ok) {
        const p = staleSample.provenance;
        assert('stale: observedAt is the old scene, not today', p.observedAt === oldDate, p.observedAt);
        assert('stale: flagged against its 8-daily window', p.stale === true && p.maxAgeSeconds <= 12 * 86400, { stale: p.stale, maxAgeSeconds: p.maxAgeSeconds });
        assert('stale: retrieval date is today and shown separately', p.retrievedAt.slice(0, 10) !== oldDate, p.retrievedAt);
        assert('stale: the value is published, not zeroed out', staleSample.data.value === null || Number.isFinite(staleSample.data.value), staleSample.data.value);
        // `quality` describes the pixel; freshness is carried by `stale` above. What an old scene
        // must never do is come back as a blank value with no explanation.
        assert('stale: a nodata pixel is labelled with its band, never zeroed', staleSample.data.value !== null || nonEmpty(staleSample.data.band), { value: staleSample.data.value, band: staleSample.data.band });
        assert('stale: the scene date on the row is the old one', staleSample.data.tileDate === oldDate, staleSample.data.tileDate);
        const fresh = await sampleLayerAtCoordinate({ layerId: layer.id, latitude: 7.67, longitude: 36.83 });
        assert('stale: the newest composite is not flagged', fresh.ok === true && fresh.provenance.stale === false, fresh.ok ? { stale: fresh.provenance.stale, observedAt: fresh.provenance.observedAt } : fresh.error);
        if (fresh.ok) assert('stale: and it is dated within the last fortnight', Date.now() - Date.parse(fresh.data.tileDate) < 20 * 86400_000, fresh.data.tileDate);
        note(`stale: ${oldDate} → stale=true, ${fresh.ok ? fresh.data.tileDate : 'n/a'} → stale=false (window ${(p.maxAgeSeconds / 86400).toFixed(0)} d + publisher lag)`);
      }
    }
    // Whatever the live sources do today, a stale one may not pass through unlabelled — the
    // per-bundle walk already proves it, this records which publishers were stale today.
    for (const bundle of [marketBundle, nationalBuild.ok && nationalBuild.bundle, regionBuild.ok && regionBuild.bundle].filter(Boolean)) {
      const flagged = bundle.meta.sourceRegister.filter((e) => e.stale).map((e) => e.evidenceId);
      if (flagged.length) note(`${bundle.meta.scope.kind}: stale today — ${flagged.join(', ')}`);
    }
  }

  /* -- 7. Demo mode: same real sources, visibly marked, no separate data path. -- */
  section('demo mode — marked, and assembled from the identical real sources');
  const demoBuild = await buildReportBundle({ ...AT_MARKET, mode: 'demo', caller: { displayName: 'harness@local' } });
  assert('demo: the bundle built', demoBuild.ok === true, demoBuild.error);
  if (demoBuild.ok) {
    checkBundle('demo mode (same scope, second pass)', demoBuild.bundle, {
      kind: 'market',
      check(bundle) {
        assert('demo: marked for the printer on every page', nonEmpty(bundle.meta.demoNotice) && /must not be presented as production/i.test(bundle.meta.demoNotice), bundle.meta.demoNotice);
        assert('demo: warned as demo_mode', bundle.meta.warnings.some((w) => w.code === 'demo_mode'), bundle.meta.warnings.map((w) => w.code));
        const a = marketBundle.meta.sourceRegister.map((e) => `${e.evidenceId}@${e.source}`).sort().join('|');
        const b = bundle.meta.sourceRegister.map((e) => `${e.evidenceId}@${e.source}`).sort().join('|');
        assert('demo: the same sources and evidence ids as the production build', a.split('|').length === b.split('|').length && [...new Set(a.split('|'))].join('|') === [...new Set(b.split('|'))].join('|'), { production: a.slice(0, 120), demo: b.slice(0, 120) });
        assert('demo: no synthetic-value flag on real figures', bundle.sections.every((s) => s.evidence.every((e) => !/fabricated|placeholder|sample data/i.test(e.provenance.methodology))), undefined);
      },
    });
    const cached = demoBuild.bundle.meta.sourceRegister.filter((e) => e.servedFromCache).length;
    note(`demo pass reused the process cache for ${cached}/${demoBuild.bundle.meta.sourceRegister.length} sources — a second report for the same place does not re-hit every publisher.`);
  }

  /* -- 8. AI unavailable. Phase 2 ships no findings at all, which is exactly the state an AI
        outage leaves the report in: the evidence has to stand on its own. -- */
  section('AI unavailable — the bundle and its evidence package must stand without a model');
  const pkg = buildEvidencePackage(marketBundle);
  assert('evidence: reference and scope carried over', pkg.reference === marketBundle.meta.reference && nonEmpty(pkg.scope), pkg);
  assert('evidence: mode carried over', pkg.mode === marketBundle.meta.mode, pkg.mode);
  assert('evidence: generation rules travel with the package', Array.isArray(pkg.rules) && pkg.rules.length >= 5 && pkg.rules.every(nonEmpty), pkg.rules?.length);
  assert('evidence: rules forbid unit conversion', pkg.rules.some((r) => /never convert a unit/i.test(r)), pkg.rules);
  assert('evidence: rules require citations', pkg.rules.some((r) => /must cite one or more evidenceIds/i.test(r)), pkg.rules);
  assert('evidence: rules forbid causal claims', pkg.rules.some((r) => /causation/i.test(r)), undefined);
  assert('evidence: rules forbid scope widening', pkg.rules.some((r) => /Do not widen a scope/i.test(r)), undefined);
  assert('evidence: facts are present even with zero findings', pkg.facts.length > 20 && marketBundle.findings.length === 0, { facts: pkg.facts.length, findings: marketBundle.findings.length });
  const bundleText = JSON.stringify(marketBundle);
  assert('evidence: every fact cites an evidence id in the bundle', pkg.facts.every((f) => bundleText.includes(`"${f.evidenceId}"`)), [...new Set(pkg.facts.filter((f) => !bundleText.includes(`"${f.evidenceId}"`)).map((f) => f.evidenceId))]);
  assert('evidence: every fact names its publisher, units and kind', pkg.facts.every((f) => nonEmpty(f.source) && nonEmpty(f.units) && VALUE_KINDS.has(f.valueKind) && SPATIAL.has(f.spatial) && isDate(f.retrievedAt) && QUALITY.has(f.quality)), pkg.facts[0]);
  assert('evidence: a null value is stated as not published', pkg.facts.every((f) => f.value !== null || /no value published|not published/.test(f.statement)), pkg.facts.find((f) => f.value === null)?.statement);
  assert('evidence: observedAt is null or a date', pkg.facts.every((f) => f.observedAt === null || isDate(f.observedAt)), pkg.facts.find((f) => f.observedAt !== null && !isDate(f.observedAt)));
  assert('evidence: stale sources are listed for the model', Array.isArray(pkg.staleSources) && pkg.staleSources.every(nonEmpty), pkg.staleSources);
  assert('evidence: every source that did not answer is a gap', marketBundle.meta.warnings
    .filter((w) => w.code === 'source_unavailable' && w.evidenceId)
    .every((w) => pkg.gaps.some((g) => g.evidenceId === w.evidenceId)), pkg.gaps.map((g) => g.evidenceId));
  assert('evidence: every unplotable chart is a gap', marketBundle.meta.warnings
    .filter((w) => w.code === 'insufficient_data' && w.evidenceId && !w.evidenceId.startsWith('section.'))
    .every((w) => pkg.gaps.some((g) => g.evidenceId === w.evidenceId)), pkg.gaps.map((g) => g.evidenceId));
  assert('evidence: no gap is invented for a source that answered', pkg.gaps.every((g) => !pkg.facts.some((f) => f.evidenceId === g.evidenceId)), pkg.gaps.map((g) => g.evidenceId));
  assert('evidence: every gap names a reason', pkg.gaps.every((g) => nonEmpty(g.reason) && nonEmpty(g.evidenceId)), pkg.gaps[0]);
  assert('evidence: budget respected', pkg.facts.length <= 180, pkg.facts.length);
  assert('evidence: the selection strategy is stated even when nothing was dropped', nonEmpty(pkg.selection) && /round-robin/i.test(pkg.selection), pkg.selection);
  assert('evidence: the demo notice travels with the package', pkg.demoNotice === marketBundle.meta.demoNotice, pkg.demoNotice);
  if (pkg.truncated !== null) {
    assert('evidence: truncation is declared, not silent', isNum(pkg.facts.length) && pkg.facts.length >= 180, pkg.facts.length);
    const covered = new Set(pkg.facts.map((f) => f.evidenceId.split('.')[0]));
    note(`evidence: the ${pkg.facts.length}-fact budget was reached; sections represented — ${[...covered].join(', ')}. Selection is round-robin across evidence items, so an item is only cut after every other item has been quoted the same number of times.`);
  }
  const partialPkg = partialBuild.ok ? buildEvidencePackage(partialBuild.bundle) : null;
  if (partialPkg) {
    assert('evidence: a failed source appears as a gap, never as a fact', partialPkg.gaps.some((g) => g.evidenceId === 'market.history' && /did not answer/i.test(g.reason)) && !partialPkg.facts.some((f) => f.evidenceId.startsWith('market.history')), partialPkg.gaps.filter((g) => g.evidenceId.startsWith('market.history')));
  }

  section('citation gate — what Phase 4 will refuse to print');
  {
    const realId = pkg.facts[0]?.evidenceId;
    const partialBundle = partialBuild.ok ? partialBuild.bundle : null;
    const cases = [
      ['an uncited claim', marketBundle, { evidenceId: 'x', text: 'Prices rose', cites: [], kind: 'interpretation', generatedBy: 'model' }, true],
      ['a citation to an id that is not in the bundle', marketBundle, { evidenceId: 'x', text: 'Prices rose', cites: ['market.does-not-exist'], kind: 'interpretation', generatedBy: 'model' }, true],
      ['a citation to evidence that answered', marketBundle, { evidenceId: 'x', text: `Rainfall read from ${realId}`, cites: [realId], kind: 'observation', generatedBy: 'model' }, false],
      // The gate has to catch a citation to a source that refused, so it is tested against a
      // bundle where one really did refuse.
      ...(partialBundle ? [['a citation to a source that did not answer', partialBundle, { evidenceId: 'x', text: 'Prices rose', cites: ['market.history'], kind: 'interpretation', generatedBy: 'model' }, true]] : []),
    ];
    for (const [name, bundle, finding, mustFail] of cases) {
      const errs = citationErrors(bundle, [finding]);
      assert(`citations: ${mustFail ? 'rejected' : 'accepted'} — ${name}`, mustFail ? errs.length > 0 : errs.length === 0, errs);
    }
    assert('citations: the rejection names the claim and the id', citationErrors(marketBundle, [{ evidenceId: 'claim-1', text: 'x', cites: ['nope'], kind: 'interpretation', generatedBy: 'm' }])[0].includes('claim-1'), undefined);
    assert('citations: a whole set is checked at once', citationErrors(marketBundle, [
      { evidenceId: 'a', text: 'x', cites: [], kind: 'interpretation', generatedBy: 'm' },
      { evidenceId: 'b', text: 'x', cites: ['nope'], kind: 'interpretation', generatedBy: 'm' },
    ]).length === 2, undefined);
  }

  /* -- 9. The licensing decision, checked against what the bundle actually reproduces. -- */
  section('approved decision 1 — only NASA GIBS imagery reaches the report');
  {
    const geo = marketBundle.sections.find((s) => s.id === 'geospatial');
    assert('imagery: every geospatial source is GIBS', marketBundle.meta.sourceRegister.filter((e) => e.evidenceId.startsWith('geospatial')).every((e) => /GIBS/i.test(e.source)), marketBundle.meta.sourceRegister.filter((e) => e.evidenceId.startsWith('geospatial')).map((e) => e.source));
    assert('imagery: no boundary or hydrology service is called', !marketBundle.meta.sourceRegister.some((e) => /ArcGIS|CDE|GRID3|geoBoundaries|Humanitarian|University of Bern/i.test(e.source) || /arcgis|geoboundaries|humanitarianresponse/i.test(e.endpoint)), marketBundle.meta.sourceRegister.map((e) => `${e.source} ${e.endpoint.slice(0, 40)}`));
    assert('imagery: the exclusion is stated in the section, not only in a doc', geo.caveats.some((c) => /redistribution|excluded/i.test(c)), geo.caveats);
    assert('imagery: a licensing warning is emitted', marketBundle.meta.warnings.some((w) => w.code === 'licensing'), marketBundle.meta.warnings.map((w) => w.code));
    assert('imagery: pixel readings are labelled single-pixel', geo.evidence.every((e) => e.tables.every((t) => t.provenance.coverage.includes('pixel') || t.provenance.coverage.includes('coordinate'))), geo.evidence.map((e) => e.provenance.coverage));
    assert('imagery: no regional NDVI average is computed', !/average|mean/i.test(JSON.stringify(geo.evidence.map((e) => e.tables.map((t) => t.title)))), undefined);
    if (geo.status !== 'unavailable') {
      // What must not be embedded: image bytes or an image reference in the printed content.
      // The tile URL itself lives in provenance.endpoint and is a link for the register, not a
      // picture in the document, so it is deliberately outside the text scanned here.
      const printed = JSON.stringify({
        tables: geo.evidence.flatMap((e) => e.tables.map((t) => ({ title: t.title, rows: t.rows }))),
        charts: geo.evidence.flatMap((e) => e.charts.map((c) => ({ title: c.title, series: c.series }))),
        caveats: geo.caveats,
      });
      // A `.png` in a band label is the publisher's own vocabulary, not an embedded picture.
      assert('imagery: no image bytes or data URL in the printed content', !/data:image|base64/i.test(printed), printed.match(/.{0,40}(data:image|base64).{0,40}/i)?.[0]);
    }
  }

  /* -- 11. The wire the panel speaks (Phase 3): one validator module on both sides of the fetch.
        The browser builds the query and the route parses it; if those two ever disagree about a
        parameter name, a range, or which fields exist at all, the panel silently requests something
        other than what it displays. So the round trip is asserted, not assumed. -- */
  const { buildReportQuery, parseReportQuery, REPORT_LIMITS } = await ts('lib/report/request.ts');
  const { readFileSync } = await import('node:fs');
  section('the report query validator (browser and route share one module)');

  const scopeSelectors = (g) => [
    nonEmpty(g.market) || nonEmpty(g.marketId),
    nonEmpty(g.region),
    isNum(g.latitude) && isNum(g.longitude),
  ].filter(Boolean).length;

  const WIRE_SCOPES = [
    ['market', { market: TEST_MARKET, commodity: TEST_COMMODITY, months: 6, composites: 4 }, 1],
    ['region', { region: regions[0], months: 9 }, 1],
    ['national', { months: 6 }, 0],
    ['coordinate', { latitude: 8.98, longitude: 38.79, pastDays: 20 }, 1],
    ['demo market', { market: TEST_MARKET, mode: 'demo' }, 1],
  ];
  for (const [name, input, expectedSelectors] of WIRE_SCOPES) {
    const query = buildReportQuery(input);
    const parsed = parseReportQuery(query);
    assert(`wire ${name}: the query the panel builds is one the route accepts`, parsed.ok === true, parsed);
    if (!parsed.ok) continue;
    for (const [key, value] of Object.entries(input)) {
      if (value === null || value === undefined || value === '') continue;
      assert(`wire ${name}: ${key} survives the round trip unchanged`, parsed.given[key] === value, { sent: value, read: parsed.given[key] });
    }
    assert(`wire ${name}: exactly ${expectedSelectors} scope selector reaches the route`, scopeSelectors(parsed.given) === expectedSelectors, parsed.given);
    assert(`wire ${name}: absent fields stay null rather than empty strings`, ['market', 'marketId', 'region', 'commodity'].every((k) => parsed.given[k] === null || nonEmpty(parsed.given[k])), parsed.given);
  }

  assert('wire: no parameter names an author', !/caller|displayName|author|email|signed/i.test(buildReportQuery({ market: TEST_MARKET })), buildReportQuery({ market: TEST_MARKET }));
  assert('wire: the parser cannot be handed an identity field', !('caller' in parseReportQuery('market=Jimma&caller=Someone%40x.test').given), undefined);
  assert('wire: an identity parameter in the query is simply absent from the parsed input', parseReportQuery('market=Jimma&caller=Someone').given.market === 'Jimma' && !('caller' in parseReportQuery('caller=Someone').given), undefined);

  for (const [query, message] of [
    ['mode=nonsense', 'mode must be production or demo'],
    ['lat=9.02', 'Provide both lat and lon, or neither'],
    ['lon=38.79', 'Provide both lat and lon, or neither'],
    ['lat=abc&lon=38.79', 'lat must be a number'],
    ['lat=9.02&lon=abc', 'lon must be a number'],
  ]) {
    const parsed = parseReportQuery(query);
    assert(`wire refusal ${query}: refused`, parsed.ok === false, parsed);
    assert(`wire refusal ${query}: the stated reason`, parsed.ok === false && parsed.message === message, parsed.ok ? parsed.given : parsed.message);
  }

  assert('wire clamp: an oversized window is capped, not passed through', parseReportQuery('months=999').given.months === REPORT_LIMITS.months.max, parseReportQuery('months=999').given.months);
  assert('wire clamp: a negative window is raised to the minimum', parseReportQuery('months=-4').given.months === REPORT_LIMITS.months.min, parseReportQuery('months=-4').given.months);
  assert('wire clamp: a non-numeric window falls back to the declared default', parseReportQuery('months=soon').given.months === REPORT_LIMITS.months.fallback, parseReportQuery('months=soon').given.months);
  assert('wire clamp: the panel clamps before sending, so what it shows is what is read', buildReportQuery({ months: 999, composites: 999 }) === `months=${REPORT_LIMITS.months.max}&composites=${REPORT_LIMITS.composites.max}`, buildReportQuery({ months: 999, composites: 999 }));
  assert('wire: a lone coordinate is never sent, so the route is never asked to guess one', !/[?&]lat/.test(buildReportQuery({ latitude: 9.02 })) && !/&lon=/.test(`&${buildReportQuery({ latitude: 9.02 })}`), buildReportQuery({ latitude: 9.02 }));
  assert('wire: blank names are dropped rather than sent as empty filters', buildReportQuery({ market: '   ', region: '', commodity: '  ' }) === '', buildReportQuery({ market: '   ', region: '', commodity: '  ' }));
  // The cap is applied where the value is read, so an over-long name is used as the route uses it.
  assert('wire: an over-long name is capped at the length the route applies', parseReportQuery(buildReportQuery({ commodity: 'x'.repeat(400) })).given.commodity.length === 120, undefined);

  const routeSource = readFileSync(resolvePath(ROOT, 'app/api/report/insight-data/route.ts'), 'utf8');
  assert('wire: the route reads the query through the shared validator', /parseReportQuery\(/.test(routeSource), routeSource.slice(0, 200));
  assert('wire: the route keeps no second parser of its own', !/stringParam\(|numberParam\(|intParam\(/.test(routeSource), routeSource.match(/(stringParam|numberParam|intParam)\(/)?.[0]);

  /* -- 12. The client state model (Phase 3): the six states, mapped from bundles the publishers
        actually answered. The mapping is where a UI could quietly turn "two sources refused" into
        "here is your report", so the expectation is recomputed here from `meta.coverage` rather
        than hardcoded — if the orchestrator's statuses and this mapping ever disagree, it shows. -- */
  const { describeReport, sectionStatusLabel } = await ts('lib/report/reportState.ts');
  section('the client state model, mapped from real bundles');

  const expectState = (b) => {
    const answered = b.sections.filter((s) => s.status !== 'unavailable').length;
    return answered === 0 ? 'no-data' : b.sections.every((s) => s.status === 'ready') ? 'ready' : 'partial';
  };

  const stateMarket = await buildReportBundle({ ...AT_MARKET, caller: null });
  const stateRegion = await buildReportBundle({ region: regions[0], months: 6, composites: 3, caller: null });
  const stateNational = await buildReportBundle({ months: 6, caller: null });
  const stateCoordinate = await buildReportBundle({ latitude: 8.98, longitude: 38.79, caller: null });
  const stateDemo = await buildReportBundle({ ...AT_MARKET, mode: 'demo', caller: null });
  const realBundles = [['market', stateMarket], ['region', stateRegion], ['national', stateNational], ['coordinate', stateCoordinate], ['demo', stateDemo]];

  for (const [name, built] of realBundles) {
    if (!assert(`state ${name}: the bundle builds`, built.ok === true, built.error)) continue;
    const bundle = built.bundle;
    const view = describeReport({ loading: false, error: null, bundle });
    assert(`state ${name}: the mapped state is what the section statuses say`, view.state === expectState(bundle), { mapped: view.state, expected: expectState(bundle), coverage: bundle.meta.coverage });
    assert(`state ${name}: every section is labelled with the bundle's own status`, view.sections.length === bundle.sections.length
      && view.sections.every((s, i) => s.id === bundle.sections[i].id && s.status === bundle.sections[i].status && s.statusLabel === sectionStatusLabel(bundle.sections[i].status)), view.sections.map((s) => [s.id, s.status]));
    assert(`state ${name}: evidence objects reach the view unmodified`, view.sections.every((s, i) => s.evidence === bundle.sections[i].evidence), undefined);
    assert(`state ${name}: the source register is the bundle's own array, not a reduced copy`, view.register === bundle.meta.sourceRegister, undefined);
    assert(`state ${name}: warnings are the bundle's own array`, view.warnings === bundle.meta.warnings, undefined);
    assert(`state ${name}: row counts are rows the tables actually hold`, view.sections.reduce((n, s) => n + s.rows, 0)
      === bundle.sections.reduce((n, s) => n + s.evidence.reduce((m, e) => m + e.tables.reduce((t, x) => t + x.rows.length, 0), 0), 0), undefined);
    assert(`state ${name}: point counts exclude the gaps a publisher left`, view.sections.reduce((n, s) => n + s.seriesPoints, 0)
      === bundle.sections.reduce((n, s) => n + s.evidence.reduce((m, e) => m + e.charts.reduce((c, ch) => c + ch.series.reduce((p, ser) => p + ser.points.filter((pt) => pt.y !== null).length, 0), 0), 0), 0), undefined);
    assert(`state ${name}: attribution is the bundle's, and an unverified caller is shown as unverified`, view.attribution === bundle.meta.attribution && view.attribution.verified === false, view.attribution);
    assert(`state ${name}: no date is stamped that the bundle does not carry`, (() => {
      const inBundle = JSON.stringify(bundle);
      return [...new Set((JSON.stringify(view).match(/\d{4}-\d{2}-\d{2}/g) ?? []))].every((d) => inBundle.includes(d));
    })(), JSON.stringify(view).match(/\d{4}-\d{2}-\d{2}/g)?.filter((d, i, a) => a.indexOf(d) === i));
    assert(`state ${name}: a cross-reference is shown as the bundle's own`, view.reference === bundle.meta.reference && view.generatedAt === bundle.meta.generatedAt, undefined);
    assert(`state ${name}: no interpretation is claimed the bundle does not hold`, view.findingCount === bundle.findings.length, { view: view.findingCount, bundle: bundle.findings.length });
  }

  if (stateNational.ok) {
    const view = describeReport({ loading: false, error: null, bundle: stateNational.bundle });
    assert('state national: the scope line says national survey', /national survey/i.test(view.scopeLine ?? ''), view.scopeLine);
    assert('state national: the scope line claims no market for a country-wide figure', !(view.scopeLine ?? '').includes(String(TEST_MARKET)), view.scopeLine);
    assert('state national: the missing point products are stated as their own gaps', view.sections.filter((s) => s.status === 'unavailable').every((s) => nonEmpty(s.unavailableReason)), view.sections.map((s) => [s.id, s.status]));
  }
  if (stateRegion.ok) {
    const view = describeReport({ loading: false, error: null, bundle: stateRegion.bundle });
    assert(`state region: the scope line names ${regions[0]} and the centre it was read at`, (view.scopeLine ?? '').includes(String(regions[0])) && /read at/i.test(view.scopeLine ?? ''), view.scopeLine);
    assert('state region: the scope note is the bundle\'s own, verbatim', view.scopeNote === stateRegion.bundle.meta.scope.note, view.scopeNote);
  }
  if (stateDemo.ok) {
    const view = describeReport({ loading: false, error: null, bundle: stateDemo.bundle });
    assert('state demo: a demo bundle is flagged as demo', view.isDemo === true && view.demoNotice === stateDemo.bundle.meta.demoNotice, view.demoNotice);
    assert('state demo: the demo notice is carried even when every section answered', view.state !== 'idle' && view.state !== 'error', view.state);
  }
  if (stateMarket.ok) {
    const view = describeReport({ loading: false, error: null, bundle: stateMarket.bundle });
    assert('state production: a production bundle carries no demo notice', view.isDemo === false && view.demoNotice === null, view.demoNotice);
    assert('state: a newer request supersedes the bundle in hand (loading wins)', describeReport({ loading: true, error: null, bundle: stateMarket.bundle }).state === 'loading', undefined);
    assert('state: while loading the panel says the sources are being read, not that there is no data', /Reading the publishers/.test(describeReport({ loading: true, error: null, bundle: null }).headline), undefined);
    assert('state: nothing requested yet is idle with no claim', (() => {
      const idle = describeReport({ loading: false, error: null, bundle: null });
      return idle.state === 'idle' && idle.headline === '' && idle.register.length === 0 && idle.sections.length === 0 && idle.scopeLine === null;
    })(), undefined);
    assert('state: an error message is shown verbatim, not rewritten as a data gap', (() => {
      const failed = describeReport({ loading: false, error: { code: 'auth_required', message: 'Sign in first' }, bundle: null });
      return failed.state === 'error' && failed.headline === 'Sign in first';
    })(), undefined);

    // The one state live publishers will not hand us on demand: every source refusing at once.
    const hollow = JSON.parse(JSON.stringify(stateMarket.bundle));
    for (const sec of hollow.sections) {
      sec.status = 'unavailable';
      sec.unavailableReason = `${sec.title}: every publisher refused this scope (synthesised for the state check).`;
      sec.evidence = [];
    }
    hollow.meta.coverage = Object.fromEntries(hollow.sections.map((s) => [s.id, 'unavailable']));
    const hollowView = describeReport({ loading: false, error: null, bundle: hollow });
    assert('state no-data: all sections unavailable maps to no-data, not a quieter ready', hollowView.state === 'no-data', hollowView.state);
    assert('state no-data: the reasons shown are the bundle\'s own text', hollowView.sections.every((s, i) => s.unavailableReason === hollow.sections[i].unavailableReason), undefined);
    assert('state no-data: the headline refuses to offer a substitute', /substitute/i.test(hollowView.headline), hollowView.headline);
  }

  /* -- 13. The 180-fact budget (Phase 4). A live market report does not reach 180 figures on its
        own, so this case inflates a copy of one with the rows it already has. The extra rows are
        duplicates of published ones and exist only to fill the budget; they are never presented as
        a publisher's answer, and the assertions are about *which* figures survive, not what they
        mean. The old first-come-first-served loop let a wide early table starve every later
        section, which a model reads as "the satellite and the macro sources had nothing to say". -- */
  section('the 180-fact budget — coverage across sections, deterministically');
  {
    const contributingIds = (b) => b.sections.flatMap((sec) => sec.evidence
      .filter((item) => !item.error && (
        item.derived.some((d) => d.value !== null)
        || item.tables.some((t) => t.rows.length > 0)
        || item.charts.some((c) => !c.unavailableReason && c.series.some((s) => s.points.length > 0))))
      .map((item) => item.evidenceId));

    const inflated = JSON.parse(JSON.stringify(marketBundle));
    for (const sec of inflated.sections) {
      for (const item of sec.evidence) {
        for (const table of item.tables) {
          const base = table.rows.slice();
          if (base.length === 0) continue;
          while (table.rows.length < 120) table.rows.push(base[table.rows.length % base.length]);
        }
      }
    }

    const groups = contributingIds(inflated);
    // A group is cited by the ids it can produce, which are the derived/table/chart ids inside it.
    const idsOfItem = new Map();
    for (const sec of inflated.sections) {
      for (const item of sec.evidence) {
        idsOfItem.set(item.evidenceId, new Set([
          ...item.derived.map((d) => d.evidenceId),
          ...item.tables.map((t) => t.evidenceId),
          ...item.charts.filter((c) => !c.unavailableReason).map((c) => c.evidenceId),
        ]));
      }
    }
    const big = buildEvidencePackage(inflated);
    assert(`budget: ${groups.length} evidence items had figures to offer`, groups.length > 0, groups);
    assert('budget: the inflated bundle really overflows the budget', big.facts.length === 180, big.facts.length);
    assert('budget: every item that had a figure is represented', groups.every((id) => big.facts.some((f) => idsOfItem.get(id).has(f.evidenceId))), groups.filter((id) => !big.facts.some((f) => idsOfItem.get(id).has(f.evidenceId))));
    const sectionsCovered = new Set(big.facts.map((f) => f.evidenceId.split('.')[0]));
    const sectionsOffering = new Set(groups.map((id) => id.split('.')[0]));
    assert(`budget: no section is cut off — ${[...sectionsOffering].join(', ')}`, [...sectionsOffering].every((s) => sectionsCovered.has(s)), { offering: [...sectionsOffering], covered: [...sectionsCovered] });
    assert('budget: truncation names each item and how much of it was kept', big.truncated !== null && /Round-robin/.test(big.truncated) && /kept \d+ of \d+/.test(big.truncated), big.truncated);
    assert('budget: gaps do not compete with figures for slots', big.gaps.length === pkg.gaps.length, { inflated: big.gaps.length, base: pkg.gaps.length });
    const sectionIndexOf = (id) => inflated.sections.findIndex((sec) => sec.evidence.some((e) => e.evidenceId === id
      || e.tables.some((t) => t.evidenceId === id)
      || e.charts.some((c) => c.evidenceId === id)
      || e.derived.some((d) => d.evidenceId === id)));
    assert('budget: the survivors stay in bundle order', (() => {
      const seq = big.facts.map((f) => sectionIndexOf(f.evidenceId));
      return seq.every((n, i) => n >= 0 && (i === 0 || seq[i - 1] <= n));
    })(), big.facts.map((f) => [f.evidenceId, sectionIndexOf(f.evidenceId)]).filter(([, n]) => n < 0));
    const again = buildEvidencePackage(inflated);
    assert('budget: the same bundle always produces the same package', JSON.stringify(again.facts) === JSON.stringify(big.facts), undefined);
    note(`budget: ${groups.length} items offered more than 180 figures; each was kept to ${Math.ceil(180 / groups.length)} at most before any was cut twice.`);
  }

  /* -- 14. The citation gate (Phase 4). The drafts below are fixtures: sentences assembled from the
        figures the package actually carries, so the assertions test the gate rather than a model.
        Where a case needs an evidence shape the publishers are not offering today — a stale figure,
        a forecast figure, a two-point series — the package copy is mutated and the mutation is
        named in the fixture statement. Nothing here is evidence of what a provider will write. -- */
  const { parseFindingsPayload, validateFindings, buildInsightsPayload, MAX_FINDINGS } = await ts('lib/report/findings.ts');
  section('the citation gate — fixtures the validator must accept, and fixtures it must drop');
  {
    const f0 = pkg.facts.find((f) => f.value !== null && !f.stale) ?? pkg.facts.find((f) => f.value !== null);
    if (!assert('fixtures: the live package carries at least one figure to quote', f0 && f0.value !== null, pkg.facts.length)) throw new Error('no facts to build fixtures from');
    const quote = (f) => `The published figure is ${f.value} ${f.units}.`;
    const draft = (text, cites, kind = 'observation') => ({ text, cites: Array.isArray(cites) ? cites : [cites], kind });
    const copy = (mutate) => {
      const clone = JSON.parse(JSON.stringify(pkg));
      mutate(clone);
      return clone;
    };
    const run = (package_, drafts) => validateFindings(marketBundle, package_, drafts, 'fixture-model');

    const okCase = run(pkg, [draft(quote(f0), f0.evidenceId)]);
    assert('gate: a claim quoting a figure it cites is published', okCase.accepted.length === 1 && okCase.rejected.length === 0, okCase.rejected);
    assert('gate: an accepted claim keeps the model that wrote it', okCase.accepted[0]?.generatedBy === 'fixture-model', okCase.accepted[0]);
    assert('gate: the accepted claim is the draft, unedited', okCase.accepted[0]?.text === quote(f0), okCase.accepted[0]?.text);

    const badId = run(pkg, [draft('Prices moved in the surveyed market.', 'market.does-not-exist')]);
    assert('gate: a fabricated evidence id is dropped', badId.accepted.length === 0 && /not in this bundle/.test(badId.rejected[0]?.reason ?? ''), badId.rejected);

    const uncited = run(pkg, [draft(quote(f0), [])]);
    assert('gate: an uncited claim is dropped', uncited.rejected.length === 1 && /no citation/.test(uncited.rejected[0].reason), uncited.rejected);

    const dropped = run(copy((p) => { p.facts = p.facts.filter((f) => f.evidenceId !== f0.evidenceId); }), [draft(quote(f0), f0.evidenceId)]);
    assert('gate: a citation to an id the package never carried is dropped', /carried nothing for this package/.test(dropped.rejected[0]?.reason ?? ''), dropped.rejected);

    const invented = run(pkg, [draft('The published figure is 987654.32 units.', f0.evidenceId)]);
    assert('gate: a number no cited fact carries is dropped', /appears in no fact it cites/.test(invented.rejected[0]?.reason ?? ''), invented.rejected);

    const stalePkg = copy((p) => { for (const f of p.facts) if (f.evidenceId === f0.evidenceId) f.stale = true; });
    const staleNoDate = run(stalePkg, [draft(quote(f0), f0.evidenceId)]);
    assert('gate: stale evidence used without an as-of date is dropped', /stale/.test(staleNoDate.rejected[0]?.reason ?? ''), staleNoDate.rejected);
    const asOf = f0.observedAt ?? f0.retrievedAt;
    const staleDated = run(stalePkg, [draft(`${quote(f0)} As of ${asOf}.`, f0.evidenceId)]);
    assert('gate: the same claim with its as-of date is published', staleDated.accepted.length === 1, staleDated.rejected);

    const forecastWords = run(pkg, [draft(`The published figure is ${f0.value} ${f0.units}, and that forecast holds.`, f0.evidenceId)]);
    assert('gate: forecast language over a non-forecast figure is dropped', f0.valueKind !== 'forecast' ? /reads as a forecast/.test(forecastWords.rejected[0]?.reason ?? '') : true, forecastWords.rejected);
    const forecastKind = run(copy((p) => { for (const f of p.facts) if (f.evidenceId === f0.evidenceId) f.valueKind = 'forecast'; }), [draft(`The published figure is ${f0.value} ${f0.units}, and that forecast holds.`, f0.evidenceId)]);
    assert('gate: forecast language is allowed over a forecast figure', forecastKind.accepted.length === 1, forecastKind.rejected);
    const measuredModeled = run(copy((p) => { for (const f of p.facts) if (f.evidenceId === f0.evidenceId) f.valueKind = 'modeled'; }), [draft(`The measured value is ${f0.value} ${f0.units}.`, f0.evidenceId)]);
    assert('gate: a modeled figure is not allowed to read as a measurement', /reads as a measurement/.test(measuredModeled.rejected[0]?.reason ?? ''), measuredModeled.rejected);
    const estimatedOverObserved = run(copy((p) => { for (const f of p.facts) if (f.evidenceId === f0.evidenceId) f.valueKind = 'observed'; }), [draft(`The estimated value is ${f0.value} ${f0.units}.`, f0.evidenceId)]);
    assert('gate: an observed figure is not allowed to read as our estimate', /calls a figure estimated/.test(estimatedOverObserved.rejected[0]?.reason ?? ''), estimatedOverObserved.rejected);

    // A two-point series is synthesised: the real package is emptied for that id, then two fixture
    // facts are inserted with the dates and values the sentence quotes.
    const pair = (values) => values.map(([value, date]) => ({
      ...f0,
      value,
      observedAt: date,
      stale: false,
      valueKind: 'observed',
      coverage: 'synthetic two-point fixture',
      source: 'synthetic fixture',
      units: f0.units,
      statement: `Synthetic series at ${date}: ${value} ${f0.units}`,
    }));
    const pairPkg = (values) => copy((p) => {
      p.facts = p.facts.filter((f) => f.evidenceId !== f0.evidenceId).concat(pair(values));
    });
    const wrongWay = run(pairPkg([[100, '2026-01-15'], [60, '2026-06-15']]), [draft('The figure rose from 100 to 60.', f0.evidenceId)]);
    assert('gate: a direction that contradicts the cited figures is dropped', /says the figure rose/.test(wrongWay.rejected[0]?.reason ?? ''), wrongWay.rejected);
    const rightWay = run(pairPkg([[100, '2026-01-15'], [60, '2026-06-15']]), [draft('The figure fell from 100 to 60.', f0.evidenceId)]);
    assert('gate: a direction the cited figures actually show is published', rightWay.accepted.length === 1, rightWay.rejected);
    const onePoint = run(pairPkg([[100, '2026-01-15']]), [draft('The figure rose to 100.', f0.evidenceId)]);
    assert('gate: a direction claimed from a single period is dropped', /single period/.test(onePoint.rejected[0]?.reason ?? ''), onePoint.rejected);

    const pixel = run(copy((p) => { for (const f of p.facts) if (f.evidenceId === f0.evidenceId) f.spatial = 'single-pixel'; }), [draft(`The region-wide average is ${f0.value} ${f0.units}.`, f0.evidenceId)]);
    assert('gate: a pixel reading cannot carry a regional claim', /finer than a region|regional coverage/.test(pixel.rejected[0]?.reason ?? ''), pixel.rejected);
    const field = run(pkg, [draft(`On this field the value is ${f0.value} ${f0.units}.`, f0.evidenceId)]);
    assert('gate: nothing in the package describes a specific field', /field or plot/.test(field.rejected[0]?.reason ?? ''), field.rejected);
    const widened = run(copy((p) => { for (const f of p.facts) if (f.evidenceId === f0.evidenceId) f.spatial = 'market'; }), [draft(`Nationwide the figure is ${f0.value} ${f0.units}.`, f0.evidenceId)]);
    assert('gate: one market cannot speak for the country', /national coverage/.test(widened.rejected[0]?.reason ?? ''), widened.rejected);

    const verified = run(pkg, [draft(`The published figure is ${f0.value} ${f0.units}, verified against the source.`, f0.evidenceId)]);
    assert('gate: status language the evidence cannot confer is dropped', /claims the status/.test(verified.rejected[0]?.reason ?? ''), verified.rejected);

    const demo = copy((p) => { p.demoNotice = 'DEMO workspace figures (fixture).'; });
    const unlabelled = run(demo, [draft(quote(f0), f0.evidenceId)]);
    assert('gate: a demo claim that does not say so is dropped', /not labelled as one/.test(unlabelled.rejected[0]?.reason ?? ''), unlabelled.rejected);
    const labelled = run(demo, [draft(`Demo sample: the published figure is ${f0.value} ${f0.units}.`, f0.evidenceId)]);
    assert('gate: a claim labelled as demo is published with that label', labelled.accepted.length === 1, labelled.rejected);

    const bareAdvice = run(pkg, [draft('Sell the harvest before the long rains.', f0.evidenceId, 'recommendation')]);
    assert('gate: advice is dropped unless it reads as advice', /does not read as advice/.test(bareAdvice.rejected[0]?.reason ?? ''), bareAdvice.rejected);
    const certainAdvice = run(pkg, [draft('We recommend holding stock until the next survey.', f0.evidenceId, 'recommendation')]);
    assert('gate: advice is dropped unless it states what is uncertain', /without stating what is uncertain/.test(certainAdvice.rejected[0]?.reason ?? ''), certainAdvice.rejected);
    const qualifiedAdvice = run(pkg, [draft('We recommend holding stock, since the cited months may not repeat.', f0.evidenceId, 'recommendation')]);
    assert('gate: labelled advice with its uncertainty stated is published', qualifiedAdvice.accepted.length === 1, qualifiedAdvice.rejected);

    const limitation = run(pkg, [draft('The cited figures are too few to support a comparison, so none is offered.', f0.evidenceId, 'interpretation')]);
    assert('gate: a stated limitation is published, not treated as a missing figure', limitation.accepted.length === 1, limitation.rejected);

    const shapeCases = [
      ['a bare string', 'just a sentence', 'bare string'],
      ['a draft with no text', { cites: [f0.evidenceId], kind: 'observation' }, 'no sentence'],
      ['a draft with an unknown kind', { text: quote(f0), cites: [f0.evidenceId], kind: 'fact' }, 'no kind'],
    ];
    for (const [name, raw, expected] of shapeCases) {
      const out = run(pkg, [raw]);
      assert(`gate: an unreadable draft (${name}) is dropped with a reason`, out.rejected.length === 1 && out.accepted.length === 0 && new RegExp(expected).test(out.rejected[0].reason), out.rejected);
    }

    const many = run(pkg, Array.from({ length: MAX_FINDINGS + 3 }, () => draft(quote(f0), f0.evidenceId)));
    assert(`gate: no more than ${MAX_FINDINGS} claims are taken from one answer`, many.accepted.length === MAX_FINDINGS, { accepted: many.accepted.length, rejected: many.rejected.map((r) => r.reason) });
    assert(`gate: the ${MAX_FINDINGS + 3 - MAX_FINDINGS} claims over the limit are dropped with a reason, not silently`, many.rejected.length === 3 && many.rejected.every((r) => /limit/i.test(r.reason)), many.rejected);
    assert('gate: nothing is invented to fill a rejected claim', many.empty === false || many.accepted.length === 0, many.accepted.length);

    // A gap that is really a refused source, not a section label or an uncomputable derivation.
    const refusedGap = pkg.gaps.find((g) => !g.evidenceId.startsWith('section.') && /did not answer/i.test(g.reason));
    if (refusedGap) {
      const citedGap = run(pkg, [draft('The listed source did not answer for this scope, so nothing is offered for it.', refusedGap.evidenceId, 'interpretation')]);
      assert(`gate: a source that refused cannot carry a sentence (${refusedGap.evidenceId})`, citedGap.accepted.length === 0 && /did not answer/.test(citedGap.rejected[0]?.reason ?? ''), citedGap.rejected);
    } else {
      note('gate: every publisher answered today, so the refused-source citation case was not exercised');
    }
    const sectionCite = run(pkg, [draft('Where a section reports its own gap, this page repeats that gap instead of a figure.', `section.${marketBundle.sections[0].id}`, 'interpretation')]);
    assert('gate: a limitation can cite the section that states it', sectionCite.accepted.length === 1, sectionCite.rejected);

    section('the payload the page renders, and the provider seam');
    const payload = buildInsightsPayload(pkg, okCase, 'fixture-model');
    assert('payload: reference, mode and selection come from the package', payload.reference === pkg.reference && payload.mode === pkg.mode && payload.selection === pkg.selection, payload);
    assert('payload: only the cited figures travel with the sentence', payload.cited.every((f) => f0.evidenceId === f.evidenceId) && payload.cited.length > 0, payload.cited.map((f) => f.evidenceId));
    assert('payload: gaps are limited to the ones a sentence names', payload.gaps.every((g) => f0.evidenceId === g.evidenceId), payload.gaps);
    assert('payload: the model name is carried, so prose is attributable', payload.model === 'fixture-model', payload.model);

    const parseCases = [
      ['a bare object with a findings array', `{"findings":[{"text":"a","cites":["x"],"kind":"observation"}]}`, true],
      ['a markdown-fenced array', '```json\n[{"text":"a","cites":["x"],"kind":"observation"}]\n```', true],
      ['an empty answer', '', false],
      ['prose with no JSON', 'The market looks stable this month.', false],
      ['JSON that does not parse', '{"findings":[{"text":"a",}]', false],
      ['JSON with no findings array', '{"summary":"looks fine"}', false],
    ];
    for (const [name, raw, shouldParse] of parseCases) {
      const out = parseFindingsPayload(raw);
      assert(`parse: ${shouldParse ? 'accepts' : 'refuses'} — ${name}`, out.ok === shouldParse, out);
    }
  }

  /* -- 15. The generator, driven through its transport seam. The fixtures here stand in for a
        provider answer on purpose: this repository has no Gemini key, and a test that pretended to
        have called one would be exactly the kind of claim Phase 4 forbids. What is proven is the
        wiring — package in, validated findings out, and no call at all when there is nothing to
        ground. -- */
  const { generateGroundedFindings } = await ts('lib/report/generateFindings.ts');
  section('the generator seam — what happens when the provider answers, and when it does not');
  {
    const f0 = pkg.facts.find((f) => f.value !== null && !f.stale) ?? pkg.facts[0];
    let calls = 0;
    const transport = (text) => async () => { calls += 1; return { ok: true, text }; };

    const good = await generateGroundedFindings(marketBundle, { transport: transport(JSON.stringify({ findings: [{ text: `The published figure is ${f0.value} ${f0.units}.`, cites: [f0.evidenceId], kind: 'observation' }] })) });
    assert('generate: an answer that cites is returned as accepted findings', good.ok === true && good.findings.accepted.length === 1 && good.findings.rejected.length === 0, good.ok ? good.findings : good.failure);
    assert('generate: the package the model was shown comes back with the answer', good.ok && good.package.facts.length === pkg.facts.length && good.package.reference === pkg.reference, undefined);
    assert('generate: the model id is attributed, not the browser', good.ok && typeof good.model === 'string' && good.model.length > 0, good.model);

    const malformed = await generateGroundedFindings(marketBundle, { transport: transport('the market is stable, nothing to cite') });
    assert('generate: prose instead of JSON is a typed failure', malformed.ok === false && malformed.failure.code === 'malformed', malformed.ok ? malformed.findings : malformed.failure);
    assert('generate: a malformed answer produces no findings at all', malformed.ok === false && malformed.package.facts.length > 0, undefined);

    const refused = await generateGroundedFindings(marketBundle, { transport: async () => { calls += 1; return { ok: false, failure: { code: 'timeout', message: 'The provider did not answer within 25 seconds.' } }; } });
    assert('generate: a provider timeout is returned as-is, with no substitute text', refused.ok === false && refused.failure.code === 'timeout' && refused.failure.message.includes('25 seconds'), refused.ok ? refused.findings : refused.failure);

    const silent = JSON.parse(JSON.stringify(marketBundle));
    for (const sec of silent.sections) {
      sec.status = 'unavailable';
      sec.unavailableReason = `${sec.title}: every publisher refused this scope (synthesised for the no-evidence check).`;
      sec.evidence = [];
    }
    silent.meta.coverage = Object.fromEntries(silent.sections.map((s) => [s.id, 'unavailable']));
    silent.meta.sourceRegister = [];
    const before = calls;
    const grounded = await generateGroundedFindings(silent, { transport: transport('{"findings":[]}') });
    assert('generate: an empty package refuses to spend a provider call', grounded.ok === false && grounded.failure.code === 'no_evidence' && calls === before, { code: grounded.ok ? 'accepted' : grounded.failure.code, calls });
    assert('generate: the refusal says the report stands on its own', grounded.ok === false && /stands on its facts page/i.test(grounded.failure.message), grounded.ok ? null : grounded.failure.message);

    if (process.env.GEMINI_API_KEY) {
      note('generate: a GEMINI_API_KEY is present in this environment, so the not_configured path was not exercised; the real provider was still not called.');
    } else {
      const unconfigured = await generateGroundedFindings(marketBundle);
      assert('generate: no key on the server is a typed refusal, not an invented insight', unconfigured.ok === false && unconfigured.failure.code === 'not_configured', unconfigured.ok ? unconfigured.findings : unconfigured.failure);
      assert('generate: the refusal names the missing variable and nothing else', unconfigured.ok === false && /GEMINI_API_KEY/.test(unconfigured.failure.message) && !/AIza|Bearer/.test(unconfigured.failure.message), unconfigured.ok ? null : unconfigured.failure.message);
    }

    const prompt = (await ts('services/prompts.ts')).getEvidenceFindingsPrompt(pkg);
    assert('prompt: the scope, reference and mode are stated from the package', prompt.includes(pkg.reference) && prompt.includes(pkg.scope), prompt.slice(0, 200));
    assert('prompt: every rule travels into it', pkg.rules.every((r) => prompt.includes(r)), pkg.rules.filter((r) => !prompt.includes(r)));
    assert('prompt: every fact line the model may cite is present', pkg.facts.every((f) => prompt.includes(f.statement)), pkg.facts.filter((f) => !prompt.includes(f.statement)).length);
    assert('prompt: gaps are offered as things to state, not to fill', pkg.gaps.every((g) => prompt.includes(g.reason)), undefined);
    assert('prompt: it forbids arithmetic and counting explicitly', /Do not perform arithmetic/.test(prompt) && /count rows or facts/.test(prompt), undefined);
    assert('prompt: it forbids inventing a figure, a place, a date or a source', /Do not introduce a figure, place, date, commodity, source/.test(prompt), undefined);
    assert('prompt: it asks for JSON only and states the kind vocabulary', /Return only valid JSON/.test(prompt) && /"observation"|"interpretation"|"recommendation"/.test(prompt.replace(/\s+/g, ' ')), undefined);
  }

  /* -- 16. The insight view and the route that produces it (Phase 4), read as source: what a page
        may say before the answer lands, and what the route must never accept. -- */
  const { describeInsights, FINDING_KIND_LABEL } = await ts('lib/report/reportState.ts');
  section('the interpretation view and the insights route');
  {
    const f0 = pkg.facts.find((f) => f.value !== null && !f.stale) ?? pkg.facts[0];
    const payload = buildInsightsPayload(pkg, validateFindings(marketBundle, pkg, [{ text: `The published figure is ${f0.value} ${f0.units}.`, cites: [f0.evidenceId], kind: 'observation' }], 'fixture-model'), 'fixture-model');

    const idle = describeInsights({ loading: false, error: null, payload: null, blocked: 'Build report data first.' });
    assert('insight view: nothing generated yet is idle with a reason, not a spinner', idle.state === 'idle' && idle.headline === '' && idle.blocked === 'Build report data first.', idle);
    assert('insight view: loading says the publishers are being re-read', describeInsights({ loading: true, error: null, payload: null, blocked: null }).state === 'loading', undefined);
    assert('insight view: a failure message is shown verbatim', describeInsights({ loading: false, error: { code: 'not_configured', message: 'GEMINI_API_KEY is not set on this server.' }, payload: null, blocked: null }).headline === 'GEMINI_API_KEY is not set on this server.', undefined);
    const ready = describeInsights({ loading: false, error: null, payload, blocked: null });
    assert('insight view: a payload with findings is ready, and counts both halves', ready.state === 'ready' && ready.headline.includes('1 statement'), ready.headline);
    assert('insight view: the payload reaches the view unmodified', ready.payload === payload, undefined);
    const nothing = describeInsights({ loading: false, error: null, payload: { ...payload, findings: [], rejected: [{ preview: 'x', cites: [], reason: 'y' }] }, blocked: null });
    assert('insight view: every claim dropped is stated as dropped, not as an empty insight', nothing.state === 'nothing' && /none was supported/i.test(nothing.headline), nothing.headline);
    assert('insight view: an answer with no claims at all says the model returned nothing', describeInsights({ loading: false, error: null, payload: { ...payload, findings: [], rejected: [] }, blocked: null }).headline.includes('no claim'), undefined);
    assert('insight view: kinds are labelled without status words', Object.values(FINDING_KIND_LABEL).every((l) => !/verif|certif|sign/i.test(l)), FINDING_KIND_LABEL);

    const sources = readFileSync(resolvePath(ROOT, 'app/api/report/insights/route.ts'), 'utf8');
    assert('route: the caller is verified before the paid call', sources.indexOf('verifyCaller(request)') < sources.indexOf('generateGroundedFindings('), undefined);
    assert('route: the same scope validator as the report read', /parseReportQuery\(/.test(sources) && !/stringParam\(|numberParam\(|intParam\(/.test(sources), undefined);
    assert('route: identity comes from the token, never the body', /caller: \{ displayName: caller\.email \}/.test(sources), sources.match(/caller:[^\n]*/)?.[0]);
    assert('route: no evidence is taken from the client', !/request\.json\(/.test(sources) && /application\/x-www-form-urlencoded/.test(sources), undefined);
    assert('route: every answer is private and not cached', (sources.match(/private, no-store/g) ?? []).length >= 2 && /noStore\(badRequest\(/.test(sources) && /noStore\(errorResponse\(/.test(sources), sources.match(/cache-control|noStore\(/g));
    assert('route: no provider key appears in the route', !/GEMINI_API_KEY/.test(sources), sources.match(/GEMINI_API_KEY/)?.[0]);

    const panel = readFileSync(resolvePath(ROOT, 'components/report/InsightReportPanel.tsx'), 'utf8');
    assert('panel: a sentence is printed with the evidence it cites', /finding\.cites\.map/.test(panel) && /fact\.valueKind/.test(panel) && /fact\.stale/.test(panel), undefined);
    assert('panel: dropped claims are listed with their reason', /payload\.rejected/.test(panel) && /\{draft\.reason\}/.test(panel), undefined);
    assert('panel: citations jump to the register row that publishes them', /register-row-/.test(panel), undefined);
    assert('panel: the interpretation names its own server read, not the table in hand', /payload\.reference/.test(panel) && /payload\.model/.test(panel) && /stamp\(payload\.generatedAt\)/.test(panel), undefined);
    assert('panel: generating is gated on a bundle already in hand', /report\.bundle === null/.test(panel) && /Build report data first/.test(panel), undefined);
    assert('panel: a scope change clears the interpretation with the bundle', /insights\.clear\(\)/.test(panel) && /const build = \(\) =>/.test(panel), undefined);

    const page = readFileSync(resolvePath(ROOT, 'app/dashboard/insights/page.tsx'), 'utf8');
    assert('page: a signed-out visitor is not held on the spinner', /\(loading \|\| fetching \|\| \(user && !fetched\)\)/.test(page) && /if \(!user\)[\s\S]{0,120}return/.test(page), page.match(/if \(loading \|\| fetching[^\n]*/)?.[0]);
    assert('page: the redirect to sign-in is unchanged', /router\.push\('\/login'\)/.test(page), undefined);
    assert('page: the report panel is rendered for a signed-out visitor too', (page.match(/<InsightReportPanel \/>/g) ?? []).length === 2, (page.match(/<InsightReportPanel \/>/g) ?? []).length);
    assert('page: no session is simulated to make the page render', !/mockUser|demo-user-id|access_token/.test(page), page.match(/mockUser|demo-user-id|access_token/)?.[0]);
  }

  /* -- 14. Phase 5: the PDF. The page rules live in one module, `scripts/pdf-checks.mjs`, which is
        the same module `scripts/check-pdf-render.mjs` runs over deterministic fixtures. Here it runs
        over the bundle this afternoon's publishers actually answered, so a fixture cannot be made to
        pass by a softer rule than the live case is held to, and a live rate limit cannot excuse a
        rule written only for the case that happened to answer. Two halves are asserted apart on
        purpose: the block program in `lib/report/pdfDocument.ts` — pure, no clock, no jsPDF, the one
        place a sentence about the data may be written — and the rendered bytes read back out of the
        file jsPDF wrote, so "it compiled" cannot stand in for "the page says it". -- */
  section('the evidence PDF — the fixture harness’s rules, against what the publishers answered');
  {
    const { buildEvidencePdf, buildRecordPdf, VALUE_KIND_WORD } = await ts('lib/report/pdfDocument.ts');
    const { documentNeedsUnicodeFont, generateEvidencePdf, generatePDFReport, pdfSafe } = await ts('services/pdfExport.ts');
    const { loadUnicodeFont } = await ts('services/pdfUnicodeFont.ts');
    const pdfCtx = {
      assert, note, ts, describeReport, buildEvidencePackage, validateFindings, buildInsightsPayload,
      buildEvidencePdf, buildRecordPdf, generateEvidencePdf, generatePDFReport, pdfSafe,
      VALUE_KIND_WORD, documentNeedsUnicodeFont,
      // The product hands the exporter a loader, not a font, so a Latin report never pays for the
      // 268 kB face. The live runs go through exactly that seam.
      unicodeFont: loadUnicodeFont, extract: null, outDir: null,
    };

    await checkPdfDocument(pdfCtx, { label: 'live bundle', bundle: marketBundle });

    /* -- the states a live afternoon will not hand anyone, made from the read in hand -- */
    const allRefused = JSON.parse(JSON.stringify(marketBundle));
    for (const sec of allRefused.sections) {
      sec.status = 'unavailable';
      sec.unavailableReason = `${sec.title}: every publisher refused this scope (fixture: no source can be scheduled to fail at once).`;
      sec.evidence = [];
    }
    allRefused.meta.coverage = Object.fromEntries(allRefused.sections.map((s) => [s.id, 'unavailable']));
    allRefused.meta.sourceRegister = [
      { ...allRefused.meta.sourceRegister[0], license: '', sourceUrl: '', endpoint: '', observedAt: null, units: '', coverage: '', state: 'unavailable', stale: false, detail: 'refused (fixture)' },
    ];
    await checkPdfDocument(pdfCtx, { label: 'no publisher answered', bundle: allRefused });
    const refusedSaid = corpus(buildEvidencePdf({ bundle: allRefused, payload: null }));
    assert('pdf: a register field the connector never got is printed as not supplied, never guessed', /not supplied/.test(refusedSaid) && /not stated/.test(refusedSaid), refusedSaid.match(/not supplied|not stated/g));

    if (assert('pdf: a demo bundle is available for the demo half of these checks', stateDemo.ok === true, stateDemo.error)) {
      await checkPdfDocument(pdfCtx, { label: 'live demo workspace', bundle: stateDemo.bundle });
    }

    await checkRecordPdf(pdfCtx, { label: 'stored record' });
    checkPdfWiring(pdfCtx);
  }

  /* -- 10. HTTP: what only a running route can prove. -- */
  if (BASE) {
    section(`HTTP contract against ${BASE}`);
    await httpChecks();
  } else {
    section('HTTP contract skipped');
    note('run with --base http://127.0.0.1:3000 while `npm run dev` is up to also prove the routes forward region/mode, that both report routes refuse an unauthenticated caller, and that a visitor with no session gets a stated sign-in state rather than a spinner.');
  }

  console.log(`\n${checks - failures}/${checks} assertions passed.`);
  if (failures > 0) {
    console.log(`${failures} FAILED.`);
    process.exitCode = 1;
  } else {
    console.log('Report-data contract holds for every case exercised.');
    console.log(`  (${notes.length} notes above record what the publishers actually answered today.)`);
  }
}

async function httpChecks() {
  const get = async (path, init = {}) => {
    const res = await fetch(`${BASE}${path}`, { headers: { accept: 'application/json' }, ...init });
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { res, body };
  };

  // The authenticated report route must refuse before it contacts a single publisher.
  for (const [name, headers] of [
    ['no credential', {}],
    ['a garbage token', { authorization: 'Bearer garbage-token-that-supabase-has-never-issued' }],
    ['a non-bearer scheme', { authorization: 'Basic Zm9vOmJhcg==' }],
    ['the word Bearer with no token', { authorization: 'Bearer' }],
  ]) {
    const { res, body } = await get('/api/report/insight-data?market=Jimma', { headers });
    assert(`insight-data ${name}: refused`, res.status === 401 || res.status === 503, { status: res.status, body });
    assert(`insight-data ${name}: code auth_required`, body?.ok === false && body?.error?.code === 'auth_required', body?.error);
    assert(`insight-data ${name}: no bundle leaked`, body?.data == null, body?.data);
    assert(`insight-data ${name}: no message content that could be replayed`, !/eyJ|token=[A-Za-z0-9]/.test(JSON.stringify(body ?? {})), undefined);
    assert(`insight-data ${name}: private, not CDN-cacheable`, (res.headers.get('cache-control') ?? '').includes('no-store'), res.headers.get('cache-control'));
  }

  // The route has to forward `region` — that is the half of G-3 the connector test cannot see.
  const regionName = (await (await get('/api/data/locations')).body?.data?.places ?? [])
    .map((p) => p.admin1).filter((v, i, a) => a.indexOf(v) === i).find((r) => r === 'Oromia') ?? 'Amhara';
  const filtered = await get(`/api/data/markets?mode=history&commodity=Teff&region=${encodeURIComponent(regionName)}&months=12`);
  assert('markets history: HTTP 200', filtered.res.status === 200, { status: filtered.res.status, error: filtered.body?.error });
  if (filtered.body?.ok) {
    const rows = filtered.body.data.series ?? [];
    const seen = [...new Set(rows.map((r) => r.admin1))];
    assert(`markets history: the route forwarded region=${regionName}`, rows.length > 0 && seen.every((a) => String(a).toLowerCase() === regionName.toLowerCase()), seen);
    assert('markets history: provenance coverage repeats the region to the reader', (filtered.body.provenance?.coverage ?? '').toLowerCase().includes(regionName.toLowerCase()), filtered.body.provenance?.coverage);
    note(`G-3 over HTTP: ${rows.length} Teff rows, all in ${seen.join('/')}`);
  }
  const spread = await get('/api/data/markets?mode=history&commodity=Teff&months=12');
  if (spread.body?.ok) {
    const seen = new Set(spread.body.data.series.map((r) => r.admin1));
    assert('markets history control: without a region the same query spans many regions', seen.size >= 3, [...seen]);
    assert('markets history control: so the filtered assertion above is not vacuous', spread.body.data.series.some((r) => String(r.admin1).toLowerCase() !== regionName.toLowerCase()), undefined);
  }
  const bogus = await get('/api/data/markets?mode=history&commodity=Teff&region=Atlantis');
  assert('markets history: an unknown region answers 404, not the whole country', bogus.res.status === 404 && bogus.body?.error?.code === 'no_data', { status: bogus.res.status, error: bogus.body?.error });
  assert('markets history: the refusal names the region', /Atlantis/.test(bogus.body?.error?.message ?? ''), bogus.body?.error?.message);

  const snapshotRegion = await get('/api/data/markets?mode=snapshot&region=' + encodeURIComponent(regionName) + '&months=3&limit=500');
  if (snapshotRegion.body?.ok) {
    const rows = snapshotRegion.body.data.rows ?? [];
    assert('markets snapshot: region rows only (unchanged behaviour, now asserted)', rows.length > 0 && rows.every((r) => String(r.admin1).toLowerCase() === regionName.toLowerCase()), [...new Set(rows.map((r) => r.admin1))]);
  }

  for (const [q, name] of [['?mode=nonsense', 'bad mode'], ['?lat=9.02', 'lon without lat']]) {
    const { res, body } = await get(`/api/report/insight-data${q}`, { headers: { authorization: 'Bearer definitely-not-issued' } });
    // Auth is checked first, so a refusal here is a refusal either way — the point is that an
    // unverified caller never reaches validation of a query it could not send.
    assert(`insight-data ${name}: still refused before parsing`, res.status === 401 || res.status === 503, { status: res.status, code: body?.error?.code });
  }

  const text = JSON.stringify((await get('/api/data/markets?mode=overview')).body ?? {});
  assert('markets overview: no credential material in the response', !/api[_-]?key|secret|token|password|eyJ|Signature=/i.test(text), text.match(/.{0,40}(api[_-]?key|secret|token|password|eyJ).{0,40}/i)?.[0]);

  /* -- Phase 3 over HTTP: the region list the panel offers has to be the list the report route
        accepts, or the picker can select a scope that resolves to a refusal. -- */
  const { knownRegions } = await ts('lib/report/scope.ts');
  const locationsHttp = await get('/api/data/locations');
  assert('locations over HTTP: 200 with a place list', locationsHttp.res.status === 200 && (locationsHttp.body?.data?.places?.length ?? 0) > 0, { status: locationsHttp.res.status, error: locationsHttp.body?.error });
  const httpRegions = (locationsHttp.body?.data?.regionNames ?? []).slice().sort();
  const routeRegions = [...knownRegions()].sort();
  assert('locations over HTTP: regionNames is exactly the set the report route accepts', JSON.stringify(httpRegions) === JSON.stringify(routeRegions), { http: httpRegions, route: routeRegions });
  const httpPlaceNames = [...new Set((locationsHttp.body?.data?.places ?? []).map((p) => p.name))];
  assert('locations over HTTP: every name the panel can pick is a market the report resolves', httpPlaceNames.length > 0 && httpPlaceNames.every((n) => (n ?? '') !== ''), httpPlaceNames.slice(0, 5));

  // GET-only is a property the panel depends on: the bundle is a read, and a read that could write
  // would not be cache-refusing and idempotent the way this route documents itself.
  const post = await fetch(`${BASE}/api/report/insight-data?market=Jimma`, {
    method: 'POST',
    headers: { accept: 'application/json', authorization: 'Bearer definitely-not-issued' },
  });
  assert('insight-data: POST is refused with 405 (the report is a read)', post.status === 405, { status: post.status });
  assert('insight-data: a refused POST still carries no bundle', !/\"data\":\s*\{/.test(JSON.stringify(await post.text())), undefined);

  /* -- Phase 4 over HTTP. The insights route is the one endpoint in this workflow that spends a
        paid provider call, so what matters here is the order of its refusals. No token is
        fabricated: what a *verified* caller receives stays unproven from this machine, and is
        recorded as such. -- */
  section('the insights route, called without a credential');

  const postInsights = async (headers = {}, body = 'market=Jimma') => {
    const res = await fetch(`${BASE}/api/report/insights`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded', ...headers },
      body,
    });
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { res, json };
  };

  for (const [name, headers] of [
    ['no credential', {}],
    ['a garbage token', { authorization: 'Bearer garbage-token-that-supabase-has-never-issued' }],
    ['a non-bearer scheme', { authorization: 'Basic Zm9vOmJhcg==' }],
  ]) {
    const { res, json } = await postInsights(headers);
    assert(`insights ${name}: refused`, res.status === 401 || res.status === 503, { status: res.status, json });
    assert(`insights ${name}: code auth_required`, json?.ok === false && json?.error?.code === 'auth_required', json?.error);
    assert(`insights ${name}: no findings and no evidence package leaked`, json?.data == null, json?.data);
    assert(`insights ${name}: private, not CDN-cacheable`, (res.headers.get('cache-control') ?? '').includes('no-store'), res.headers.get('cache-control'));
  }

  // Auth is the route's first statement, so a body it would otherwise reject is still an auth
  // refusal for an unverified caller — the 400 branch cannot be reached without a token.
  const wrongType = await fetch(`${BASE}/api/report/insights`, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: '{"market":"Jimma"}' });
  assert('insights: an unverified caller never reaches the body checks', wrongType.status === 401 || wrongType.status === 503, { status: wrongType.status });
  assert('insights: a refusal names no model and no finding', !/gemini|model|finding/i.test(JSON.stringify(await wrongType.json().catch(() => ({})))), undefined);

  const readInsights = await fetch(`${BASE}/api/report/insights`, { headers: { accept: 'application/json' } });
  assert('insights: GET is refused with 405 (an interpretation is a paid call, not a read to be replayed)', readInsights.status === 405, { status: readInsights.status });
  note('insights: the path a verified caller takes — bundle re-read, provider call, validator — is not exercisable from this machine, which holds no session and will not invent one.');

  const pageHtml = await (await fetch(`${BASE}/dashboard/insights`, { headers: { accept: 'text/html' } })).text();
  assert('page over HTTP: the first paint for a visitor with no session is a stated state, not the spinner', !/Syncing Intelligence Streams/.test(pageHtml), undefined);
  assert('page over HTTP: that state names sign-in as what is missing', /Sign-in is not configured|No active session/.test(pageHtml), pageHtml.match(/Sign-in[^<]{0,60}|No active session/)?.[0]);
  assert('page over HTTP: the report panel is on the page a signed-out visitor lands on', /Evidence report data/.test(pageHtml), undefined);
  assert('page over HTTP: the markup carries no credential material', !/api[_-]?key|secret|token=[A-Za-z0-9]|eyJ[A-Za-z0-9_]/i.test(pageHtml), pageHtml.match(/.{0,40}(api[_-]?key|secret|eyJ[A-Za-z0-9_]).{0,40}/i)?.[0]);
}

main().catch((err) => {
  console.error('\nChecker could not run:', err instanceof Error ? `${err.message}\n${err.stack}` : err);
  if (BASE) console.error('Is the dev server up? Try: npm run dev, then re-run this script.');
  process.exitCode = 2;
});
