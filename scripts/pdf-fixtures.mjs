/**
 * Deterministic `ReportBundle` fixtures for the Phase 5 PDF checks.
 *
 * These are synthetic *inputs*, not synthetic *reports*. They exist because the Phase 5 brief asks
 * for a PDF harness that covers complete, partial, stale, unavailable-chart, no-data and demo
 * states, and because no afternoon can schedule nine publishers to fail at once — nor can it
 * produce a source behind schedule on demand. The live harness (`check-report-data.mjs`) runs the
 * same assertions against the bundle this afternoon's publishers answered; these fixtures supply the
 * states it will not.
 *
 * Nothing here calls a network or a clock. Every date is a literal, so a run is reproducible and a
 * failing assertion points at a rule that broke rather than at a publisher that moved. The shapes
 * follow `lib/report/types.ts` exactly, including the three rules the orchestrator itself applies
 * when it decides a section's status, a source-register line and a warning
 * (`lib/report/buildReportBundle.ts`: `section`, `registerFor`, `collectWarnings`). Those three are
 * mirrored here rather than invented again, which is what lets a fixture stand in for a real read.
 *
 * No fixture is ever presented as evidence. The PDFs they produce are written under `artifacts/pdf/`
 * and each one names its reference and its workspace on the cover.
 */

import { nonAnswerProvenance } from './provenance-rule.mjs';

/** Every timestamp in these fixtures. A bundle may not carry a moment the publishers did not state. */
const RETRIEVED = '2026-11-02T06:15:00.000Z';
const OBSOLETE = '2026-09-01';

const provenance = (over = {}) => ({
  source: 'Open-Meteo',
  sourceUrl: 'https://open-meteo.com/',
  endpoint: 'https://api.open-meteo.com/v1/forecast',
  license: 'CC BY 4.0',
  retrievedAt: RETRIEVED,
  observedAt: '2026-11-01',
  valueKind: 'observed',
  units: '°C',
  methodology: 'Numerical weather prediction values, downscaled to the coordinate stated on the scope line.',
  quality: 'high',
  coverage: 'Adama, one market centre',
  maxAgeSeconds: 3600,
  stale: false,
  servedFromCache: false,
  ...over,
});

const scopeOf = (over = {}) => ({
  kind: 'market',
  place: 'Adama',
  marketId: 'ET-ADAM',
  region: 'Oromia',
  location: { name: 'Adama', admin1: 'Oromia', admin2: 'East Shewa', latitude: 8.5405, longitude: 39.2708, coordinateSource: 'source-catalogue' },
  spatial: 'market',
  note: null,
  ...over,
});

const column = (key, label, units = null) => ({ key, label, units });

const table = (evidenceId, title, columns, rows, provenanceOf, over = {}) => ({
  evidenceId,
  title,
  columns,
  rows,
  rowsOmitted: 0,
  omissionNote: null,
  provenance: provenanceOf,
  ...over,
});

const chart = (evidenceId, title, units, valueKind, spatial, series, provenanceOf, over = {}) => ({
  evidenceId,
  title,
  units,
  valueKind,
  spatial,
  series,
  unavailableReason: null,
  provenance: provenanceOf,
  ...over,
});

const item = (evidenceId, section, provider, provenanceOf, over = {}) => ({
  evidenceId,
  section,
  provider,
  // `evidenceOf` in the orchestrator runs every outcome through the connector's fetch-time rule
  // before it becomes evidence, so a fixture that refused has to arrive stripped the same way.
  provenance: nonAnswerProvenance(provenanceOf, over.error ?? null),
  error: null,
  tables: [],
  charts: [],
  derived: [],
  caveats: [],
  ...over,
});

/** Mirrors `section()` in the orchestrator: the status is whatever the answers imply, never a choice. */
function withStatus(sec) {
  if (sec.evidence.length === 0) return sec;
  const errors = sec.evidence.filter((e) => e.error !== null);
  const reason = errors.length === sec.evidence.length
    ? `No source answered for ${sec.title.toLowerCase()}: ${errors.map((e) => `${e.provider} — ${e.error.message}`).join('; ')}`
    : null;
  return {
    ...sec,
    status: reason ? 'unavailable' : errors.length === 0 ? 'ready' : 'partial',
    unavailableReason: reason,
    caveats: reason ? [reason, ...sec.caveats] : sec.caveats,
  };
}

