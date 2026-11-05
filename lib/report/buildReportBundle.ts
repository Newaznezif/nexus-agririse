import { findLatestLayerDate, getLayer, sampleLayerAtCoordinate } from '@/lib/data/gibs';
import type {
  AgroclimateDailyPoint,
  ConnectorResult,
  DailyWeatherPoint,
  LocationRef,
  MarketPriceObservation,
  MarketSnapshot,
  MonthlyNormal,
  PriceChange,
  Provenance,
  SourceError,
  ValueKind,
} from '@/lib/data/types';
import { getUsdRateSeries } from '@/lib/data/nbeExchange';
import { nonAnswerProvenance } from '@/lib/data/sources';
import { getWeatherForecast } from '@/lib/data/openMeteo';
import { computeRainfallAnomaly, getAgroclimateDaily, getAgroclimateNormals } from '@/lib/data/nasaPower';
import { getBenchmarkIndicators, getUnofficialRateSeries, WB_BENCHMARKS } from '@/lib/data/worldBank';
import { getCommodityHistory, getGrainOverview, getMarketSnapshot } from '@/lib/data/wfpMarketPrices';
import { resolveScope } from './scope';
import type {
  ChartSeries,
  DerivedFigure,
  ReportAttribution,
  ReportBundle,
  ReportChart,
  ReportColumn,
  ReportEvidence,
  ReportRequest,
  ReportScope,
  ReportSection,
  ReportSectionId,
  ReportTable,
  ReportWarning,
  SectionStatus,
  SourceRegisterEntry,
  SpatialBasis,
} from './types';

/**
 * Assembles the evidence a report page is allowed to print. Server-side only: it calls the same
 * connectors `/api/data/*` exposes, directly, so a report and the dashboard can never disagree
 * about a number, and no HTTP loop-back or duplicated fetch layer is involved.
 *
 * The one job of this file is that no figure reaches a page without the publisher's own
 * provenance attached, and that an absent figure stays absent. `services/pdfExport.ts` used to
 * draw a histogram from the string `trend` and a pie from the string `risk_level`; every chart
 * built here comes from rows a source actually returned, and a section with nothing honest to
 * plot says so instead of plotting one.
 */

export type ReportBuildResult = { ok: true; bundle: ReportBundle } | { ok: false; error: SourceError };

type Cell = string | number | boolean | null;
type Row = Record<string, Cell>;

interface SectionContent {
  tables?: ReportTable[];
  charts?: ReportChart[];
  derived?: DerivedFigure[];
  caveats?: string[];
}

/** Layers a report may reproduce. Boundary and hydrology services are excluded on licensing grounds. */
const REPORT_LAYERS = ['VIIRS_SNPP_NDVI_8Day', 'MODIS_Terra_NDVI_8Day', 'IMERG_Precipitation_Rate'] as const;
/** A MODIS/VIIRS composite covers eight days, so the series steps back one composite at a time. */
const COMPOSITE_STEP_DAYS = 8;
/** Two points make a line segment, not a trend; anything thinner than this stays unplotted. */
const MIN_TREND_POINTS = 3;

export async function buildReportBundle(req: ReportRequest): Promise<ReportBuildResult> {
  const resolved = await resolveScope(req);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const scope = resolved.scope;

  const months = Math.max(2, Math.min(24, req.months ?? 6));
  const composites = Math.max(1, Math.min(12, req.composites ?? 5));
  const demo = req.mode === 'demo';

  // Independent publishers, so one slow source cannot serialise the whole report.
  const [climate, geospatial, market, economy] = await Promise.all([
    buildClimateSection(scope, req),
    buildGeospatialSection(scope, composites),
    buildMarketSection(scope, req, months),
    buildEconomySection(scope),
  ]);

  const sections = [climate, geospatial, market, economy];
  return {
    ok: true,
    bundle: {
      meta: {
        reference: newReference(),
        generatedAt: new Date().toISOString(),
        mode: demo ? 'demo' : 'production',
        demoNotice: demo
          ? 'DEMO REPORT — assembled from the demonstration workspace. The figures below are real published values retrieved at the times stated in the source register, but this report was produced from demo records and must not be presented as production intelligence.'
          : null,
        scope,
        attribution: attributionFor(req),
        warnings: collectWarnings(scope, demo, sections),
        sourceRegister: registerFor(sections),
        coverage: Object.fromEntries(sections.map((s) => [s.id, s.status])) as Record<ReportSectionId, SectionStatus>,
      },
      sections,
      // Interpretation is Phase 4's to fill. Left empty here so the factual sections are proven
      // to stand on their own before any model is allowed to speak.
      findings: [],
    },
  };
}

/* ------------------------------------------------------------------ *
 * Climate
 * ------------------------------------------------------------------ */

