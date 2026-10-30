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
const VECTOR_GROUPS = new Set(['administrative', 'settlement', 'hydrology']);
/** Ethiopia's published envelope plus a margin — the same box the connector measures against. */
const ETH = { minLongitude: 32.9, minLatitude: 3.3, maxLongitude: 48.1, maxLatitude: 15.1 };

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

/**
 * The area centroid of a set of rings, computed here from the coordinates the route actually
 * returned. Deliberately a second implementation of the maths in `lib/data/arcgis.ts`: the
 * centre of a feature's bounding box is a different point, and it can fall outside a concave
 * outline — which matters because the map samples satellite pixels at the centroid it is
 * given, so an outline's reading would otherwise be taken off the feature entirely.
 */
function areaCentroidOfRings(rings) {
  let weight = 0;
  let lon = 0;
  let lat = 0;
  for (const ring of rings) {
    const n = ring.length;
    if (n < 3) continue;
    const closed = ring[0][0] === ring[n - 1][0] && ring[0][1] === ring[n - 1][1];
    const steps = closed ? n - 1 : n;
    let twice = 0;
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < steps; i += 1) {
      const [x0, y0] = ring[i];
      const [x1, y1] = ring[(i + 1) % n];
      const cross = x0 * y1 - x1 * y0;
      twice += cross;
      sx += (x0 + x1) * cross;
      sy += (y0 + y1) * cross;
    }
    if (Math.abs(twice) < 1e-12) continue;
    const area = Math.abs(twice) / 2;
    weight += area;
    lon += (sx / (3 * twice)) * area;
    lat += (sy / (3 * twice)) * area;
  }
  return weight === 0 ? null : { latitude: lat / weight, longitude: lon / weight };
}

/**
 * What "real geometry" has to mean before a map can draw it: the publisher's own record id
 * kept, its attributes passed through, coordinates in WGS84 degrees rather than the metres
 * the services store internally, a bbox and centroid that agree with each other, and enough
 * vertices to be an outline instead of a stub. Every one of these was a measured failure mode
 * while the connector was being written (accepted-and-ignored bboxes, EPSG:3857 answers that
 * would plot at 4e7, four-point boxes produced by a tolerance sent in metres).
 */
function checkFeature(label, f, kind) {
  if (!assert(`${label}: feature object present`, f && typeof f === 'object', f)) return;
  assert(`${label}: publisher's record id preserved`, nonEmpty(f.sourceId), f.sourceId);
  assert(`${label}: attributes are a plain object`, f.properties && typeof f.properties === 'object' && !Array.isArray(f.properties), f.properties);
  // A point's bbox is one coordinate, so it is non-decreasing rather than strictly ordered;
  // a polygon's has to have extent in both axes or it is not an outline.
  const spans = kind === 'polygon';
  assert(`${label}: bbox ordered, within ±180/±90`, f.bbox
    && f.bbox.minLongitude <= f.bbox.maxLongitude && f.bbox.minLatitude <= f.bbox.maxLatitude
    && (!spans || (f.bbox.minLongitude < f.bbox.maxLongitude && f.bbox.minLatitude < f.bbox.maxLatitude))
    && Math.abs(f.bbox.minLongitude) <= 180 && Math.abs(f.bbox.maxLongitude) <= 180
    && Math.abs(f.bbox.minLatitude) <= 90 && Math.abs(f.bbox.maxLatitude) <= 90, f.bbox);
  assert(`${label}: centroid inside its own bbox`, f.centroid && f.bbox
    && f.centroid.latitude >= f.bbox.minLatitude - 1e-9 && f.centroid.latitude <= f.bbox.maxLatitude + 1e-9
    && f.centroid.longitude >= f.bbox.minLongitude - 1e-9 && f.centroid.longitude <= f.bbox.maxLongitude + 1e-9,
  { centroid: f.centroid, bbox: f.bbox });

  const g = f.geometry;
  if (kind === 'point') {
    assert(`${label}: geometry is one coordinate`, g?.kind === 'point' && isNum(g.longitude) && isNum(g.latitude), g);
    assert(`${label}: plotted point equals its own bbox corner`, g && f.bbox
      && g.longitude === f.bbox.minLongitude && g.longitude === f.bbox.maxLongitude
      && g.latitude === f.bbox.minLatitude && g.latitude === f.bbox.maxLatitude, { g, bbox: f.bbox });
    assert(`${label}: rounded to 0.0001° as the methodology claims`, g
      && Math.abs(g.longitude * 1e4 - Math.round(g.longitude * 1e4)) < 1e-6
      && Math.abs(g.latitude * 1e4 - Math.round(g.latitude * 1e4)) < 1e-6, g);
  } else {
    assert(`${label}: geometry is at least one ring`, g?.kind === 'polygon' && Array.isArray(g.rings) && g.rings.length > 0, g?.kind ?? g);
    if (g?.kind === 'polygon') {
      const sizes = g.rings.map((r) => r.length);
      assert(`${label}: every ring has 3+ vertices`, sizes.every((n) => n >= 3), sizes);
      assert(`${label}: every vertex is a finite [lon, lat] in degrees`, g.rings.every((r) => r.every((p) => p.length === 2
        && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90)), sizes);
      assert(`${label}: ring vertices lie inside the feature bbox`, f.bbox && g.rings.every((r) => r.every((p) => p[0] >= f.bbox.minLongitude - 1e-9
        && p[0] <= f.bbox.maxLongitude + 1e-9 && p[1] >= f.bbox.minLatitude - 1e-9 && p[1] <= f.bbox.maxLatitude + 1e-9)), undefined);
      const recomputed = areaCentroidOfRings(g.rings);
      assert(`${label}: centroid is the area centroid of the outline shipped, not the middle of its box`, recomputed
        && Math.abs(f.centroid.latitude - recomputed.latitude) <= 1e-4
        && Math.abs(f.centroid.longitude - recomputed.longitude) <= 1e-4,
      { stated: f.centroid, recomputed, bboxMiddle: { latitude: (f.bbox.minLatitude + f.bbox.maxLatitude) / 2, longitude: (f.bbox.minLongitude + f.bbox.maxLongitude) / 2 } });
    }
  }
}