/** Mirrors `registerFor`: one line per evidence item, nothing added. */
function registerFor(sections) {
  return sections.flatMap((sec) => sec.evidence.map((entry) => {
    const p = entry.provenance;
    return {
      evidenceId: entry.evidenceId,
      source: p.source,
      sourceUrl: p.sourceUrl,
      endpoint: p.endpoint,
      license: p.license,
      valueKind: p.valueKind,
      units: p.units,
      coverage: p.coverage,
      spatial: entry.section === 'geospatial' ? 'single-pixel' : entry.section === 'economy' ? 'national-survey' : sec.scope.spatial,
      observedAt: p.observedAt,
      retrievedAt: p.retrievedAt,
      stale: p.stale,
      servedFromCache: p.servedFromCache,
      quality: p.quality,
      state: entry.error ? 'unavailable' : p.stale ? 'stale' : 'connected',
      detail: entry.error
        ? entry.error.message
        : `${p.retrievedAt ? `Called on ${p.retrievedAt}` : 'Answered, with no fetch time recorded'}${p.servedFromCache ? ' from this process’s cache' : ' at the publisher'}.`,
    };
  }));
}

/** Mirrors `collectWarnings`: demo flag, scope note, dead sections, dead or stale items, dead charts. */
function warningsFor(scope, demo, sections) {
  const out = [];
  if (demo) out.push({ code: 'demo_mode', message: 'Demo-mode report: real sources, demo records. Must be marked on every page.', evidenceId: null });
  if (scope.note) out.push({ code: 'scope_downgraded', message: scope.note, evidenceId: null });
  for (const sec of sections) {
    if (sec.status === 'unavailable') out.push({ code: 'insufficient_data', message: `${sec.title}: ${sec.unavailableReason}`, evidenceId: `section.${sec.id}` });
    for (const entry of sec.evidence) {
      if (entry.error) out.push({ code: 'source_unavailable', message: `${entry.provider} did not answer for ${sec.title}: ${entry.error.message}`, evidenceId: entry.evidenceId });
      else if (entry.provenance.stale) out.push({ code: 'source_stale', message: `${entry.provider}: newest observation ${entry.provenance.observedAt ?? 'undated'} is outside this source’s freshness window.`, evidenceId: entry.evidenceId });
      for (const c of entry.charts) if (c.unavailableReason) out.push({ code: 'insufficient_data', message: `${c.title}: ${c.unavailableReason}`, evidenceId: c.evidenceId });
    }
  }
  return out;
}

const UNANSWERED = { code: 'http_status', message: 'Upstream responded 502 while the satellite composite was being sampled.', status: 502 };