async function buildClimateSection(scope: ReportScope, req: ReportRequest): Promise<ReportSection> {
  const location = scope.location;
  if (!location) {
    return unavailableSection('climate', 'Climate and weather', scope, 'Weather is a point product and this report is national. Choose a market or a region to have conditions read at a stated place.');
  }

  const forecast = withRows(
    await getWeatherForecast({
      location,
      forecastDays: req.forecastDays ?? 7,
      pastDays: req.pastDays ?? 14,
      includeHourly: false,
    }),
    (series) => series.daily.length === 0,
    `Open-Meteo returned no daily rows for ${describeLocation(scope)}.`,
  );
  const forecastEvidence = evidenceFrom('climate.open-meteo', 'climate', forecast, (series) => {
    const daily = series.daily;
    const observed = daily.filter((d) => !d.isForecast);
    const predicted = daily.filter((d) => d.isForecast);
    const boundary = observed.length > 0 && predicted.length > 0
      ? ` — observed to ${observed[observed.length - 1].date}, forecast from ${predicted[0].date}`
      : predicted.length > 0 ? ' — model forecast' : ' — model reanalysis of past days';

    return {
      tables: [
        table('climate.current', `Current conditions at ${series.location.name}`, [
          { key: 'observedAt', label: 'Published at', units: null },
          { key: 'temperatureC', label: 'Temperature', units: '°C' },
          { key: 'relativeHumidityPct', label: 'Relative humidity', units: '%' },
          { key: 'precipitationMm', label: 'Precipitation', units: 'mm' },
          { key: 'windSpeedKmh', label: 'Wind', units: 'km/h' },
          { key: 'weatherCode', label: 'Condition code', units: 'WMO code' },
        ], series.current ? [currentRow(series.current)] : [], forecast.provenance, 1),
        table('climate.daily', `Daily weather${boundary}`, dailyColumns(), daily.map(dailyRow), forecast.provenance, 31),
      ],
      charts: [
        twoSeriesChart('climate.precipitation', `Daily precipitation${boundary}`, 'mm per day', forecast.provenance, scope.spatial,
          observed.length > 0 ? { label: 'Observed days', points: observed.map((d) => ({ x: d.date, y: d.precipitationSumMm })) } : null,
          predicted.length > 0 ? { label: 'Forecast days', points: predicted.map((d) => ({ x: d.date, y: d.precipitationSumMm })) } : null,
          'A forecast day has not been observed; the two spans are never merged into one series.'),
        lineChart('climate.temperature', `Daily temperature${boundary}`, '°C', forecast.provenance, scope.spatial, [
          { label: 'Maximum', points: daily.map((d) => ({ x: d.date, y: d.temperatureMaxC })) },
          { label: 'Minimum', points: daily.map((d) => ({ x: d.date, y: d.temperatureMinC })) },
        ], 'Grid-cell model output for this coordinate, not a station reading.'),
      ],
      caveats: [
        `Elevation ${series.elevationM ?? 'unknown'} m, timezone ${series.timezone}: the grid cell resolved for ${series.location.latitude.toFixed(4)}, ${series.location.longitude.toFixed(4)}.`,
        'The Basis column and the series labels are the publisher’s own observed/forecast split, carried per row.',
      ],
    };
  });

  // POWER's daily product is complete a few days behind, so the window ends yesterday.
  const end = shiftUtcDate(new Date(), -1);
  const start = shiftUtcDate(end, -89);
  const compact = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
  const periodLabel = `${start.toISOString().slice(0, 10)} → ${end.toISOString().slice(0, 10)}`;

  const daily = withRows(
    await getAgroclimateDaily({ location, start: compact(start), end: compact(end) }),
    (series) => series.daily.length === 0,
    `NASA POWER returned no daily rows for ${describeLocation(scope)} over ${periodLabel}.`,
  );
  const normals = withRows(
    await getAgroclimateNormals(location),
    (data) => data.normals.length === 0,
    `NASA POWER published no climatology normals for the ${describeLocation(scope)} grid cell.`,
  );

  const powerEvidence = evidenceFrom('climate.power', 'climate', daily, (series) => {
    const anomaly: DerivedFigure | null = normals.ok
      ? anomalyFigure(series.daily, normals.data.normals, daily.provenance, periodLabel, scope)
      : null;
    return {
      tables: [
        table('climate.agroclimate', `Agroclimatology, 90 days to ${end.toISOString().slice(0, 10)}`, agroColumns(), series.daily.map(agroRow), daily.provenance, 45),
      ],
      charts: [
        lineChart('climate.agroclimate.precipitation', 'Daily rainfall (POWER PRECTOTCORR)', 'mm per day', daily.provenance, scope.spatial,
          [{ label: 'Rainfall', points: series.daily.map((d) => ({ x: d.date, y: d.precipitationMm })) }],
          'A modelled reanalysis product, not a rain gauge.'),
      ],
      derived: anomaly ? [anomaly] : [],
      caveats: anomaly ? [] : [`Rainfall anomaly omitted: no climatology normals available for this cell (${normals.ok ? 'unexpected' : normals.error.message}).`],
    };
  });

  const normalsEvidence = evidenceFrom('climate.normals', 'climate', normals, (data) => ({
    tables: [
      table('climate.normals.monthly', 'Climatology normals for this grid cell', [
        { key: 'month', label: 'Month', units: null },
        { key: 'parameter', label: 'Parameter', units: null },
        { key: 'value', label: 'Normal', units: null },
        { key: 'units', label: 'Units', units: null },
      ], data.normals.map(normalRow), normals.provenance, 36),
    ],
    caveats: ['Long-run monthly normals. They describe the climate of this cell, not this year.'],
  }));

  return section('climate', 'Climate and weather', scope, [forecastEvidence, powerEvidence, normalsEvidence], [scopeNote(scope)]);
}

