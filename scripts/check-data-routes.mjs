/**
 * Data-route contract check.
 *
 * Hits every `/api/data/*` endpoint with exactly the query strings the dashboard
 * components send, and asserts the fields those components dereference actually
 * exist — plus the provenance rules the product depends on: every successful
 * payload must name its publisher, its units, its methodology, its coverage and
 * the kind of value it is.
 *
 *   node scripts/check-data-routes.mjs [--base http://127.0.0.1:3000] [--quiet]
 *
 * It is read-only. The open GET routes write nowhere and take no credentials; the one route
 * that can write (`POST /api/data/sync`) is probed only with a missing or deliberately wrong
 * token, so it must refuse before contacting any publisher — a sync running from this script
 * would itself be a defect.
 * A source that is genuinely unreachable is reported as FAIL with the reason the
 * connector returned, which is the point — the UI must not be showing a number
 * that no publisher backed.
 */

const args = process.argv.slice(2);
const BASE = (() => {
  const i = args.indexOf('--base');
  return i === -1 ? 'http://127.0.0.1:3000' : args[i + 1];
})();
const QUIET = args.includes('--quiet');

const VALUE_KINDS = new Set(['observed', 'modeled', 'forecast', 'estimated', 'imputed']);
const STATES = new Set(['connected', 'stale', 'unavailable', 'auth_required', 'disabled']);

let failures = 0;
let checks = 0;

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

async function get(query) {
  const url = `${BASE}${query}`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { res, body, url };
}

/** For the one route that writes. Only ever called without a credential, so it never runs a sync. */
async function fetchJson(path, init = {}) {
  const url = `${BASE}${path}`;
  const res = await fetch(url, { headers: { accept: 'application/json' }, ...init });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { res, body, url };
}

/** Provenance rules that apply to every successful payload the UI renders. */
function checkProvenance(name, p) {
  assert(`${name}: provenance present`, p !== null && typeof p === 'object', p);
  if (!p || typeof p !== 'object') return;
  assert(`${name}: source named`, nonEmpty(p.source), p.source);
  assert(`${name}: source link`, typeof p.sourceUrl === 'string' && p.sourceUrl.startsWith('http'), p.sourceUrl);
  assert(`${name}: retrievedAt parses`, isDate(p.retrievedAt), p.retrievedAt);
  assert(`${name}: observedAt null or parses`, p.observedAt === null || isDate(p.observedAt), p.observedAt);
  assert(`${name}: valueKind declared`, VALUE_KINDS.has(p.valueKind), p.valueKind);
  assert(`${name}: units stated`, nonEmpty(p.units), p.units);
  assert(`${name}: methodology stated`, nonEmpty(p.methodology), p.methodology);
  assert(`${name}: coverage stated`, nonEmpty(p.coverage), p.coverage);
  assert(`${name}: staleness flag is boolean`, typeof p.stale === 'boolean', p.stale);
  assert(`${name}: cache flag is boolean`, typeof p.servedFromCache === 'boolean', p.servedFromCache);
}

function section(title) {
  console.log(`\n${title}`);
}

async function okCase(name, query, inspect) {
  const { res, body } = await get(query);
  assert(`${name}: HTTP 200`, res.status === 200, { status: res.status, body });
  if (res.status !== 200) return;
  assert(`${name}: envelope ok`, body?.ok === true, body?.error ?? body);
  if (body?.ok !== true) return;
  checkProvenance(name, body.provenance);
  inspect(body.data, body);
}

async function errCase(name, query, status, code) {
  const { res, body } = await get(query);
  assert(`${name}: rejected with ${status}`, res.status === status, { got: res.status, body });
  assert(`${name}: error code ${code}`, body?.ok === false && body?.error?.code === code, body?.error);
  assert(`${name}: no data leaked on failure`, body?.data === undefined || body?.data === null, body?.data);
}