/** Fourteen survey months: the table shows six, the AI package sees twelve. Both cuts are disclosed. */
const MONTHS = ['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
const PRICES = [2410.75, 2505, 2620.4, 2715.9, 2801, null, 2955.6, 3040.25, 3120.75, 3260, 3410.2, null, 3575, 3688.4];

function priceRows(script) {
  return MONTHS.map((month, i) => script === 'amharic'
    ? { month, market: 'አዲስ አበባ ገበያ (Finfinnee Qaabatee)', commodity: 'ሰንገረዶ (maize)', price: PRICES[i], unit: 'quintal', flag: PRICES[i] === null ? 'missing' : i === PRICES.length - 1 ? 'estimated' : 'actual' }
    : { month, market: 'Adama', commodity: 'White maize', price: PRICES[i], unit: 'quintal', flag: PRICES[i] === null ? 'missing' : i === PRICES.length - 1 ? 'estimated' : 'actual' });
}

/**
 * One section per the contract's order. `scenario` picks the state: a refusal, a stale survey, a
 * chart with nothing honest to plot, an empty report, demo mode, or text the standard fonts cannot
 * hold. Afaan Oromo is Latin script and needs no special face; Amharic is Ge'ez script and does.
 */
function buildSections(scenario) {
  const scope = scenario.scope ?? scopeOf();
  const place = scope.place ?? 'Adama';
  const rows = priceRows(scenario.cells);
  const climateProv = provenance({ coverage: `${place}, one market centre` });
  const powerProv = provenance({
    source: 'NASA POWER', sourceUrl: 'https://power.larc.nasa.gov/', endpoint: 'https://power.larc.nasa.gov/api/temporal/daily/point',
    license: 'NASA free and open data policy', units: '°C', valueKind: 'modeled',
    methodology: 'Satellite- and model-derived reanalysis of the layer above the canopy, not a field measurement.',
    coverage: `${place}, reanalysis cell`, quality: 'medium', maxAgeSeconds: 5 * 86400, observedAt: '2026-10-28',
  });
  const geoProv = provenance({
    source: 'NASA GIBS (MODIS MOD13Q1)', sourceUrl: 'https://worldview.earthdata.nasa.gov/', endpoint: 'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best',
    license: 'NASA EOSDIS data policy', units: 'NDVI index (0–1)', valueKind: 'modeled',
    methodology: 'Sixteen-day composite reflectance index sampled at one pixel; the index is computed by the publisher from surface reflectance.',
    coverage: `${place}, one 250 m pixel`, quality: 'medium', maxAgeSeconds: 8 * 86400, observedAt: '2026-10-25',
  });
  const priceProv = provenance({
    source: 'WFP via HDX (Ethiopia food prices)', sourceUrl: 'https://data.humdata.org/dataset/wfp-food-prices-for-ethiopia/',
    endpoint: 'https://data.humdata.org/dataset/2e4f1922-4a3f-4b3d-9d3d-6b1d1a1c1e1f/resource/wfp_food_prices_eth.csv/download',
    license: 'WFP HDX terms of use', units: 'ETB per quintal', valueKind: 'observed',
    methodology: 'Market survey observations collected by WFP field teams; one row is one market, one commodity, one month.',
    coverage: `${place}, surveyed market`, maxAgeSeconds: 45 * 86400, observedAt: '2026-10-01',
  });
  const macroProv = provenance({
    source: 'National Bank of Ethiopia', sourceUrl: 'https://nbe.gov.et/', endpoint: 'https://nbe.gov.et/statistics/exchange-rates/',
    license: 'NBE public statistics', units: 'ETB per USD', valueKind: 'observed',
    methodology: 'Official commercial bank selling rate, published weekly.', coverage: 'Ethiopia, national',
    maxAgeSeconds: 7 * 86400, observedAt: '2026-10-29',
  });

  const priceTable = table('EV-MKT-1', `Surveyed prices at ${place}`, [
    column('month', 'Survey month'), column('market', 'Market'), column('commodity', 'Commodity'),
    column('price', 'Retail price', 'ETB/quintal'), column('unit', 'Unit'), column('flag', 'Price flag'),
  ], rows.slice(-6), priceProv, scenario.truncated
    ? { rowsOmitted: 8, omissionNote: 'The table prints the six most recent survey months; the publisher returned fourteen for this scope.' }
    : {});

  const partnerRows = scenario.cells === 'amharic'
    ? [{ partner: 'دبي (Dubai)', share: 24.5 }, { partner: 'ሱዳን (Sudan)', share: 11.2 }, { partner: 'Singapore', share: 8.9 }]
    : [{ partner: 'Saudi Arabia', share: 24.5 }, { partner: 'Singapore', share: 11.2 }, { partner: 'China', share: 8.9 }];

  const sections = [
    {
      id: 'climate',
      title: 'Climate and weather',
      status: 'ready',
      unavailableReason: null,
      scope,
      evidence: [
        item('EV-CLM-1', 'climate', 'Open-Meteo', climateProv, {
          tables: [table('EV-CLM-1', 'Daily rainfall and temperature', [
            column('date', 'Date'), column('rain', 'Rainfall', 'mm'), column('tmax', 'Max temperature', '°C'), column('tmin', 'Min temperature', '°C'),
          ], [
            { date: '2026-10-27', rain: 4.2, tmax: 26.1, tmin: 12.4 },
            { date: '2026-10-28', rain: 0, tmax: 27.3, tmin: 11.8 },
            { date: '2026-10-29', rain: null, tmax: 25.9, tmin: 13.1 },
            { date: '2026-10-30', rain: 11.6, tmax: 24.2, tmin: 12.9 },
            { date: '2026-10-31', rain: 2.8, tmax: 26.4, tmin: null },
          ], climateProv)],
          charts: [chart('EV-CLM-1.rainfall', 'Rainfall, five days', 'mm', 'observed', scope.spatial, [
            { label: 'Rainfall (mm)', points: [{ x: '2026-10-27', y: 4.2 }, { x: '2026-10-28', y: 0 }, { x: '2026-10-29', y: null }, { x: '2026-10-30', y: 11.6 }, { x: '2026-10-31', y: 2.8 }] },
            { label: 'Reference evapotranspiration (mm)', points: [{ x: '2026-10-27', y: 4.9 }, { x: '2026-10-28', y: 5.2 }, { x: '2026-10-29', y: 5.0 }, { x: '2026-10-30', y: 4.1 }, { x: '2026-10-31', y: 5.4 }] },
          ], climateProv),
          ...(scenario.emptySeries ? [chart('EV-CLM-1.soil', 'Root-zone soil moisture, three days', 'm³/m³', 'modeled', scope.spatial, [
            { label: 'Soil moisture (m³/m³)', points: [{ x: '2026-10-27', y: null }, { x: '2026-10-28', y: null }, { x: '2026-10-29', y: null }] },
          ], provenance({ ...climateProv, units: 'm³/m³', valueKind: 'modeled', methodology: 'Model value rather than a field measurement; the publisher answered but left every day in this window blank.' }))] : [])],
          caveats: ['Rainfall is the model grid point’s value, not a rain gauge in the field.'],
        }),
        item('EV-CLM-2', 'climate', 'NASA POWER', powerProv, scenario.powerDead
          ? { error: { code: 'timeout', message: 'The reanalysis endpoint did not answer within 12 s.' } }
          : {
            tables: [table('EV-CLM-2', 'Reanalysis daily means', [
              column('date', 'Date'), column('t2m', 'Mean temperature', '°C'), column('rad', 'Shortwave radiation', 'MJ/m²'),
            ], [
              { date: '2026-10-26', t2m: 19.4, rad: 22.1 },
              { date: '2026-10-27', t2m: 19.1, rad: 18.7 },
              { date: '2026-10-28', t2m: 20.3, rad: null },
            ], powerProv)],
            caveats: ['A reanalysis value is a model estimate of the day, not an observation of it.'],
          }),
      ],
      caveats: ['A dry day in this window is a published zero, not a missing value.'],
    },
    {
      id: 'geospatial',
      title: 'Vegetation and satellites',
      status: 'ready',
      unavailableReason: null,
      scope,
      evidence: [item('EV-GEO-1', 'geospatial', 'NASA GIBS (MODIS MOD13Q1)', geoProv, scenario.geoDead
        ? { error: UNANSWERED }
        : scenario.geoRefused
          ? {
            charts: [chart('EV-GEO-1.ndvi', 'Vegetation index, one pixel', 'NDVI index (0–1)', 'modeled', 'single-pixel', [], null, {
              unavailableReason: 'The composite for this window was still processing when this report was read, so there is no vegetation value to plot. Nothing was substituted for it.',
            })],
            caveats: ['An NDVI reading for one pixel is not a statistic about a region or a farm.'],
          }
          : {
            tables: [table('EV-GEO-1', 'Composite samples at one pixel', [
              column('composite', 'Composite date'), column('ndvi', 'NDVI'), column('evi', 'EVI'), column('quality', 'Quality flag'),
            ], [
              { composite: '2026-09-25', ndvi: 0.41, evi: 0.28, quality: 'good' },
              { composite: '2026-10-09', ndvi: 0.53, evi: 0.36, quality: 'good' },
              { composite: '2026-10-25', ndvi: 0.47, evi: null, quality: 'mixed' },
            ], geoProv)],
            charts: [chart('EV-GEO-1.ndvi', 'Vegetation index, one pixel', 'NDVI index (0–1)', 'modeled', 'single-pixel', [
              { label: 'NDVI (one 250 m pixel)', points: [{ x: '2026-09-25', y: 0.41 }, { x: '2026-10-09', y: 0.53 }, { x: '2026-10-25', y: 0.47 }] },
            ], geoProv)],
            caveats: ['An NDVI reading for one pixel is not a statistic about a region or a farm.'],
          })],
      caveats: [],
    },
    {
      id: 'market',
      title: 'Market prices',
      status: 'ready',
      unavailableReason: null,
      scope,
      evidence: [item('EV-MKT-1', 'market', 'WFP via HDX (Ethiopia food prices)', scenario.stalePrice ? { ...priceProv, stale: true, observedAt: OBSOLETE } : priceProv, {
        tables: [priceTable],
        charts: [chart('EV-MKT-1.series', 'Retail price, fourteen survey months', 'ETB per quintal', 'observed', scope.spatial, [
          { label: 'White maize, retail (ETB per quintal)', points: rows.map((r) => ({ x: r.month, y: r.price })) },
        ], priceProv)],
        derived: [{
          evidenceId: 'EV-MKT-1.mean',
          label: 'Mean retail price over the months the publisher stated',
          value: 2977.29,
          units: 'ETB per quintal',
          formula: 'Sum of the twelve published monthly retail prices divided by twelve. The two months the publisher left blank were not filled in.',
          inputs: ['EV-MKT-1'],
          valueKind: 'estimated',
          quality: 'medium',
          provenance: priceProv,
        }],
        caveats: ['These are survey observations at one market on stated dates, not a price you will be quoted tomorrow.'],
      })],
      caveats: ['A retail price at one market is not a farm-gate price.'],
    },
    {
      id: 'economy',
      title: 'Macro benchmarks',
      status: 'ready',
      unavailableReason: null,
      scope,
      evidence: [item('EV-ECON-1', 'economy', 'National Bank of Ethiopia', macroProv, {
        tables: [table('EV-ECON-1', 'Import partners by share of national imports', [
          column('partner', 'Import partner'), column('share', 'Share of imports', '%'),
        ], partnerRows, macroProv)],
        caveats: ['A national benchmark is not this market’s price.'],
      })],
      caveats: [],
    },
  ];

  if (scenario.empty) {
    return sections.map((sec) => withStatus({ ...sec, status: 'unavailable', unavailableReason: `${sec.title}: no publisher answered this scope (fixture: a report with no evidence at all).`, evidence: [], caveats: sec.caveats }));
  }
  return sections.map(withStatus);
}

/** The scenario table: one entry per state the Phase 5 brief asks the PDF to be right about. */
const SCENARIOS = {
  complete: { reference: 'NX-REP-20261102-COMPL' },
  partial: { powerDead: true, geoDead: true, truncated: true, reference: 'NX-REP-20261102-PARTL' },
  stale: { stalePrice: true, reference: 'NX-REP-20261102-STALE' },
  'unavailable-chart': { geoRefused: true, emptySeries: true, reference: 'NX-REP-20261102-NOCHT' },
  'no-data': { empty: true, reference: 'NX-REP-20261102-NODAT' },
  demo: { mode: 'demo', reference: 'NX-REP-20261102-DEMO1' },
  unicode: {
    cells: 'amharic',
    reference: 'NX-REP-20261102-UNICD',
    scope: scopeOf({ place: 'አዲስ አበባ ገበያ', marketId: 'ET-ADDIS', region: 'Addis Ababa', location: { name: 'አዲስ አበባ', admin1: 'Addis Ababa', admin2: null, latitude: 9.0320, longitude: 38.7469, coordinateSource: 'source-catalogue' } }),
  },
};

export const SCENARIO_NAMES = Object.keys(SCENARIOS);

/** One deterministic bundle, in the shape the orchestrator produces. */
export function fixtureBundle(name) {
  const scenario = SCENARIOS[name];
  const sections = buildSections(scenario);
  const scope = sections[0].scope;
  const demo = scenario.mode === 'demo';
  return {
    meta: {
      reference: scenario.reference,
      generatedAt: RETRIEVED,
      mode: demo ? 'demo' : 'production',
      demoNotice: demo
        ? 'DEMO REPORT — assembled from the demonstration workspace. The figures below are real published values retrieved at the times stated in the source register, but this report was produced from demo records and must not be presented as production intelligence.'
        : null,
      scope,
      attribution: demo
        ? { verified: false, displayName: null, note: 'No authenticated session was confirmed for this request, so the report carries no authorisation line and no signature block. Printing one regardless would be simulating authorization.' }
        : { verified: true, displayName: 'harness@local', note: 'Taken from the account whose token this server confirmed for this request.' },
      warnings: warningsFor(scope, demo, sections),
      sourceRegister: registerFor(sections),
      coverage: Object.fromEntries(sections.map((s) => [s.id, s.status])),
    },
    sections,
    findings: [],
  };
}

/**
 * What each scenario is for, and the page rule that only that scenario can prove. The generic rules
 * live in `scripts/pdf-checks.mjs`; these are the ones a different bundle would not exercise.
 */
export const SCENARIO_EXPECTATIONS = {
  complete: (bundle, doc, text) => [
    ['no chart is refused when everything answered', () => !doc.blocks.some((b) => b.type === 'chart-unavailable')],
    ['each section heading carries its own status label', () => bundle.sections.every((s) => text.includes(`${s.title} — Published figures`))],
    ['no truncation note appears when nothing was cut', () => !/not shown/.test(text)],
    ['the page plots all fourteen published months even though the model was sent twelve', () => {
      const twelve = doc.blocks.find((b) => b.type === 'chart' && b.title === 'Retail price, fourteen survey months');
      return twelve !== undefined && twelve.series.length === 1 && twelve.series[0].points.length === 14
        && bundle.sections[2].evidence[0].charts[0].series[0].points.length === 14;
    }],
  ],
  partial: (bundle, doc, text) => [
    ['the dead satellite source is named as did not answer', () => /did not answer/.test(text) && text.includes(UNANSWERED.message)],
    ['the section that partly answered is labelled Partly answered', () => bundle.sections.some((s) => s.status === 'partial') && /Vegetation and satellites — Partly answered|Climate and weather — Partly answered/.test(text)],
    ['the eight survey months the report could not fit are counted', () => /8 further rows/.test(text)],
    ['the cut is listed under tables the report had to cut', () => /Tables the report had to cut/.test(text)],
    ['a partly answered report still prints what answered rather than nothing', () => doc.blocks.some((b) => b.type === 'table' && b.head.length > 1)],
  ],
  stale: (bundle, doc, text) => [
    ['the stale survey is labelled behind schedule', () => /behind schedule/.test(text) && /BEHIND SCHEDULE/.test(text)],
    ['its own observation date is printed, not today’s', () => text.includes(OBSOLETE)],
    ['a stale figure is never called current', () => !/\bcurrent price\b/i.test(text)],
    ['the staleness is a warning the bundle carries and the page repeats', () => /source_stale/.test(text)],
  ],
  'unavailable-chart': (bundle, doc, text) => [
    ['the refused chart keeps the contract’s own sentence', () => doc.blocks.some((b) => b.type === 'chart-unavailable' && /still processing/.test(b.reason))],
    ['no series was invented to fill its area', () => !doc.blocks.some((b) => b.type === 'chart' && /Vegetation index/.test(b.title))],
    ['the all-gap chart says every published point is missing', () => /0 of 3 published points, 3 with no value/.test(text)],
    ['a refused chart is also a warning and a gap in the package', () => /insufficient_data/.test(text)],
  ],
  'no-data': (bundle, doc, text) => [
    ['not one chart is drawn from nothing', () => !doc.blocks.some((b) => b.type === 'chart' || b.type === 'chart-unavailable')],
    ['the only tables left are the status table and an empty register', () => doc.blocks.filter((b) => b.type === 'table').every((b) => b.rows.length === 0 || b.head[0] === 'Section')],
    ['every section’s own reason is printed', () => bundle.sections.every((s) => text.includes(s.unavailableReason))],
    ['an empty report still says it is not a substitute for evidence', () => /substitute|not signed/.test(text)],
    ['a register with no lines prints none rather than a placeholder source', () => bundle.meta.sourceRegister.length === 0 && doc.blocks.some((b) => b.type === 'table' && b.rows.length === 0)],
  ],
  demo: (bundle, doc, text) => [
    ['the demo notice is on the page', () => text.includes(bundle.meta.demoNotice)],
    ['a demo page never claims the production workspace', () => !/Production workspace/.test(text)],
    ['the demo warning is printed with its code', () => /demo_mode/.test(text)],
    ['the cover names the workspace the bundle was built in', () => /DEMO workspace — not live publisher evidence/.test(doc.cover.lines.join('\n'))],
  ],
  unicode: (bundle, doc, text) => [
    ['the Amharic market name is in the document the renderer is asked to draw', () => text.includes('አዲስ አበባ ገበያ')],
    ['the Afaan Oromo spelling is carried in the same cell as the Amharic one', () => text.includes('Finfinnee Qaabatee')],
    ['a script no font here holds is still asked for, so the fallback path runs', () => text.includes('دبي')],
    ['the Latin words beside them are unchanged', () => text.includes('(maize)')],
  ],
};

export { UNANSWERED, OBSOLETE, RETRIEVED };