function anomalyFigure(
  daily: AgroclimateDailyPoint[],
  normals: MonthlyNormal[],
  provenance: Provenance,
  periodLabel: string,
  scope: ReportScope,
): DerivedFigure {
  const anomaly = computeRainfallAnomaly(daily, normals, periodLabel);
  return {
    evidenceId: 'climate.rainfall-anomaly',
    label: anomaly.sufficientCoverage
      ? `Rainfall over ${periodLabel}, against normals for the same grid cell`
      : `Rainfall over ${periodLabel} — only ${anomaly.daysWithData} of ${anomaly.daysRequested} days carried data, so this is not a season total`,
    // An uncomputable percentage stays null rather than becoming "normal".
    value: anomaly.anomalyPct,
    units: '% deviation from the normal sum',
    formula: `(Σ daily PRECTOTCORR over the window − Σ(monthly PRECTOTCORR normal × days of that month covered)) ÷ Σ(monthly normal × days covered) × 100. Computed by this application from NASA POWER values for ${describeLocation(scope)}; no publisher releases this figure.`,
    inputs: ['climate.agroclimate', 'climate.normals.monthly'],
    valueKind: 'estimated',
    quality: anomaly.sufficientCoverage ? 'medium' : 'low',
    provenance,
  };
}

/* ------------------------------------------------------------------ *
 * Geospatial
 * ------------------------------------------------------------------ */

async function buildGeospatialSection(scope: ReportScope, composites: number): Promise<ReportSection> {
  const location = scope.location;
  if (!location) {
    return unavailableSection('geospatial', 'Satellite and landscape', scope, 'A satellite reading needs a coordinate. A national report has no single pixel to read, and averaging a country would describe no field in it.');
  }

  const evidence: ReportEvidence[] = [];
  for (const layerId of REPORT_LAYERS) {
    evidence.push(await geospatialEvidence(scope, layerId, location, composites));
  }

  return section('geospatial', 'Satellite and landscape', scope, evidence, [
    // Decision recorded in the contract rather than in prose elsewhere: imagery may be embedded,
    // the boundary and hydrology services may not be reproduced until their publishers state terms.
    'Only NASA GIBS composites are reproduced in this report. Administrative-boundary and hydrology map services are deliberately excluded: their publishers require attribution but have not established redistribution terms. Where their geometry matters it is named in text, not drawn.',
    'Every value below is one pixel of one composite at one coordinate. No regional or national average is computed, and a greenness reading is not a yield estimate.',
    scopeNote(scope),
  ]);
}

async function geospatialEvidence(scope: ReportScope, layerId: string, location: LocationRef, composites: number): Promise<ReportEvidence> {
  const id = `geospatial.${layerId}`;
  const latest = await sampleLayerAtCoordinate({ layerId, latitude: location.latitude, longitude: location.longitude });
  if (!latest.ok) return evidenceOf(id, 'geospatial', { provenance: latest.provenance, error: latest.error });

  const layer = getLayer(layerId);
  if (!layer) {
    return evidenceOf(id, 'geospatial', { provenance: latest.provenance, error: { code: 'not_configured', message: `Layer ${layerId} is not in the publisher catalogue` } });
  }

  const isNdvi = layerId.toLowerCase().includes('ndvi');
  const points: { x: string; y: number | null }[] = [];
  let scenesRead = 0;

  if (isNdvi) {
    const found = await findLatestLayerDate(layer);
    if (found.ok) {
      const samples = await Promise.all(
        compositeDates(found.data, composites).map((date) => sampleLayerAtCoordinate({ layerId, latitude: location.latitude, longitude: location.longitude, date })),
      );
      for (const s of samples) {
        if (!s.ok) continue;
        scenesRead += 1;
        points.push({ x: s.data.tileDate, y: s.data.value });
      }
      points.sort((a, b) => a.x.localeCompare(b.x));
    }
  }

  return evidenceOf(id, 'geospatial', { provenance: latest.provenance, error: null }, {
    tables: [
      table(`${id}.sample`, layer.title, [
        { key: 'tileDate', label: 'Composite dated', units: null },
        { key: 'value', label: 'Value', units: layer.units },
        { key: 'band', label: 'Published value band', units: null },
        { key: 'pixelSizeMeters', label: 'Pixel footprint', units: 'm' },
        { key: 'quality', label: 'Quality', units: null },
      ], [sampleRow(latest.data)], latest.provenance, 1),
    ],
    charts: isNdvi
      ? points.length >= MIN_TREND_POINTS
        ? [{
            evidenceId: `${id}.series`,
            title: `${layer.title} — ${points.length} composites at one pixel`,
            units: layer.units,
            valueKind: layer.valueKind,
            spatial: 'single-pixel',
            series: [{ label: 'Band midpoint of the published colour map', points }],
            unavailableReason: null,
            provenance: latest.provenance,
          }]
        : [emptyChart(`${id}.series`, `${layer.title} over recent composites`, layer.units, layer.valueKind, 'single-pixel',
            `Only ${scenesRead} of ${composites} composites could be read for this pixel, and a trend needs ${MIN_TREND_POINTS}. A line through fewer points would be a connection drawn between guesses.`,
            latest.provenance)]
      : [],
    caveats: [
      layer.caveat,
      `Coverage exactly as the source states it: ${latest.provenance.coverage}.`,
      `Each point is the band midpoint of the publisher’s colour map for that composite — an interval, not a continuous reading. Scenes are separate composites, not one instrument record.`,
      ...(latest.data.value === null ? ['This pixel is nodata or fill in the newest composite, so no value is reported for it.'] : []),
    ],
  });
}