async function main() {
  console.log(`Data-route contract check against ${BASE}`);

  section('locations');
  await okCase('locations', '/api/data/locations', (d) => {
    assert('locations: places non-empty', Array.isArray(d.places) && d.places.length > 0, d.places?.length);
    const p = d.places?.[0];
    assert('locations: place has name + region + finite coords', p && nonEmpty(p.name) && nonEmpty(p.admin1) && isNum(p.latitude) && isNum(p.longitude), p);
    assert('locations: default is a listed place', d.default && d.places.some((x) => x.name === d.default.name), d.default);
  });
  await okCase('locations+regions', '/api/data/locations?regions=1', (d) => {
    assert('regions: at least one ADM1 area', Array.isArray(d.regions) && d.regions.length > 0, d.regions?.length);
    const r = d.regions?.[0];
    assert('regions: ring geometry present', r && Array.isArray(r.rings) && r.rings[0]?.length > 10, r?.rings?.[0]?.length);
    assert('regions: centroid inside Ethiopia', r && r.centroid.latitude > 3 && r.centroid.latitude < 16 && r.centroid.longitude > 32 && r.centroid.longitude < 49, r?.centroid);
    assert('regions: decimated for the browser', r && r.rings.every((ring) => ring.length <= 141), r?.rings?.map((x) => x.length));
  });

  section('weather (Open-Meteo)');
  await okCase('weather', '/api/data/weather?place=Addis%20Ababa&days=7&pastDays=7', (d) => {
    assert('weather: current conditions', d.current && isNum(d.current.temperatureC) && isNum(d.current.relativeHumidityPct), d.current);
    assert('weather: observedAt is the publisher stamp', isDate(d.current?.observedAt), d.current?.observedAt);
    assert('weather: elevation from the grid cell', isNum(d.elevationM), d.elevationM);
    assert('weather: daily rows', Array.isArray(d.daily) && d.daily.length >= 7, d.daily?.length);
    assert('weather: forecast flag present per row', d.daily.every((r) => typeof r.isForecast === 'boolean'), d.daily?.[0]);
    assert('weather: at least one forecast row', d.daily.some((r) => r.isForecast), d.daily?.map((r) => [r.date, r.isForecast]));
    assert('weather: ET0 published per row', d.daily.every((r) => r.et0Mm === null || isNum(r.et0Mm)), d.daily?.[0]?.et0Mm);
    assert('weather: point marked inside Ethiopia', d.withinEthiopia === true, d.withinEthiopia);
    assert('weather: timezone is Addis', nonEmpty(d.timezone) && d.timezone.includes('Addis'), d.timezone);
  });
  await errCase('weather bad lat', '/api/data/weather?lat=abc&lon=38', 400, 'bad_input');
  await errCase('weather history missing dates', '/api/data/weather?mode=history', 400, 'bad_input');
  await errCase('weather unknown place', '/api/data/weather?place=Nowhereville', 400, 'bad_input');

  section('agroclimatology (NASA POWER)');
  await okCase('agroclimate', '/api/data/agroclimate?place=Dessie&days=45', (d) => {
    assert('agroclimate: daily rows', Array.isArray(d.daily) && d.daily.length > 20, d.daily?.length);
    const first = d.daily?.[0];
    assert('agroclimate: precipitation in mm', first?.precipitationMm === null || isNum(first?.precipitationMm), first);
    assert('agroclimate: shortwave in MJ/m2', 'shortwaveRadiationMjPerM2' in (first ?? {}), Object.keys(first ?? {}));
    assert('agroclimate: window stated and ends in the past', d.window && isDate(d.window.end) && d.window.days === d.daily.length, d.window);
    assert('agroclimate: normals or a reason', Array.isArray(d.normals) || nonEmpty(d.normalsUnavailableReason), d.normalsUnavailableReason);
    if (d.derived) {
      assert('agroclimate: anomaly is labelled derived', d.derived.valueKind === 'estimated', d.derived.valueKind);
      assert('agroclimate: anomaly coverage disclosed', isNum(d.derived.daysWithData) && isNum(d.derived.daysRequested), d.derived);
      assert('agroclimate: anomaly percentages computable', d.derived.anomalyPct === null || isNum(d.derived.anomalyPct), d.derived.anomalyPct);
    }
    assert('agroclimate: newest row is not in the future', d.daily.at(-1)?.date <= new Date().toISOString().slice(0, 10), d.daily.at(-1)?.date);
  });

  section('geospatial (NASA GIBS + geoBoundaries)');
  await okCase('layers', '/api/data/geospatial?view=layers', (d) => {
    assert('layers: at least three composites', d.layers.length >= 3, d.layers?.length);
    for (const l of d.layers) {
      assert(`layers[${l.id}]: meaning stated`, nonEmpty(l.meaning), l.meaning);
      assert(`layers[${l.id}]: caveat stated`, nonEmpty(l.caveat), l.caveat);
      assert(`layers[${l.id}]: tile template has no secrets`, l.tileUrlTemplate.includes('{z}') && !/key=|token=|signature/i.test(l.tileUrlTemplate), l.tileUrlTemplate);
      assert(`layers[${l.id}]: newest scene date confirmed`, isDate(l.latestAvailableDate), { date: l.latestAvailableDate, err: l.availabilityError });
      assert(`layers[${l.id}]: units and range`, nonEmpty(l.units) && nonEmpty(l.valueRange), l);
    }
  });

  for (const layerId of ['VIIRS_SNPP_NDVI_8Day', 'MODIS_Terra_NDVI_8Day', 'IMERG_Precipitation_Rate']) {
    await okCase(`sample:${layerId}`, `/api/data/geospatial?view=sample&layer=${layerId}&lat=9.02&lon=38.75`, (d) => {
      assert(`sample[${layerId}]: value is a number or honestly null`, d.value === null || isNum(d.value), d.value);
      assert(`sample[${layerId}]: scene date`, isDate(d.tileDate), d.tileDate);
      assert(`sample[${layerId}]: band label or nodata explanation`, d.value === null || nonEmpty(d.band), d.band);
      assert(`sample[${layerId}]: pixel footprint disclosed`, isNum(d.pixelSizeMeters) && d.pixelSizeMeters > 0, d.pixelSizeMeters);
      assert(`sample[${layerId}]: layer meaning echoed`, nonEmpty(d.layer?.meaning) && nonEmpty(d.layer?.caveat), d.layer);
      assert(`sample[${layerId}]: coordinate round-tripped`, Math.abs(d.latitude - 9.02) < 0.02 && Math.abs(d.longitude - 38.75) < 0.02, d);
    });
  }
  await errCase('sample missing layer', '/api/data/geospatial?view=sample&lat=9&lon=38', 400, 'bad_input');
  await errCase('sample unknown layer', '/api/data/geospatial?view=sample&layer=Nope&lat=9&lon=38', 400, 'bad_input');
  await errCase('sample bad date', '/api/data/geospatial?view=sample&layer=VIIRS_SNPP_NDVI_8Day&lat=9&lon=38&date=09-02-2026', 400, 'bad_input');
  await errCase('unknown view', '/api/data/geospatial?view=nonsense', 400, 'bad_input');

  section('market prices (WFP rEMS)');
  await okCase('markets overview', '/api/data/markets?mode=overview', (d) => {
    assert('overview: survey month', isDate(d.asOf), d.asOf);
    assert('overview: grain rows present', d.commodities.length > 0, d.commodities);
    const teff = d.commodities.find((c) => /teff/i.test(c.commodity));
    assert('overview: teff priced in ETB per a stated unit', teff && teff.avgEtbPerUnit > 0 && nonEmpty(teff.unit), teff);
    assert('overview: markets counted per commodity', d.commodities.every((c) => isNum(c.markets) && c.markets > 0), d.commodities[0]);
    assert('overview: no silent unit merge', d.commodities.every((c) => nonEmpty(c.unit) && c.unit !== 'unknown'), d.commodities.map((c) => c.unit));
  });

  for (const commodity of ['Teff', 'Maize', 'Wheat', 'Sorghum', 'Coffee']) {
    await okCase(`markets history ${commodity}`, `/api/data/markets?mode=history&commodity=${commodity}&months=36`, (d) => {
      assert(`history[${commodity}]: rows returned`, Array.isArray(d.series) && d.series.length > 0, d.series?.length);
      const r = d.series?.[0];
      assert(`history[${commodity}]: currency is ETB`, d.series.every((x) => x.currency === 'ETB'), r?.currency);
      assert(`history[${commodity}]: observation dated`, r && isDate(r.observedOn), r?.observedOn);
      assert(`history[${commodity}]: price type labelled`, r && (r.retail === 'Retail' || r.retail === 'Wholesale' || r.retail === 'aggregate' || r.retail === 'unknown'), r?.retail);
      assert(`history[${commodity}]: unit preserved verbatim`, r && nonEmpty(r.unit), r?.unit);
      assert(`history[${commodity}]: rows sorted by date`, d.series.every((x, i, a) => i === 0 || a[i - 1].observedOn <= x.observedOn), undefined);
    });
  }

  await okCase('markets snapshot', '/api/data/markets?mode=snapshot&months=6&limit=400', (d) => {
    assert('snapshot: as-of date', isDate(d.asOfLatestObservation), d.asOfLatestObservation);
    assert('snapshot: rows bounded by limit', d.rows.length <= 400, d.rows.length);
    assert('snapshot: change rows exist', d.changes.length > 0, d.changes.length);
    const c = d.changes[0];
    assert('snapshot: change compares same market and unit', c && c.market && c.unit && c.latestPrice > 0, c);
    assert('snapshot: changePct null unless a previous price exists', d.changes.every((x) => (x.previousPrice === null ? x.changePct === null : isNum(x.changePct))), d.changes.find((x) => x.previousPrice === null && x.changePct !== null));
  });
  // Normalization invariants — the checks a fixture suite would otherwise own, run against
  // real parsed survey rows instead. They are about what the parser must NOT do: turn a blank
  // cell into 0, invent a coordinate, or launder an aggregated figure into an actual price.
  await okCase('markets rows', '/api/data/markets?mode=snapshot&months=3&limit=600', (d) => {
    const rows = d.rows ?? [];
    assert('rows: sample is large enough to be evidence', rows.length >= 200, rows.length);
    const bad = (fn) => rows.find(fn);
    assert('rows: a missing price stays null, never 0', !bad((r) => r.price === 0), bad((r) => r.price === 0));
    assert('rows: a missing USD conversion stays null', !bad((r) => r.usdPrice === 0), bad((r) => r.usdPrice === 0));
    assert('rows: any price present is positive', rows.every((r) => r.price === null || r.price > 0), bad((r) => r.price !== null && r.price <= 0));
    assert('rows: coordinates are null or inside Ethiopia', rows.every((r) => (r.latitude === null && r.longitude === null)
      || (isNum(r.latitude) && isNum(r.longitude) && r.latitude >= 3 && r.latitude <= 18 && r.longitude >= 32 && r.longitude <= 49)),
    bad((r) => r.latitude !== null && !(r.latitude >= 3 && r.latitude <= 18)));
    assert('rows: price flag is in the declared domain', rows.every((r) => ['actual', 'aggregate', 'replaced', 'unknown'].includes(r.priceFlag)), bad((r) => !['actual', 'aggregate', 'replaced', 'unknown'].includes(r.priceFlag)));
    assert('rows: market and commodity named', rows.every((r) => nonEmpty(r.market) && nonEmpty(r.commodity)), bad((r) => !nonEmpty(r.market) || !nonEmpty(r.commodity)));
    assert('rows: unit never invented', rows.every((r) => nonEmpty(r.unit)), bad((r) => !nonEmpty(r.unit)));
    assert('rows: observation date is a survey month, not a fetch date', rows.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.observedOn)), bad((r) => !/^\d{4}-\d{2}-\d{2}$/.test(r.observedOn)));
    const flagged = rows.filter((r) => r.priceFlag !== 'actual');
    console.log(`  note  ${flagged.length}/${rows.length} rows are aggregate or replaced survey figures, labelled as such`);
  });
  await errCase('markets history without commodity', '/api/data/markets?mode=history', 400, 'bad_input');
  await errCase('markets bad priceType', '/api/data/markets?priceType=Blackmarket', 400, 'bad_input');

  section('exchange and economic context');
  await okCase('exchange official', '/api/data/exchange?focus=official-series&points=6', (d) => {
    assert('official: dated USD/ETB points', Array.isArray(d) && d.length > 0 && isDate(d[0].observedOn), d?.[0]);
    assert('official: rate positive', d.every((p) => p.usdToEtb === null || p.usdToEtb > 0), d[0]);
  });
  await okCase('exchange unofficial', '/api/data/exchange?focus=unofficial&months=12', (d) => {
    assert('unofficial: monthly series', Array.isArray(d.series) && d.series.length > 3, d.series?.length);
    assert('unofficial: dated by month', isDate(d.series[0].observedOn), d.series[0]);
    assert('unofficial: a blank month is skipped, not zero', d.series.every((p) => isNum(p.unofficialUsdToEtb) && p.unofficialUsdToEtb > 0), d.series.find((p) => !(isNum(p.unofficialUsdToEtb) && p.unofficialUsdToEtb > 0)));
    assert('unofficial: monthly period shape', d.series.every((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.observedOn)), d.series[0]);
  });
  await okCase('exchange benchmarks', '/api/data/exchange?focus=benchmarks', (d) => {
    assert('benchmarks: indicators', Array.isArray(d.indicators) && d.indicators.length > 0, d.indicators?.length);
    assert('benchmarks: annual frequency declared', d.indicators.every((i) => i.frequency === 'annual'), d.indicators.map((i) => i.frequency));
    assert('benchmarks: observations carry a period', d.indicators.every((i) => i.observations.length > 0 && isDate(i.observations[0].period)), d.indicators[0]);
  });
  {
    const { res, body } = await get('/api/data/exchange?focus=all&points=8&months=18');
    assert('exchange all: HTTP 200', res.status === 200, res.status);
    assert('exchange all: three separate categories', body?.data?.categories?.join(',') === 'official,unofficial,benchmark', body?.data?.categories);
    assert('exchange all: three separate provenances', body?.provenance && 'official' in body.provenance && 'unofficial' in body.provenance && 'benchmark' in body.provenance, Object.keys(body?.provenance ?? {}));
    for (const key of ['official', 'unofficial', 'benchmark']) {
      const p = body?.provenance?.[key];
      const e = body?.errors?.[key];
      assert(`exchange all/${key}: either data with provenance, or an error`, Boolean(p) !== Boolean(e), { p: p?.source, e });
      if (p) checkProvenance(`exchange all/${key}`, p);
    }
    assert('exchange all: no blending of the three series', body?.data?.official !== body?.data?.unofficial, undefined);
  }
  await errCase('exchange bad date', '/api/data/exchange?date=2026-13-99', 400, 'bad_input');
  await errCase('exchange impossible day', '/api/data/exchange?date=2026-02-30', 400, 'bad_input');
  await okCase('exchange official for a stated day', '/api/data/exchange?focus=official&date=2026-10-23', (d) => {
    assert('official by date: rows returned', Array.isArray(d) && d.length > 0, d?.length);
    assert('official by date: publisher’s own date', d.every((r) => isDate(r.observedOn)), d[0]);
    assert('official by date: ETB per foreign unit', d.every((r) => r.weightedAverage === null || r.weightedAverage > 0), d[0]);
  });

  section('source status');
  {
    const { res, body } = await get('/api/data/status?sources=all');
    assert('status: HTTP 200', res.status === 200, res.status);
    const sources = body?.data?.sources ?? [];
    assert('status: every source probed', sources.length >= 9, sources.length);
    assert('status: checkedAt stamped', isDate(body?.data?.checkedAt), body?.data?.checkedAt);
    for (const s of sources) {
      assert(`status[${s.id}]: state is a known value`, STATES.has(s.state), s.state);
      assert(`status[${s.id}]: reason given`, nonEmpty(s.detail), s.detail);
      assert(`status[${s.id}]: cadence disclosed`, nonEmpty(s.cadence), s.cadence);
      assert(`status[${s.id}]: home link`, typeof s.homeUrl === 'string' && s.homeUrl.startsWith('http'), s.homeUrl);
      if ((s.state === 'connected' || s.state === 'stale') && s.cadence !== 'irregular') {
        assert(`status[${s.id}]: observation date shown`, isDate(s.observedAt), s.observedAt);
      }
    }
    const reachable = sources.filter((s) => s.state === 'connected' || s.state === 'stale').length;
    const silent = sources.filter((s) => s.state === 'unavailable').map((s) => `${s.id}: ${s.detail}`);
    console.log(`  note  ${reachable}/${sources.length} publishers answered.`);
    for (const line of silent) console.log(`        not answering — ${line}`);
    // How many publishers answer is a property of this network, not of this code — from this
    // machine some hosts are DNS-blocked and the large CSV feeds time out on a busy run. The
    // contract asserted here is the one that IS code: every non-answer must carry a state and
    // a reason (checked per source above), and enough must answer that the rest of this run is
    // measuring something real rather than a dead server.
    assert('status: the probe harness itself is working', reachable >= 4, { reachable, silent });
  }
  await errCase('status unknown ids', '/api/data/status?sources=not-a-source', 400, 'bad_input');
  {
    // The panel reads persisted=1 to separate "served from the publisher just now" from
    // "stored by a sync run". Unconfigured databases have no runs, and the honest answer
    // is an empty list rather than a fabricated one.
    const { res, body } = await get('/api/data/status?sources=light&persisted=1');
    assert('status persisted: HTTP 200', res.status === 200, res.status);
    assert('status persisted: sync is a list', Array.isArray(body?.data?.sync), body?.data?.sync);
    for (const run of body?.data?.sync ?? []) {
      assert(`status persisted[${run.sourceKey}]: status is a known outcome`, ['succeeded', 'partial', 'failed', 'skipped_overlap'].includes(run.status), run.status);
      assert(`status persisted[${run.sourceKey}]: rowsWritten is a number`, typeof run.rowsWritten === 'number', run.rowsWritten);
      assert(`status persisted[${run.sourceKey}]: timestamps null or parse`, [run.finishedAt, run.observedAt].every((v) => v === null || isDate(v)), run);
    }
  }
  {
    const { res, body } = await get('/api/data/status?sources=light');
    assert('status without persisted: no pipeline claim made', res.status === 200 && body?.data?.sync === undefined, body?.data?.sync);
  }

  section('sync endpoint guards');
  {
    const { res, body, url } = await fetchJson('/api/data/sync', {});
    assert('sync GET: HTTP 200', res.status === 200, { status: res.status, body });
    assert('sync GET: names the write method', body?.data?.method === 'POST', body?.data);
    assert('sync GET: lists the five tasks', Array.isArray(body?.data?.tasks) && body.data.tasks.join(',') === 'locations,market-prices,climate,exchange,satellite', body?.data?.tasks);
    assert('sync GET: says whether it is configured', typeof body?.data?.configured === 'boolean', body?.data?.configured);
    // An allowlist, not a keyword scan: the honest field is named `lease_key`, and what must
    // never appear is a value that could be used.
    assert('sync GET: exposes only these fields', Object.keys(body?.data ?? {}).sort().join(',') === 'configured,lease_key,method,tasks', Object.keys(body?.data ?? {}));
    assert('sync GET: no bearer material in any value', !/(bearer\s+\S{8,})|[A-Za-z0-9+/=_-]{28,}/.test(JSON.stringify(Object.values(body?.data ?? {}).flat())), undefined);
    void url;
  }
  for (const [label, headers] of [['no token', {}], ['wrong token', { authorization: 'Bearer definitely-not-the-secret' }]]) {
    const { res, body } = await fetchJson('/api/data/sync', { method: 'POST', headers });
    // 401, not a 5xx: a scheduler must treat a credential problem as terminal rather than retry it.
    assert(`sync POST ${label}: rejected with 401`, res.status === 401, { status: res.status, body });
    assert(`sync POST ${label}: error code auth_required`, body?.ok === false && body?.error?.code === 'auth_required', body?.error);
    assert(`sync POST ${label}: no data leaked`, body?.data === undefined || body?.data === null, body?.data);
    assert(`sync POST ${label}: told not to cache`, (res.headers.get('cache-control') ?? '').includes('no-store'), res.headers.get('cache-control'));
  }

  section('secrets hygiene');
  {
    const probes = [
      '/api/data/weather?place=Addis%20Ababa',
      '/api/data/markets?mode=overview',
      '/api/data/exchange?focus=all',
      '/api/data/geospatial?view=layers',
      '/api/data/status?sources=light',
    ];
    for (const q of probes) {
      const { res, body } = await get(q);
      const text = JSON.stringify(body ?? {});
      assert(`${q.slice(0, 34)}: no credential material in the response`, !/api[_-]?key|secret|token|password|eyJ|AWSASSignature|signature=/i.test(text), text.match(/.{0,40}(api[_-]?key|secret|token|password|eyJ).{0,40}/i)?.[0]);
      assert(`${q.slice(0, 34)}: no upstream URL with a signature`, !/X-Amz-Signature|X-Goog-Signature|sig=/i.test(text), undefined);
      void res;
    }
  }

  console.log(`\n${checks - failures}/${checks} assertions passed.`);
  if (failures > 0) {
    console.log(`${failures} FAILED.`);
    process.exitCode = 1;
  } else {
    console.log('All contracts hold.');
  }
}

main().catch((err) => {
  console.error('\nChecker could not run:', err instanceof Error ? err.message : err);
  console.error('Is the dev server up? Try: npm run dev, then re-run this script.');
  process.exitCode = 2;
});