/** The accounting a partial view has to close: nothing may be missing without saying so. */
function checkVectorAccounting(name, d, provenance) {
  assert(`${name}: count is the publisher's own, or -1 when uncounted`, isNum(d.sourceCount), d.sourceCount);
  assert(`${name}: returned equals the features array`, d.returned === d.features.length, { returned: d.returned, length: d.features?.length });
  assert(`${name}: returned never exceeds the stated limit`, d.returned <= d.featureLimit, { returned: d.returned, featureLimit: d.featureLimit });
  assert(`${name}: at least one feature or the route would not be answering 200`, d.returned > 0, d.returned);
  if (d.sourceCount >= 0 && d.returned < d.sourceCount) {
    const explained = d.truncated === true
      || d.returned + d.droppedNoGeometry + d.droppedUnplotable >= d.sourceCount;
    assert(`${name}: a short read is labelled partial or explained by drops`, explained,
      { returned: d.returned, sourceCount: d.sourceCount, truncated: d.truncated, noGeometry: d.droppedNoGeometry, unplotable: d.droppedUnplotable });
    if (d.truncated) {
      assert(`${name}: the methodology admits the stop`, /STOPPED AT THE REQUESTED LIMIT/i.test(provenance?.methodology ?? ''), provenance?.methodology?.slice(0, 160));
    }
  }
  assert(`${name}: outsideExtent is counted, never silently clipped`, d.outsideExtent === d.features.filter((f) => !(f.bbox.maxLongitude >= ETH.minLongitude && f.bbox.minLongitude <= ETH.maxLongitude
    && f.bbox.maxLatitude >= ETH.minLatitude && f.bbox.minLatitude <= ETH.maxLatitude)).length, { stated: d.outsideExtent });
  assert(`${name}: vertex count is a real total`, isNum(d.vertices) && d.vertices >= d.returned, { vertices: d.vertices, returned: d.returned });
  assert(`${name}: pages cover at least one read`, isNum(d.pages) && d.pages >= 1, d.pages);
  assert(`${name}: the extent it was served for is stated and inside the country envelope`, d.bbox
    && d.bbox.minLongitude >= ETH.minLongitude - 0.01 && d.bbox.maxLongitude <= ETH.maxLongitude + 0.01
    && d.bbox.minLatitude >= ETH.minLatitude - 0.01 && d.bbox.maxLatitude <= ETH.maxLatitude + 0.01, d.bbox);
  assert(`${name}: tolerance is in degrees, not metres`, isNum(d.toleranceDegrees) && d.toleranceDegrees >= 0 && d.toleranceDegrees <= 0.05, d.toleranceDegrees);
  assert(`${name}: the tolerance is translated to ground distance for the legend`, isNum(d.toleranceMeters) && (d.toleranceDegrees === 0 ? d.toleranceMeters === 0 : d.toleranceMeters > 0), d);
  assert(`${name}: the layer's own meaning and caveat travel with the features`, nonEmpty(d.meaning) && nonEmpty(d.caveat), d);
  assert(`${name}: attribute units disclosed where the publisher omits them`, nonEmpty(d.attributeNotes), d.attributeNotes);
  assert(`${name}: the publisher's own layer is named`, nonEmpty(d.publisherLayer) && nonEmpty(d.layerLabel), d);
  // Freshness belongs in the log, not in an assertion: whether this request went upstream or
  // was served from the process cache is a property of the cache TTL, and the reader of this
  // evidence needs to know which one they are looking at.
  console.log(`  note  ${name}: ${d.returned} feature(s), publisher counts ${d.sourceCount} — retrieved ${provenance?.retrievedAt ?? '?'} ${provenance?.servedFromCache ? '(process cache)' : '(fetched upstream by this request)'}`);
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

  section('geospatial boundaries (geoBoundaries ADM0/ADM1)');
  // The country and region outlines the map draws underneath every vector layer. A Git LFS
  // pointer instead of the geojson is the known failure mode of the wrong media host, which
  // would parse to zero rings — so a 200 with real outlines here is itself the evidence.
  for (const [level, expect] of [[0, 1], [1, 11]]) {
    await okCase(`boundaries ADM${level}`, `/api/data/geospatial?view=boundaries&level=${level}`, (list, body) => {
      assert(`ADM${level}: areas returned`, Array.isArray(list) && list.length >= expect, list?.length);
      assert(`ADM${level}: every area carries a ring`, list.every((a) => Array.isArray(a.rings) && a.rings.length > 0 && a.rings[0].length > 2), list.map((a) => a.rings?.length));
      assert(`ADM${level}: the publisher’s own stable code`, list.every((a) => (level === 0 ? a.id === 'ETH' : /^ET-[A-Z]{2}$/.test(a.id))), list.slice(0, 3).map((a) => a.id));
      assert(`ADM${level}: codes are unique`, new Set(list.map((a) => a.id)).size === list.length, list.map((a) => a.id));
      assert(`ADM${level}: named`, list.every((a) => nonEmpty(a.name) && a.name !== 'Unnamed area'), list.find((a) => !nonEmpty(a.name) || a.name === 'Unnamed area'));
      assert(`ADM${level}: level echoed`, list.every((a) => a.level === level), list[0]?.level);
      // 140 sampled points plus the closing vertex `decimate` re-appends, so a ring at the
      // budget is exactly 141 long — the same ceiling the ADM1 case uses.
      assert(`ADM${level}: decimated to the stated point budget`, list.every((a) => a.rings.every((r) => r.length <= 141)), Math.max(...list.flatMap((a) => a.rings.map((r) => r.length))));
      assert(`ADM${level}: rounded to 0.001° as the methodology states`, list.every((a) => a.rings.every((r) => r.every(([lo, la]) => Math.abs(lo * 1e3 - Math.round(lo * 1e3)) < 1e-6 && Math.abs(la * 1e3 - Math.round(la * 1e3)) < 1e-6))), undefined);
      assert(`ADM${level}: every vertex in degrees inside the Horn`, list.every((a) => a.rings.every((r) => r.every(([lo, la]) => lo > 30 && lo < 50 && la > 2 && la < 19))), undefined);
      assert(`ADM${level}: bbox ordered and holds its own vertices`, list.every((a) => a.bbox.minLatitude <= a.bbox.maxLatitude && a.bbox.minLongitude <= a.bbox.maxLongitude
        && a.rings.every((r) => r.every(([lo, la]) => lo >= a.bbox.minLongitude - 0.001 && lo <= a.bbox.maxLongitude + 0.001 && la >= a.bbox.minLatitude - 0.001 && la <= a.bbox.maxLatitude + 0.001))), list[0]?.bbox);
      assert(`ADM${level}: centroid inside its bbox`, list.every((a) => a.centroid.latitude >= a.bbox.minLatitude && a.centroid.latitude <= a.bbox.maxLatitude
        && a.centroid.longitude >= a.bbox.minLongitude && a.centroid.longitude <= a.bbox.maxLongitude), list.find((a) => a.centroid.latitude > a.bbox.maxLatitude));
      assert(`ADM${level}: methodology admits the simplification`, /decimated/i.test(body.provenance.methodology) && /do not settle legal boundaries/i.test(body.provenance.methodology), body.provenance.methodology);
      assert(`ADM${level}: coverage counts what it served`, body.provenance.coverage.includes(`${list.length} ADM${level}`), body.provenance.coverage);
      const pts = list.reduce((n, a) => n + a.rings.reduce((m, r) => m + r.length, 0), 0);
      console.log(`  note  ADM${level}: ${list.length} areas, ${pts} outline points, ${list.map((a) => a.name).slice(0, 3).join(', ')}…`);
    });
  }
  {
    // An out-of-range level is clamped, not forwarded: ADM7 does not exist upstream, so a
    // route that passed it through would answer with a publisher error instead of a map.
    const { res, body } = await get('/api/data/geospatial?view=boundaries&level=7');
    assert('boundaries level=7: still answers', res.status === 200, { status: res.status, error: body?.error });
    assert('boundaries level=7: clamped to the deepest level that exists', (body?.data ?? []).every((a) => a.level === 1) && body?.data?.length === 11, { level: body?.data?.[0]?.level, n: body?.data?.length });
    assert('boundaries: the default is the region outlines, which is what the map asks for', (await (await fetch(`${BASE}/api/data/geospatial?view=boundaries`)).json())?.data?.[0]?.level === 1, 'default level');
  }

  section('geospatial vectors (ArcGIS feature services: admin / GRID3 / CDE)');
  // The index is what the layer toggle shows before anything is clicked, so its job is to
  // admit which publishers are not answering.
  const vectorIndex = [];
  await okCase('vectors index', '/api/data/geospatial?view=vectors', (list, body) => {
    assert('vectors: the payload is the layer list itself', Array.isArray(list), typeof list);
    assert('vectors: every registered layer is listed', list?.length === 12, list?.length);
    assert('vectors: no duplicate layer id', new Set(list.map((e) => e.id)).size === list.length, list.map((e) => e.id));
    vectorIndex.push(...list);
    for (const e of list) {
      assert(`vectors[${e.id}]: status is a declared value`, ['available', 'no_data', 'unavailable'].includes(e.status), e.status);
      assert(`vectors[${e.id}]: a layer that is not answering says why`, e.status === 'available' || nonEmpty(e.statusDetail), e);
      assert(`vectors[${e.id}]: the live count is measured or null, never guessed`, e.liveCount === null || isNum(e.liveCount), e.liveCount);
      assert(`vectors[${e.id}]: availability follows the publisher's own count`, (e.status === 'available') === (typeof e.liveCount === 'number' && e.liveCount > 0), e);
      assert(`vectors[${e.id}]: group is one the map renders`, VECTOR_GROUPS.has(e.group), e.group);
      assert(`vectors[${e.id}]: geometry kind declared`, ['point', 'polygon'].includes(e.geometryKind), e.geometryKind);
      assert(`vectors[${e.id}]: meaning and caveat stated`, nonEmpty(e.meaning) && nonEmpty(e.caveat), e);
      assert(`vectors[${e.id}]: licence named`, nonEmpty(e.license), e.license);
      assert(`vectors[${e.id}]: endpoint is https and carries no credential`, e.endpoint.startsWith('https://') && !/key=|token=|signature|f=|where=/i.test(e.endpoint), e.endpoint);
      assert(`vectors[${e.id}]: vintage is a real date or explicitly none`, e.vintage === null || isDate(e.vintage), e.vintage);
      assert(`vectors[${e.id}]: a stated vintage is explained, not just asserted`, nonEmpty(e.vintageNote), e.vintageNote);
      assert(`vectors[${e.id}]: the measurement this code shipped with is kept for comparison`, isNum(e.measuredCount) && e.measuredCount > 0, e.measuredCount);
    }
    const answering = list.filter((e) => e.status === 'available');
    assert('vectors: the catalogue is mostly live, not a dead list styled as available', answering.length >= 10, list.filter((e) => e.status !== 'available').map((e) => `${e.id}: ${e.status}`));
    const drifted = list.filter((e) => e.liveCount !== null && e.liveCount !== e.measuredCount);
    console.log(`  note  ${list.length - drifted.length}/${list.length} layers still carry the exact count measured when this was verified.`);
    for (const e of drifted) console.log(`        ${e.id}: publisher now reports ${e.liveCount}, ${e.measuredCount} at verification`);
    for (const e of list.filter((x) => x.status !== 'available')) console.log(`        not serving — ${e.id}: ${e.status} — ${e.statusDetail}`);
    console.log(`  note  counts were ${body.provenance.servedFromCache ? `served from the process cache, fetched upstream at ${body.provenance.retrievedAt}` : 'taken from each publisher by this very request'}.`);
  });

  const liveCount = (id) => vectorIndex.find((e) => e.id === id)?.liveCount ?? null;

  // A point layer served whole by a publisher that scopes it to Ethiopia: completeness is
  // assertable here because nothing was filtered, and the publisher's own coordinates are
  // carried as attributes, so the plotted point can be checked against them.
  await okCase('vector grid3-urban-point', '/api/data/geospatial?view=vector&layer=grid3-urban-point', (d, body) => {
    checkVectorAccounting('grid3-urban-point', d, body.provenance);
    assert('grid3-urban-point: it is the point layer it claims', d.geometryKind === 'point', d.geometryKind);
    assert('grid3-urban-point: one upstream page, 212 records', d.pages === 1 && d.returned === 212 && d.sourceCount === 212, { pages: d.pages, returned: d.returned, sourceCount: d.sourceCount, pageSize: d.pageSize });
    assert('grid3-urban-point: a vertex per point', d.vertices === d.returned, { vertices: d.vertices, returned: d.returned });
    assert('grid3-urban-point: no generalisation pretends to apply', d.toleranceDegrees === 0, d.toleranceDegrees);
    assert('grid3-urban-point: the publisher applies no bbox for this layer', d.extentFiltered === false, d.extentFiltered);
    assert('grid3-urban-point: count agrees with the index (two independent queries)', d.sourceCount === liveCount('grid3-urban-point'), { query: d.sourceCount, index: liveCount('grid3-urban-point') });
    assert('grid3-urban-point: settlements named', d.features.filter((f) => nonEmpty(f.name)).length >= d.returned * 0.9, d.features.filter((f) => !f.name).slice(0, 3));
    assert('grid3-urban-point: the publisher’s coordinate fields survived the whitelist', d.features.every((f) => isNum(f.properties.PNT_LAT) && isNum(f.properties.PNT_LON)), d.features[0]?.properties);
    const mismatched = d.features.filter((f) => Math.abs(f.geometry.latitude - f.properties.PNT_LAT) > 0.002 || Math.abs(f.geometry.longitude - f.properties.PNT_LON) > 0.002);
    assert('grid3-urban-point: plotted point equals the publisher’s own PNT_LAT/PNT_LON', mismatched.length === 0, mismatched.slice(0, 2).map((f) => ({ id: f.sourceId, g: f.geometry, p: f.properties })));
    assert('grid3-urban-point: joined to its built-up extent by the publisher’s id', d.features.every((f) => f.properties.uext_ID !== undefined && f.properties.uext_ID !== null), d.features[0]?.properties);
    assert('grid3-urban-point: every feature is inside Ethiopia', d.features.every((f) => f.centroid.latitude > 3 && f.centroid.latitude < 18 && f.centroid.longitude > 32 && f.centroid.longitude < 49), d.features.find((f) => !(f.centroid.latitude > 3 && f.centroid.latitude < 18)));
    for (const f of [d.features[0], d.features[Math.floor(d.returned / 2)], d.features.at(-1)]) checkFeature(`grid3-urban-point[${f.sourceId}]`, f, 'point');
    assert('grid3-urban-point: attribution names GRID3 as the publisher', /GRID3/i.test(body.provenance.source), body.provenance.source);
    assert('grid3-urban-point: vintage ≠ retrieval (a 2021 snapshot is not today’s data)', body.provenance.observedAt && body.provenance.observedAt.slice(0, 4) !== body.provenance.retrievedAt.slice(0, 4), { observedAt: body.provenance.observedAt, retrievedAt: body.provenance.retrievedAt });
  });

  // A polygon layer small enough to serve whole, where the attributes are the publisher's own
  // fields and the outlines are the thing the map is drawn from.
  await okCase('vector eth-region', '/api/data/geospatial?view=vector&layer=eth-region', (d, body) => {
    checkVectorAccounting('eth-region', d, body.provenance);
    assert('eth-region: eleven top-level areas, complete', d.returned === 11 && d.sourceCount === 11 && d.truncated === false, { returned: d.returned, sourceCount: d.sourceCount, truncated: d.truncated });
    assert('eth-region: the whole published layer, no upstream filter claimed', d.extentFiltered === false, d.extentFiltered);
    const ringMaxima = d.features.map((f) => Math.max(...f.geometry.rings.map((r) => r.length)));
    assert('eth-region: outlines are polygons with real extent', d.features.every((f) => f.geometry.kind === 'polygon' && f.geometry.rings.every((r) => r.length >= 4)), ringMaxima);
    assert('eth-region: detail varies with the shape, as server-side generalisation should', new Set(ringMaxima).size >= 6, ringMaxima);
    assert('eth-region: region name and code carried through', d.features.every((f) => nonEmpty(f.properties.REGIONNAME) && f.properties.RID !== undefined), d.features[0]?.properties);
    assert('eth-region: named from the publisher’s own field', d.features.every((f) => f.name === f.properties.REGIONNAME), d.features.find((f) => f.name !== f.properties.REGIONNAME));
    assert('eth-region: area published in square metres and labelled as such', d.features.every((f) => !isNum(f.properties.Shape__Area) || (f.properties.Shape__Area > 1e4 && f.properties.Shape__Area < 1.5e6 * 1e6)), d.features[0]?.properties.Shape__Area);
    assert('eth-region: count agrees with the index', d.sourceCount === liveCount('eth-region'), { query: d.sourceCount, index: liveCount('eth-region') });
    assert('eth-region: the 2020 vintage is what provenance reports', body.provenance.observedAt === vectorIndex.find((e) => e.id === 'eth-region')?.vintage, { p: body.provenance.observedAt, i: vectorIndex.find((e) => e.id === 'eth-region')?.vintage });
    assert('eth-region: methodology states the generalisation actually used', new RegExp(String(d.toleranceDegrees)).test(body.provenance.methodology), body.provenance.methodology);
    for (const f of [d.features[0], d.features[5], d.features.at(-1)]) checkFeature(`eth-region[${f.sourceId}]`, f, 'polygon');
    const areas = d.features.filter((f) => isNum(f.properties.Shape__Area)).sort((a, b) => b.properties.Shape__Area - a.properties.Shape__Area);
    console.log(`  note  regions by published area (m², as the publisher stores them): ${areas.slice(0, 3).map((f) => `${f.name} ${(f.properties.Shape__Area / 1e6).toFixed(0)} km²`).join(', ')}`);
  });

  // The dense layer: only honest if the bbox genuinely filtered and a limited read admits
  // it is a partial view of a much larger published layer.
  await okCase('vector eth-kebele (extent + limit)', '/api/data/geospatial?view=vector&layer=eth-kebele&bbox=38.6,8.8,39.0,9.2&detail=overview&limit=40', (d, body) => {
    checkVectorAccounting('eth-kebele', d, body.provenance);
    assert('eth-kebele: the publisher filtered the requested extent', d.extentFiltered === true, d.extentFiltered);
    assert('eth-kebele: bbox was quantised onto the cache grid, not forwarded raw', d.bbox.minLongitude === 38.5 && d.bbox.minLatitude === 8.75
      && d.bbox.maxLongitude === 39 && d.bbox.maxLatitude === 9.25, d.bbox);
    assert('eth-kebele: the limit was respected', d.returned <= 40 && d.featureLimit === 40, { returned: d.returned, featureLimit: d.featureLimit });
    assert('eth-kebele: a partial view is labelled partial', d.truncated === true, { truncated: d.truncated, returned: d.returned, sourceCount: d.sourceCount });
    assert('eth-kebele: filtered well below the country count', d.sourceCount < 15670 && d.sourceCount > 0, d.sourceCount);
    assert('eth-kebele: coverage states returned vs published', body.provenance.coverage.includes(`${d.returned} of ${d.sourceCount}`), body.provenance.coverage);
    assert('eth-kebele: everything served really is in the requested box', d.features.every((f) => f.bbox.maxLongitude >= d.bbox.minLongitude - 0.6 && f.bbox.minLongitude <= d.bbox.maxLongitude + 0.6), d.features.find((f) => f.bbox.minLongitude > d.bbox.maxLongitude + 0.6));
    checkFeature('eth-kebele[sample]', d.features[0], 'polygon');
    console.log(`  note  ${d.returned} of ${d.sourceCount} kebele polygons around Addis Ababa at ${d.toleranceDegrees}° (${d.toleranceMeters} m), ${d.vertices} vertices in ${d.pages} page(s) of ${d.pageSize}`);
  });
  // Paging, tested as paging: two requests that differ only by `offset` must return disjoint,
  // ascending records and the same published total — otherwise a 15,670-record layer would
  // silently drop or repeat features.
  {
    const base = '/api/data/geospatial?view=vector&layer=eth-kebele&bbox=38.6,8.8,39.0,9.2&detail=standard&limit=20';
    const first = await get(`${base}&offset=0`);
    const second = await get(`${base}&offset=20`);
    assert('kebele page 1: HTTP 200', first.res.status === 200, { status: first.res.status, error: first.body?.error });
    assert('kebele page 2: HTTP 200', second.res.status === 200, { status: second.res.status, error: second.body?.error });
    const a = first.body?.data;
    const b = second.body?.data;
    if (a && b) {
      // Every overlap/ordering check below is a `.every()` over two arrays, and an empty page
      // satisfies `.every()` trivially — so the pages have to be proven full first or the case
      // would pass by reading nothing.
      assert('kebele page 1: the requested limit really came back', a.returned === 20 && a.features.length === 20, { returned: a.returned });
      assert('kebele page 2: the offset really moved, so it returned its own full page', b.returned === 20 && b.features.length === 20, { returned: b.returned });
      assert('kebele page 2: offset echoed as the caller’s cursor', b.offset === 20 && a.offset === 0, { a: a.offset, b: b.offset });
      assert('kebele page 2: same published total', a.sourceCount === b.sourceCount && a.sourceCount > 0, { a: a.sourceCount, b: b.sourceCount });
      const idsA = new Set(a.features.map((f) => f.sourceId));
      const idsB = b.features.map((f) => f.sourceId);
      assert('kebele page 2: not one record re-served from page 1', idsB.every((id) => !idsA.has(id)), idsB.filter((id) => idsA.has(id)));
      const nums = idsB.map(Number).filter(Number.isFinite);
      const prior = [...idsA].map(Number).filter(Number.isFinite);
      assert('kebele pages: both pages are keyed by numeric publisher ids, so ordering is checkable', nums.length === idsB.length && prior.length === idsA.size, { page1: idsA.size, page2: idsB.length });
      assert('kebele pages: ascending on the publisher’s id field, so offsets are stable', Math.min(...nums) > Math.max(...prior), { page1: [Math.min(...prior), Math.max(...prior)], page2: [Math.min(...nums), Math.max(...nums)] });
      assert('kebele page 2: still labelled a partial view', b.truncated === true, b.truncated);
      assert('kebele page 2: the methodology names the cursor', /starting from the publisher/.test(second.body.provenance.methodology), second.body.provenance.methodology.slice(0, 200));
      console.log(`  note  20 + 20 kebele features over ${a.sourceCount} published for that extent, no overlap.`);
    }
  }

  // Detail levels must change what is drawn, or the toggle is decoration.
  {
    const overview = await get('/api/data/geospatial?view=vector&layer=cde-basin&detail=overview');
    const detailed = await get('/api/data/geospatial?view=vector&layer=cde-basin&detail=detailed');
    assert('detail: overview HTTP 200', overview.res.status === 200, { status: overview.res.status, error: overview.body?.error });
    assert('detail: detailed HTTP 200', detailed.res.status === 200, { status: detailed.res.status, error: detailed.body?.error });
    const o = overview.body?.data;
    const e = detailed.body?.data;
    if (o && e) {
      assert('detail: overview coarsens more than detailed', o.toleranceDegrees > e.toleranceDegrees, { overview: o.toleranceDegrees, detailed: e.toleranceDegrees });
      assert('detail: detailed never falls back to ungeneralised', e.toleranceDegrees >= 0.0005, e.toleranceDegrees);
      assert('detail: finer tolerance draws at least as many vertices', e.vertices >= o.vertices, { overview: o.vertices, detailed: e.vertices });
      assert('detail: the legend gets the ground distance for each', o.toleranceMeters > e.toleranceMeters && e.toleranceMeters > 0, { overview: o.toleranceMeters, detailed: e.toleranceMeters });
      console.log(`  note  12 basins: ${o.vertices} vertices at ${o.toleranceDegrees}° (~${o.toleranceMeters} m) vs ${e.vertices} at ${e.toleranceDegrees}° (~${e.toleranceMeters} m)`);
    }
  }

  // A region-wide publisher: features that fall outside Ethiopia are real records and must be
  // counted and disclosed rather than clipped away.
  await okCase('vector cde-surface-water (region-wide)', '/api/data/geospatial?view=vector&layer=cde-surface-water&detail=overview', (d, body) => {
    checkVectorAccounting('cde-surface-water', d, body.provenance);
    assert('cde-surface-water: outlines carry area', d.features.every((f) => f.geometry.kind === 'polygon'), d.features.find((f) => f.geometry.kind !== 'polygon')?.geometry.kind);
    assert('cde-surface-water: the publisher’s own vintage absence is stated, not invented', body.provenance.observedAt === null && /no date/i.test(d.vintageNote), { observedAt: body.provenance.observedAt, note: d.vintageNote });
    assert('cde-surface-water: attribution names the publisher', nonEmpty(body.provenance.source) && /Centre for Development and Environment|unibe/i.test(body.provenance.sourceUrl + body.provenance.source), body.provenance);
    console.log(`  note  ${d.outsideExtent}/${d.returned} water bodies do not touch the Ethiopia envelope — published region-wide, kept and counted.`);
    checkFeature('cde-surface-water[sample]', d.features[0], 'polygon');
  });

  // The built-up index is the one layer whose attributes are *scores*, and scores come with the
  // publisher's sentinel: -99 means "not scored". The layer's own note quotes the ranges it read,
  // so this checks the note against a fresh country-wide sample instead of letting the UI print -99
  // as though it were a low index value.
  await okCase('vector grid3-built-up-index (scored sample)', '/api/data/geospatial?view=vector&layer=grid3-built-up-index&detail=overview&bbox=32.9,3.3,48.1,15.1&limit=1500', (d, body) => {
    checkVectorAccounting('grid3-built-up-index', d, body.provenance);
    const scores = ['BUILTscore', 'POPscore', 'INDEXvalue'];
    const seen = Object.fromEntries(scores.map((k) => [k, [...new Set(d.features.map((f) => f.properties[k]).filter((v) => Number.isFinite(v)))].sort((a, b) => a - b)]));
    const howMany = d.features.filter((f) => scores.some((k) => f.properties[k] === -99)).length;
    assert('grid3-built-up-index: the -99 in its data is explained as "not scored" in the layer’s own note',
      howMany === 0 || (/-99/.test(d.attributeNotes) && /not scored/i.test(d.attributeNotes)), { seen, howMany, notes: d.attributeNotes });
    const unit = d.features.map((f) => f.properties.UNIT_AREA / 1e6).sort((a, b) => a - b);
    assert('grid3-built-up-index: BUILT_PROP really is the built share of the unit', d.features.every((f) => Math.abs(f.properties.BUILT_AREA / f.properties.UNIT_AREA - f.properties.BUILT_PROP) < 1e-6), d.features.find((f) => Math.abs(f.properties.BUILT_AREA / f.properties.UNIT_AREA - f.properties.BUILT_PROP) >= 1e-6)?.properties);
    console.log(`  note  ${d.returned} units read: UNIT_AREA ${unit[0].toFixed(3)}–${unit[unit.length - 1].toFixed(3)} km² (median ${unit[unit.length >> 1].toFixed(3)}), `
      + `${scores.map((k) => `${k} ${seen[k][0]}…${seen[k][seen[k].length - 1]}`).join(', ')} — ${howMany} carry the -99 not-scored sentinel`);
  });

  // Every registered layer, read once through the route, so this log records what each
  // publisher actually answers today — not only the four layers dissected above.
  section('all twelve vector layers, one live read each');
  {
    const dense = new Set(['eth-kebele', 'cde-watershed', 'grid3-built-up-index']);
    for (const entry of vectorIndex) {
      const q = `/api/data/geospatial?view=vector&layer=${entry.id}&detail=overview`
        + (dense.has(entry.id) ? '&bbox=38.6,8.8,39.0,9.2&limit=120' : '');
      const { res, body } = await get(q);
      if (!assert(`${entry.id}: the publisher answered`, res.status === 200, { status: res.status, error: body?.error })) {
        console.log(`        ${entry.id} — ${body?.error?.code}: ${body?.error?.message}`);
        continue;
      }
      checkProvenance(entry.id, body.provenance);
      const d = body.data;
      checkVectorAccounting(entry.id, d, body.provenance);
      checkFeature(`${entry.id}[${d.features[0]?.sourceId}]`, d.features[0], d.geometryKind);
      const attrKeys = Object.keys(d.features[0]?.properties ?? {});
      assert(`${entry.id}: the whitelisted attribute fields arrived`, attrKeys.length > 0, d.features[0]?.properties);
      assert(`${entry.id}: it is the layer the index advertised`, d.layerId === entry.id && d.geometryKind === entry.geometryKind && d.extentFiltered === entry.needsBbox,
        { served: [d.layerId, d.geometryKind, d.extentFiltered], index: [entry.id, entry.geometryKind, entry.needsBbox] });
      if (entry.liveCount !== null) {
        assert(`${entry.id}: the count agrees with the index’s own measurement`, entry.needsBbox
          ? d.sourceCount < entry.liveCount
          : d.sourceCount === entry.liveCount, { query: d.sourceCount, index: entry.liveCount, needsBbox: entry.needsBbox });
      }
      assert(`${entry.id}: at least one feature really is in Ethiopia`, d.returned - d.outsideExtent > 0, { returned: d.returned, outsideExtent: d.outsideExtent });
      const g = d.features[0].geometry;
      // Several layer descriptions quote their own feature count in prose ("93 dam locations",
      // "54,446 small polygons"). That sentence is a claim about the publisher, so it has to
      // stay true — a number the UI shows that the source no longer backs is exactly the kind
      // of drift this script exists to catch.
      const quoted = entry.meaning.match(/\b(\d{1,3}(?:,\d{3})+|\d{2,6})\b/);
      if (quoted && entry.liveCount !== null) {
        assert(`${entry.id}: the count its own description quotes is still what the publisher has`, Number(quoted[1].replace(/,/g, '')) === entry.liveCount, { quoted: quoted[1], live: entry.liveCount });
      }
      console.log(`  ok    ${entry.id.padEnd(21)} ${String(d.returned).padStart(5)}/${String(d.sourceCount).padStart(6)} feats  ${String(d.vertices).padStart(6)} verts  `
        + `${String(d.toleranceDegrees).padEnd(7)}° ${d.pages} page(s)  ${g.kind}@${g.kind === 'point' ? `${g.longitude},${g.latitude}` : `${d.features[0].centroid.latitude.toFixed(4)},${d.features[0].centroid.longitude.toFixed(4)}`}`);
      console.log(`        ${entry.id} attrs: ${JSON.stringify(d.features[0].properties).slice(0, 168)}`);
      console.log(`        ${entry.id} vintage ${body.provenance.observedAt ?? 'none stated by the publisher'} · retrieved ${body.provenance.retrievedAt}`);
    }
  }

  await errCase('vector without a layer', '/api/data/geospatial?view=vector', 400, 'bad_input');
  await errCase('vector unknown layer', '/api/data/geospatial?view=vector&layer=not-a-layer', 400, 'bad_input');
  await errCase('vector bad detail', '/api/data/geospatial?view=vector&layer=eth-region&detail=fullres', 400, 'bad_input');
  await errCase('vector bbox that misses Ethiopia', '/api/data/geospatial?view=vector&layer=eth-kebele&bbox=2.1,48.8,2.4,49.0', 400, 'bad_input');
  await errCase('vector bbox with three numbers', '/api/data/geospatial?view=vector&layer=eth-kebele&bbox=38.6,8.8,39.0', 400, 'bad_input');
  await errCase('vector bbox inverted', '/api/data/geospatial?view=vector&layer=eth-kebele&bbox=39.0,9.2,38.6,8.8', 400, 'bad_input');
  await errCase('vector bbox out of coordinate range', '/api/data/geospatial?view=vector&layer=eth-kebele&bbox=999,8.8,39.0,9.2', 400, 'bad_input');

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
    assert('sync GET: lists the five live tasks plus the gated one', Array.isArray(body?.data?.tasks) && body.data.tasks.join(',') === 'locations,market-prices,climate,exchange,satellite,geo-vectors', body?.data?.tasks);
    assert('sync GET: names the table a gated task is waiting on', Array.isArray(body?.data?.gated) && body.data.gated.every((g) => typeof g.task === 'string' && /^data\.[a-z_]+$/.test(g.requiresTable)), body?.data?.gated);
    assert('sync GET: every gated task is also a listed task', (body?.data?.gated ?? []).every((g) => body?.data?.tasks?.includes(g.task)), { gated: body?.data?.gated, tasks: body?.data?.tasks });
    assert('sync GET: says whether it is configured', typeof body?.data?.configured === 'boolean', body?.data?.configured);
    // An allowlist, not a keyword scan: the honest field is named `lease_key`, and what must
    // never appear is a value that could be used.
    assert('sync GET: exposes only these fields', Object.keys(body?.data ?? {}).sort().join(',') === 'configured,gated,lease_key,method,tasks', Object.keys(body?.data ?? {}));
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
      '/api/data/geospatial?view=vectors',
      '/api/data/geospatial?view=vector&layer=eth-region',
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