/** Composite end-dates, newest first, stepping one 8-day window at a time. */
function compositeDates(latest: string, count: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push(shiftUtcDate(new Date(`${latest}T00:00:00Z`), -i * COMPOSITE_STEP_DAYS).toISOString().slice(0, 10));
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Market prices
 * ------------------------------------------------------------------ */

async function buildMarketSection(scope: ReportScope, req: ReportRequest, months: number): Promise<ReportSection> {
  if (scope.kind === 'coordinate') {
    return unavailableSection('market', 'Market prices', scope, 'WFP surveys named markets, not coordinates. No price row can honestly be attributed to a point between markets, and substituting a distant town or a national average would misstate the price this plot faces.');
  }

  const priceFilter: { market?: string | null; region?: string | null } =
    scope.kind === 'market' ? { market: scope.place } : scope.kind === 'region' ? { region: scope.region } : {};

  // A snapshot is the newest survey month only. When the publisher did not survey this market in
  // that month, `rows` comes back empty while the source itself is healthy — which would print a
  // heading over a blank table. The empty answer is an error about this scope, so it is turned
  // back into one, naming the month the survey actually reached.
  const snapshotRaw = await getMarketSnapshot({ ...priceFilter, months, limit: 500 });
  const snapshot: ConnectorResult<MarketSnapshot> = snapshotRaw.ok && snapshotRaw.data.rows.length === 0
    ? {
      ok: false,
      error: {
        code: 'no_data',
        message: `WFP surveyed no row at ${describeScope(scope)} for ${snapshotRaw.data.asOfLatestObservation}, the newest survey month this dataset holds. Widen the window or name a market the survey reached in that month; a price from another month or another market is not substituted for it.`,
      },
      provenance: snapshotRaw.provenance,
    }
    : snapshotRaw;
  const overview = scope.kind === 'national'
    ? withRows(
      await getGrainOverview(),
      (data) => data.commodities.length === 0,
      'The grain overview came back with no commodity rows.',
    )
    : null;
  const commodity = req.commodity ?? (snapshot.ok ? mostSurveyedCommodity(snapshot.data.rows) : null);
  const history = commodity ? await getCommodityHistory({ ...priceFilter, commodity, months: Math.max(2, Math.min(36, months * 6)) }) : null;

  const evidence: ReportEvidence[] = [
    evidenceFrom('market.snapshot', 'market', snapshot, (data) => {
      const changes = data.changes.filter((c) => c.changePct !== null);
      return {
        tables: [
          table('market.rows', `Latest survey month (${data.asOfLatestObservation}), prices as published`, priceColumns(), data.rows.map(priceRow), snapshot.provenance, 25),
          // A movement table with no rows would read as "prices held steady", which is a claim
          // the survey did not make. The bar chart below already carries the reason as a gap.
          ...(changes.length > 0
            ? [table('market.changes', 'Month-on-month movement, largest first', changeColumns(), changes.slice(0, 20).map(changeRow), snapshot.provenance, 20)]
            : []),
        ],
        charts: [
          barChart('market.changes.bar', 'Largest month-on-month price movements', '% change between two published survey prices', snapshot.provenance, scope.spatial,
            changes.slice(0, 8).map((c) => ({ x: `${c.market} · ${c.commodity} (${c.unit})`, y: c.changePct })),
            'Only pairs where the publisher surveyed the same market, commodity and unit in two consecutive months are compared.'),
        ],
        caveats: [
          `${data.markets} markets and ${data.commodities} commodities answered for the newest survey month at this scope.`,
          'Units are the publisher’s own (100 KG, KG, Head, L, Unit) and are never converted here; a 100 KG wholesale quote is not comparable to a KG retail quote.',
          'The change column is computed by this application from two published prices; the prices themselves are the publisher’s.',
          ...(changes.length === 0 ? ['No commodity was surveyed at the same market, unit and price type in two consecutive months at this scope, so no movement figure is printed.'] : []),
        ],
      };
    }),
  ];

  if (overview) {
    evidence.push(evidenceFrom('market.overview', 'market', overview, (data) => ({
      tables: [
        table('market.overview.national', `National retail averages, ${data.asOf}`, [
          { key: 'commodity', label: 'Commodity', units: null },
          { key: 'unit', label: 'Unit', units: null },
          { key: 'avgEtbPerUnit', label: 'Mean retail price', units: 'ETB' },
          { key: 'markets', label: 'Markets averaged', units: null },
        ], data.commodities.map((c) => ({ commodity: c.commodity, unit: c.unit, avgEtbPerUnit: c.avgEtbPerUnit, markets: c.markets })), overview.provenance, 20),
      ],
      caveats: ['A mean across surveyed markets, weighted by nothing but the row count. It is not the price at any single market and must not be printed as one.'],
    })));
  }

  if (history) {
    const hist = history;
    evidence.push(evidenceFrom('market.history', 'market', hist, (data) => {
      const grouped = priceSeries(data.series);
      const usable = grouped.series.filter((s) => s.points.some((p) => p.y !== null));
      return {
        tables: [
          table('market.history.rows', `${commodity} survey rows at this scope`, priceColumns(), data.series.map(priceRow), hist.provenance, 24),
        ],
        charts: usable.length === 0
          ? [emptyChart('market.history.series', `${commodity} price history`, 'ETB per published unit', 'observed', scope.spatial,
            `The survey holds ${data.series.length} row(s) for ${commodity} at this scope and none carries an actual price. No line is drawn.`, hist.provenance)]
          : [{
              evidenceId: 'market.history.series',
              title: `${commodity} at ${describeScope(scope)}${grouped.omittedGroups > 0 ? `, ${grouped.omittedGroups} further series not drawn` : ''}`,
              units: 'ETB per published unit — one series per market · unit · price type',
              valueKind: 'observed',
              spatial: scope.spatial,
              series: usable,
              unavailableReason: null,
              provenance: hist.provenance,
            }],
        caveats: [
          req.commodity ? `Commodity series requested: ${commodity}.` : `${commodity} was selected as the commodity with the most actual priced rows at this scope, because the request named none.`,
          // The publisher surveys a market when it surveys a market: this series runs as long as
          // the survey's own coverage does, which is rarely the window the price table used.
          `The series spans ${data.series[0]?.observedOn ?? '—'} to ${data.series.at(-1)?.observedOn ?? '—'} — the survey’s own coverage of ${commodity} at this scope, which is not the ${months}-month window the latest-price table uses.`,
          'Series are never averaged together, and rows the publisher flagged as aggregate or replaced are excluded rather than mixed into an actual price series.',
          ...(grouped.omittedGroups > 0 ? [`Only the ${usable.length} best-covered series are drawn; ${grouped.omittedGroups} more exist in the survey.`] : []),
        ],
      };
    }));
  }

  return section('market', 'Market prices', scope, evidence, [
    `Scope: ${describeScope(scope)}${scope.kind === 'region' ? ' — every market the survey publishes inside this region, and nothing outside it.' : ''}`,
    'These are WFP retail and wholesale survey observations in Ethiopian markets. No international benchmark, futures price or modelled forecast appears in this section.',
    scopeNote(scope),
  ]);
}

/** The commodity with the most actual, priced rows — a selection from data, not a preference. */
function mostSurveyedCommodity(rows: MarketPriceObservation[]): string | null {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (r.price === null || r.priceFlag !== 'actual') continue;
    counts.set(r.commodity, (counts.get(r.commodity) ?? 0) + 1);
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  return best?.[0] ?? null;
}

/**
 * Publisher rows grouped exactly as they may be compared: one line is one market, one unit and
 * one price type. Averaging across markets would invent a price nobody quoted.
 */
function priceSeries(rows: MarketPriceObservation[]): { series: ChartSeries[]; omittedGroups: number } {
  const groups = new Map<string, { x: string; y: number | null }[]>();
  for (const r of rows.filter((row) => row.priceFlag === 'actual')) {
    const key = `${r.market} · ${r.unit} · ${r.retail}`;
    const bucket = groups.get(key) ?? [];
    bucket.push({ x: r.observedOn, y: r.price });
    groups.set(key, bucket);
  }
  const sorted = [...groups.entries()]
    .map(([label, points]) => ({ label, points: points.sort((a, b) => a.x.localeCompare(b.x)) }))
    .sort((a, b) => b.points.length - a.points.length);
  return { series: sorted.slice(0, 4), omittedGroups: Math.max(0, sorted.length - 4) };
}

/* ------------------------------------------------------------------ *
 * Economic context
 * ------------------------------------------------------------------ */

async function buildEconomySection(scope: ReportScope): Promise<ReportSection> {
  const [nbe, parallel, indicatorSet] = await Promise.all([
    getUsdRateSeries({ wanted: 6, maxDaysBack: 12 }),
    getUnofficialRateSeries(18),
    getBenchmarkIndicators(WB_BENCHMARKS.map((b) => b.code)),
  ]);
  const official = withRows(nbe, (points) => points.length === 0, 'The National Bank published no indicative rate inside the dates searched.');
  const unofficial = withRows(parallel, (data) => data.series.length === 0, 'The World Bank parallel-market series came back with no months.');
  const benchmarks = withRows(indicatorSet, (data) => data.indicators.length === 0, 'No World Bank indicator series answered for Ethiopia.');

  const evidence = [
    evidenceFrom('economy.nbe', 'economy', official, (points) => ({
      tables: [
        table('economy.official', 'Official USD/ETB indicative rate', [
          { key: 'observedOn', label: 'Published', units: null },
          { key: 'usdToEtb', label: 'ETB per USD', units: 'ETB' },
        ], points.map((p) => ({ observedOn: p.observedOn, usdToEtb: p.usdToEtb })), official.provenance, 12),
      ],
      charts: [
        lineChart('economy.official.series', 'Official USD/ETB, most recent publications', 'ETB per USD', official.provenance, 'national-survey',
          [{ label: 'ETB per USD (NBE indicative)', points: points.map((p) => ({ x: p.observedOn, y: p.usdToEtb })) }],
          'The indicative rate is the auction reference, not a rate a bureau quotes on the street.'),
      ],
    })),
    evidenceFrom('economy.unofficial', 'economy', unofficial, (data) => ({
      tables: [
        table('economy.unofficial.monthly', 'Parallel-market USD/ETB, monthly', [
          { key: 'observedOn', label: 'Month', units: null },
          { key: 'unofficialUsdToEtb', label: 'ETB per USD', units: 'ETB' },
        ], data.series.map((p) => ({ observedOn: p.observedOn, unofficialUsdToEtb: p.unofficialUsdToEtb })), unofficial.provenance, 18),
      ],
      charts: [
        lineChart('economy.unofficial.series', 'Parallel-market USD/ETB', 'ETB per USD', unofficial.provenance, 'national-survey',
          [{ label: 'ETB per USD (World Bank survey)', points: data.series.map((p) => ({ x: p.observedOn, y: p.unofficialUsdToEtb })) }],
          'A monthly survey of parallel-market transactions in Ethiopia, collected by the World Bank.'),
      ],
      caveats: ['Shown separately from the official rate on purpose. The two are different measurements and are never combined into one series or one spread figure here.'],
    })),
    evidenceFrom('economy.benchmarks', 'economy', benchmarks, (data) => ({
      tables: [
        table('economy.benchmarks.latest', 'Ethiopia benchmark indicators (annual)', [
          { key: 'code', label: 'Code', units: null },
          { key: 'name', label: 'Description', units: null },
          { key: 'unit', label: 'Units', units: null },
          { key: 'frequency', label: 'Frequency', units: null },
          { key: 'latestPeriod', label: 'Latest period', units: null },
          { key: 'latestValue', label: 'Latest value', units: null },
        ], data.indicators.map((i) => {
          const last = [...i.observations].reverse().find((o) => o.value !== null) ?? null;
          return { code: i.code, name: i.name, unit: i.unit, frequency: i.frequency, latestPeriod: last?.period ?? null, latestValue: last?.value ?? null };
        }), benchmarks.provenance, 12),
      ],
      caveats: ['Annual national accounts. They are context for a season, never a current reading — the newest year a publisher closes is typically one or two before this report.'],
    })),
  ];

  return section('economy', 'Economic context', scope, evidence, [
    'Exchange rates and national indicators are country-level by nature. They are context for a price at any Ethiopian market, and are not presented as specific to the scope of this report.',
    scopeNote(scope),
  ]);
}

/* ------------------------------------------------------------------ *
 * Shared builders
 * ------------------------------------------------------------------ */

function evidenceFrom<T>(
  evidenceId: string,
  sectionId: ReportSectionId,
  result: ConnectorResult<T>,
  make: (data: T) => SectionContent,
): ReportEvidence {
  if (!result.ok) return evidenceOf(evidenceId, sectionId, { provenance: result.provenance, error: result.error });
  return evidenceOf(evidenceId, sectionId, { provenance: result.provenance, error: null }, make(result.data));
}

/**
 * A publisher that answers with nothing is a gap, not a table. Printed as an empty grid — or as
 * a section with no failures — an absent row reads as "nothing to report", which is a claim about
 * the data rather than about the source. This turns the empty answer back into the error it is,
 * with the scope named, so the section degrades to `partial` and the register says so.
 */
function withRows<T>(result: ConnectorResult<T>, isEmpty: (data: T) => boolean, message: string): ConnectorResult<T> {
  if (result.ok && isEmpty(result.data)) {
    return { ok: false, error: { code: 'no_data', message }, provenance: result.provenance };
  }
  return result;
}

function evidenceOf(
  evidenceId: string,
  sectionId: ReportSectionId,
  source: { provenance: Provenance; error: SourceError | null },
  content: SectionContent = {},
): ReportEvidence {
  // Stripped here rather than at each reader: this is the one place a connector outcome becomes
  // report evidence, so a refused publisher cannot leave a fetch time behind for the register,
  // the Sources page, the prompt or the client to quote.
  const provenance = source.error ? nonAnswerProvenance(source.provenance, source.error) : source.provenance;
  return {
    evidenceId,
    section: sectionId,
    provider: provenance.source,
    provenance,
    error: source.error,
    tables: source.error ? [] : content.tables ?? [],
    // A failed source contributes no chart or figure: the section says what did not answer instead.
    charts: source.error ? [] : content.charts ?? [],
    derived: source.error ? [] : content.derived ?? [],
    caveats: content.caveats ?? [],
  };
}

function table(
  evidenceId: string,
  title: string,
  columns: ReportColumn[],
  rows: Row[],
  provenance: Provenance,
  cap: number,
): ReportTable {
  const shown = rows.slice(0, cap);
  return {
    evidenceId,
    title,
    columns,
    rows: shown,
    rowsOmitted: rows.length - shown.length,
    omissionNote: rows.length > shown.length ? `Showing ${shown.length} of ${rows.length} published rows.` : null,
    provenance,
  };
}

function lineChart(
  evidenceId: string,
  title: string,
  units: string,
  provenance: Provenance,
  spatial: SpatialBasis,
  series: ChartSeries[],
  note: string,
): ReportChart {
  const populated = series.filter((s) => s.points.some((p) => p.y !== null));
  if (populated.length === 0) {
    return emptyChart(evidenceId, title, units, provenance.valueKind, spatial, `The source answered, but every value in this window is blank. ${note}`, provenance);
  }
  return { evidenceId, title, units, valueKind: provenance.valueKind, spatial, series: populated, unavailableReason: null, provenance };
}

function twoSeriesChart(
  evidenceId: string,
  title: string,
  units: string,
  provenance: Provenance,
  spatial: SpatialBasis,
  a: ChartSeries | null,
  b: ChartSeries | null,
  note: string,
): ReportChart {
  const series = [a, b].filter((s): s is ChartSeries => s !== null && s.points.length > 0);
  return lineChart(evidenceId, title, units, provenance, spatial, series, note);
}

function barChart(
  evidenceId: string,
  title: string,
  units: string,
  provenance: Provenance,
  spatial: SpatialBasis,
  points: { x: string; y: number | null }[],
  note: string,
): ReportChart {
  const usable = points.filter((p) => p.y !== null);
  if (usable.length === 0) {
    return emptyChart(evidenceId, title, units, 'estimated', spatial, `Nothing to plot: the survey produced no consecutive-month pair at this scope. ${note}`, provenance);
  }
  // A percentage between two published prices is this application's arithmetic, so the chart is
  // labelled estimated even though both operands are observations.
  return { evidenceId, title, units, valueKind: 'estimated', spatial, series: [{ label: 'Change since the previous survey month', points: usable }], unavailableReason: null, provenance };
}

function emptyChart(
  evidenceId: string,
  title: string,
  units: string,
  valueKind: ValueKind,
  spatial: SpatialBasis,
  reason: string,
  provenance: Provenance | null,
): ReportChart {
  return { evidenceId, title, units, valueKind, spatial, series: [], unavailableReason: reason, provenance };
}

function section(
  id: ReportSectionId,
  title: string,
  scope: ReportScope,
  evidence: ReportEvidence[],
  caveats: string[],
): ReportSection {
  const errors = evidence.filter((e) => e.error !== null);
  const reason = errors.length === evidence.length
    ? `No source answered for ${title.toLowerCase()}: ${errors.map((e) => `${e.provider} — ${e.error?.message}`).join('; ')}`
    : null;
  return {
    id,
    title,
    status: reason ? 'unavailable' : errors.length === 0 ? 'ready' : 'partial',
    unavailableReason: reason,
    scope,
    evidence,
    caveats: reason ? [reason, ...caveats] : caveats,
  };
}

function unavailableSection(id: ReportSectionId, title: string, scope: ReportScope, reason: string): ReportSection {
  return { id, title, status: 'unavailable', unavailableReason: reason, scope, evidence: [], caveats: [reason] };
}

function dailyColumns(): ReportColumn[] {
  return [
    { key: 'date', label: 'Date', units: null },
    { key: 'basis', label: 'Basis', units: null },
    { key: 'precipitationSumMm', label: 'Rainfall', units: 'mm' },
    { key: 'temperatureMaxC', label: 'Max', units: '°C' },
    { key: 'temperatureMinC', label: 'Min', units: '°C' },
    { key: 'relativeHumidityMeanPct', label: 'Humidity', units: '%' },
    { key: 'windSpeedMaxKmh', label: 'Wind', units: 'km/h' },
    { key: 'et0Mm', label: 'Reference ET (ET0)', units: 'mm' },
  ];
}

function agroColumns(): ReportColumn[] {
  return [
    { key: 'date', label: 'Date', units: null },
    { key: 'precipitationMm', label: 'Rainfall', units: 'mm' },
    { key: 'temperatureMaxC', label: 'Max', units: '°C' },
    { key: 'temperatureMinC', label: 'Min', units: '°C' },
    { key: 'relativeHumidityPct', label: 'Humidity', units: '%' },
    { key: 'windSpeedMs', label: 'Wind', units: 'm/s' },
    { key: 'shortwaveRadiationMjPerM2', label: 'Shortwave', units: 'MJ/m²' },
  ];
}

function priceColumns(): ReportColumn[] {
  return [
    { key: 'observedOn', label: 'Survey month', units: null },
    { key: 'market', label: 'Market', units: null },
    // The publisher's own region travels on the row: a reader of a region report can then see
    // that the filter selected the rows it claims to have selected.
    { key: 'region', label: 'Region (as published)', units: null },
    { key: 'commodity', label: 'Commodity', units: null },
    { key: 'unit', label: 'Unit', units: null },
    { key: 'currency', label: 'Currency', units: null },
    { key: 'price', label: 'Price', units: 'ETB' },
    { key: 'retail', label: 'Price type', units: null },
    { key: 'priceFlag', label: 'Figure basis', units: null },
  ];
}

function changeColumns(): ReportColumn[] {
  return [
    { key: 'market', label: 'Market', units: null },
    { key: 'commodity', label: 'Commodity', units: null },
    { key: 'unit', label: 'Unit', units: null },
    { key: 'previousPrice', label: 'Previous month', units: 'ETB' },
    { key: 'latestPrice', label: 'Latest month', units: 'ETB' },
    { key: 'changePct', label: 'Change (computed)', units: '%' },
    { key: 'observations', label: 'Rows in series', units: null },
  ];
}

function dailyRow(d: DailyWeatherPoint): Row {
  return {
    date: d.date,
    basis: d.isForecast ? 'Forecast' : 'Observed',
    precipitationSumMm: d.precipitationSumMm,
    temperatureMaxC: d.temperatureMaxC,
    temperatureMinC: d.temperatureMinC,
    relativeHumidityMeanPct: d.relativeHumidityMeanPct,
    windSpeedMaxKmh: d.windSpeedMaxKmh,
    et0Mm: d.et0Mm,
  };
}

function currentRow(c: { observedAt: string; temperatureC: number | null; relativeHumidityPct: number | null; precipitationMm: number | null; windSpeedKmh: number | null; weatherCode: number | null }): Row {
  return {
    observedAt: c.observedAt,
    temperatureC: c.temperatureC,
    relativeHumidityPct: c.relativeHumidityPct,
    precipitationMm: c.precipitationMm,
    windSpeedKmh: c.windSpeedKmh,
    weatherCode: c.weatherCode,
  };
}

function agroRow(d: AgroclimateDailyPoint): Row {
  return {
    date: d.date,
    precipitationMm: d.precipitationMm,
    temperatureMaxC: d.temperatureMaxC,
    temperatureMinC: d.temperatureMinC,
    relativeHumidityPct: d.relativeHumidityPct,
    windSpeedMs: d.windSpeedMs,
    shortwaveRadiationMjPerM2: d.shortwaveRadiationMjPerM2,
  };
}

function normalRow(n: MonthlyNormal): Row {
  return { month: n.month, parameter: n.parameter, value: n.value, units: n.units };
}

function priceRow(r: MarketPriceObservation): Row {
  return {
    observedOn: r.observedOn,
    market: r.market,
    region: r.admin1,
    commodity: r.commodity,
    unit: r.unit,
    currency: r.currency,
    price: r.price,
    retail: r.retail,
    priceFlag: r.priceFlag,
  };
}

function changeRow(c: PriceChange): Row {
  return {
    market: c.market,
    commodity: c.commodity,
    unit: c.unit,
    previousPrice: c.previousPrice,
    latestPrice: c.latestPrice,
    changePct: c.changePct,
    observations: c.observations,
  };
}

function sampleRow(s: { tileDate: string; value: number | null; band: string | null; pixelSizeMeters: number; quality: string }): Row {
  return { tileDate: s.tileDate, value: s.value, band: s.band, pixelSizeMeters: s.pixelSizeMeters, quality: s.quality };
}

function collectWarnings(scope: ReportScope, demo: boolean, sections: ReportSection[]): ReportWarning[] {
  const out: ReportWarning[] = [];
  if (demo) {
    out.push({ code: 'demo_mode', message: 'Demo-mode report: real sources, demo records. Must be marked on every page.', evidenceId: null });
  }
  if (scope.note) {
    out.push({ code: 'scope_downgraded', message: scope.note, evidenceId: null });
  }
  for (const sec of sections) {
    if (sec.status === 'unavailable') {
      out.push({ code: 'insufficient_data', message: `${sec.title}: ${sec.unavailableReason}`, evidenceId: `section.${sec.id}` });
    }
    for (const item of sec.evidence) {
      if (item.error) {
        out.push({ code: 'source_unavailable', message: `${item.provider} did not answer for ${sec.title}: ${item.error.message}`, evidenceId: item.evidenceId });
      } else if (item.provenance.stale) {
        out.push({ code: 'source_stale', message: `${item.provider}: newest observation ${item.provenance.observedAt ?? 'undated'} is outside this source’s freshness window.`, evidenceId: item.evidenceId });
      }
      for (const chart of item.charts) {
        if (chart.unavailableReason) {
          out.push({ code: 'insufficient_data', message: `${chart.title}: ${chart.unavailableReason}`, evidenceId: chart.evidenceId });
        }
      }
    }
  }
  out.push({ code: 'licensing', message: 'Administrative-boundary and hydrology map services are excluded from this report pending redistribution terms; see the geospatial caveats.', evidenceId: null });
  return out;
}

function registerFor(sections: ReportSection[]): SourceRegisterEntry[] {
  const entries: SourceRegisterEntry[] = [];
  for (const sec of sections) {
    for (const item of sec.evidence) {
      // `evidenceOf` already stripped a refused publisher's fetch time, so the register, the PDF's
      // Sources page and the model's prompt all quote the same value the API routes return.
      const p = item.provenance;
      entries.push({
        evidenceId: item.evidenceId,
        source: p.source,
        sourceUrl: p.sourceUrl,
        endpoint: p.endpoint,
        license: p.license,
        valueKind: p.valueKind,
        units: p.units,
        coverage: p.coverage,
        spatial: item.section === 'geospatial' ? 'single-pixel' : item.section === 'economy' ? 'national-survey' : sec.scope.spatial,
        observedAt: p.observedAt,
        retrievedAt: p.retrievedAt,
        stale: p.stale,
        servedFromCache: p.servedFromCache,
        quality: p.quality,
        state: item.error ? 'unavailable' : p.stale ? 'stale' : 'connected',
        detail: item.error
          ? item.error.message
          : `${p.retrievedAt ? `Called on ${p.retrievedAt}` : 'Answered, with no fetch time recorded'}${p.servedFromCache ? ' from this process’s cache' : ' at the publisher'}.`,
      });
    }
  }
  return entries;
}

function attributionFor(req: ReportRequest): ReportAttribution {
  if (!req.caller) {
    return {
      verified: false,
      displayName: null,
      note: 'No authenticated session was confirmed for this request, so the report carries no authorisation line and no signature block. Printing one regardless would be simulating authorization.',
    };
  }
  return {
    verified: true,
    displayName: req.caller.displayName,
    note: req.caller.displayName
      ? 'Taken from the account whose token this server confirmed for this request.'
      : 'A session was confirmed for this request, but the account carries no display name, so the cover shows a verified line without a name rather than a name this server never received.',
  };
}

/**
 * A lookup key for the source register, not a signature and not an authorisation claim: nothing
 * here was cryptographically attested, and the PDF must not imply otherwise.
 */
function newReference(): string {
  return `NX-REP-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function describeScope(scope: ReportScope): string {
  if (scope.kind === 'market') return `${scope.place}, ${scope.region ?? 'Ethiopia'}`;
  if (scope.kind === 'region') return `${scope.region}, all surveyed markets`;
  if (scope.kind === 'national') return 'Ethiopia, national survey';
  return describeLocation(scope);
}

function describeLocation(scope: ReportScope): string {
  const l = scope.location;
  return l ? `${l.name} (${l.latitude.toFixed(4)}, ${l.longitude.toFixed(4)})` : 'the requested scope';
}

/** The scope line every section repeats, so a page cannot outlive the place it describes. */
function scopeNote(scope: ReportScope): string {
  return scope.note ?? `Report scope: ${describeScope(scope)}.`;
}

function shiftUtcDate(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 86_400_000);
}
