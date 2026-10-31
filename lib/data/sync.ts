import { getSyncClient } from '@/lib/supabaseAdmin';

import { DEFAULT_ETHIOPIAN_LOCATION, ETHIOPIAN_MARKET_LOCATIONS } from './ethiopianMarkets';
import { findLatestLayerDate, GIBS_LAYERS, sampleLayerAtCoordinate } from './gibs';
import { getAgroclimateDaily } from './nasaPower';
import { getExchangeRates, getUsdRateSeries } from './nbeExchange';
import { readVectorLayerIndex, VECTOR_LAYER_BY_ID } from './geoVector';
import { getWeatherForecast } from './openMeteo';
import { SOURCES } from './sources';
import { getObservationWindow } from './wfpMarketPrices';
import { getBenchmarkIndicators, getUnofficialRateSeries } from './worldBank';
import type { LocationRef, Provenance } from './types';

/**
 * The scheduled sync: publisher → connector → normalized rows → Supabase.
 *
 * What this is careful about, roughly in order of cost:
 *
 * 1. It never invents a number. Units, observation date and `value_kind` come from the
 *    connector's own provenance; a row whose figures are all null is dropped rather than
 *    written as zero, and a publisher gap stays a null.
 * 2. It never overlaps itself. A lease with an expiry is claimed before any publisher is
 *    contacted; a second worker records `skipped_overlap` and writes nothing.
 * 3. It never fails silently. Each attempt opens a `data.sync_runs` row and closes it
 *    succeeded / partial / failed with a sanitized reason.
 * 4. It never writes a legacy column it does not own. `public.environmental_data` is
 *    refreshed from ONE designated source, in ONE direction, and `soil_moisture_pct`,
 *    `ndvi_index` and `climate_risk_score` are excluded because those legacy values are
 *    model output and a placeholder-derived score.
 *
 * Server-only: it uses the service-role key, which the RLS-forced `data` schema requires
 * and no browser should ever hold.
 */

/* ------------------------------------------------------------------ *
 * Scope knobs — every one of them bounds upstream calls, because the
 * publishers are free services with polite limits, not our infrastructure.
 * ------------------------------------------------------------------ */

/** Months of WFP survey history to keep; the publisher releases one month at a time. */
const PRICE_HISTORY_MONTHS = 24;
/** Days of climate history refreshed per place per run. Longer backfills are manual. */
const CLIMATE_DAYS_PER_RUN = 45;
/** Forecast days carried alongside the history, so a rain alert has something to read. */
const CLIMATE_FORECAST_DAYS = 7;
/** Places refreshed by the climate task (12 places x 2 publishers, not 65 x 2). */
const CLIMATE_PLACES = 12;
/** Points sampled from satellite composites; each is one tile plus one colour map. */
const SATELLITE_POINTS = 8;
/** Rows per PostgREST upsert request. */
const BATCH_SIZE = 400;
/** Lease TTL: longer than the slowest plausible run, short enough to recover from a crash. */
const LEASE_TTL_MINUTES = 20;

/* ------------------------------------------------------------------ *
 * Reporting
 * ------------------------------------------------------------------ */

export type SyncStatus = 'succeeded' | 'partial' | 'failed' | 'skipped_overlap';

export interface TaskReport {
  task: string;
  /** Publisher ids touched, so the source-status view can tie a run to a source. */
  sourceIds: string[];
  status: SyncStatus;
  rowsWritten: number;
  rowsRejected: number;
  observedAt: string | null;
  error: { code: string; message: string } | null;
}

export interface SyncReport {
  ranAt: string;
  finishedAt: string;
  holder: string;
  runId: number | null;
  /** Set when the run could not start at all (no credentials, schema not exposed, …). */
  blocked: string | null;
  tasks: TaskReport[];
  /**
   * Tasks that exist in code but were left out of this run because their tables are not
   * there yet, each with the PostgREST answer that said so. An empty list means every
   * registered task ran, which is a different claim from "nothing was skipped".
   */
  deferred: { task: string; reason: string }[];
}

export interface SyncFreshness {
  sourceKey: string;
  status: SyncStatus;
  finishedAt: string | null;
  rowsWritten: number;
  observedAt: string | null;
  errorMessage: string | null;
}

/* ------------------------------------------------------------------ *
 * Column helpers
 * ------------------------------------------------------------------ */

/**
 * The provenance bundle, mapped once. Every table in `data` carries these columns under
 * these names, so a connector's `Provenance` cannot be partially applied to a row.
 */
function provColumns(p: Provenance) {
  return {
    source_name: p.source,
    source_url: p.sourceUrl,
    license: p.license,
    method_url: p.endpoint,
    units: p.units,
    methodology: p.methodology,
    coverage: p.coverage,
    quality: p.quality,
    retrieved_at: p.retrievedAt,
  };
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const compactDay = (d: Date) => isoDay(d).replace(/-/g, '');

function locationKeyFor(marketId: string | null, name: string): string {
  return marketId ? `wfp-market:${marketId}` : `named:${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

function toRef(name: string, admin1: string, admin2: string, latitude: number, longitude: number): LocationRef {
  return { name, admin1, admin2, latitude, longitude, coordinateSource: 'source-catalogue' };
}

/* ------------------------------------------------------------------ *
 * The write primitive
 * ------------------------------------------------------------------ */

interface BatchOutcome {
  written: number;
  rejected: number;
  error: { code: string; message: string } | null;
}

/**
 * Chunked upsert against a documented conflict target.
 *
 * `onConflict` names the columns of the unique index in `supabase/migrations`, so a rerun
 * refreshes the same row instead of adding a second one. PostgREST rejects the whole batch
 * if any row violates something else (a check constraint, a missing FK), so a rejected batch
 * is retried row by row: that keeps 399 good rows and reports the one that is wrong, which
 * is the behaviour a data pipeline needs to be debuggable. The error text is the REST
 * message with any embedded row data cut off — it is stored in `sync_runs.error_message`.
 */
async function upsertBatch(rows: Record<string, unknown>[], table: string, onConflict: string): Promise<BatchOutcome> {
  if (rows.length === 0) return { written: 0, rejected: 0, error: null };
  const client = getSyncClient();

  let written = 0;
  let rejected = 0;
  let lastError: { code: string; message: string } | null = null;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const attempt = await client.schema('data').from(table).upsert(batch, { onConflict });
    if (!attempt.error) {
      written += batch.length;
      continue;
    }

    lastError = { code: 'write_rejected', message: truncate(attempt.error.message) };

    // Fall back to per-row so one bad publisher cell cannot lose a whole batch.
    for (const row of batch) {
      const single = await client.schema('data').from(table).upsert(row, { onConflict });
      if (single.error) {
        rejected += 1;
        lastError = { code: 'write_rejected', message: truncate(single.error.message) };
      } else {
        written += 1;
      }
    }
  }

  return { written, rejected, error: lastError };
}

function truncate(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 200 ? `${flat.slice(0, 197)}…` : flat;
}

/* ------------------------------------------------------------------ *
 * Task 0 — the place registry, which every foreign key below needs
 * ------------------------------------------------------------------ */

async function syncLocations(): Promise<TaskReport> {
  const source = SOURCES.wfpPrices;
  const now = new Date().toISOString();

  const rows = [DEFAULT_ETHIOPIAN_LOCATION, ...ETHIOPIAN_MARKET_LOCATIONS].map((m) => ({
    location_key: locationKeyFor(m.marketId, m.name),
    name: m.name,
    admin1: m.admin1,
    admin2: m.admin2,
    latitude: m.latitude,
    longitude: m.longitude,
    coordinate_source: 'source-catalogue' as const,
    source_id: source.id,
    source_name: source.name,
    source_url: source.homeUrl,
    license: source.license,
    methodology:
      'Market centre, region/zone label and coordinates exactly as published in WFP’s Ethiopia market reference table via HDX. The publisher still groups the newer regions under its pre-2020 SNNPR label.',
    coverage: 'Ethiopia',
    retrieved_at: now,
  }));

  const unique = [...new Map(rows.map((r) => [r.location_key, r])).values()];
  const outcome = await upsertBatch(unique, 'location', 'location_key');

  return {
    task: 'locations',
    sourceIds: [source.id],
    status: outcome.error && outcome.written === 0 ? 'failed' : outcome.rejected > 0 ? 'partial' : 'succeeded',
    rowsWritten: outcome.written,
    rowsRejected: outcome.rejected,
    observedAt: null,
    error: outcome.error,
  };
}

/* ------------------------------------------------------------------ *
 * Task 1 — Ethiopian market prices (WFP rEMS)
 * ------------------------------------------------------------------ */

async function syncMarketPrices(): Promise<TaskReport> {
  const result = await getObservationWindow(PRICE_HISTORY_MONTHS);
  if (!result.ok) {
    return failedTask('market-prices', [SOURCES.wfpPrices.id], result.error);
  }

  const { provenance } = result;
  const rows: Record<string, unknown>[] = [];
  let dropped = 0;

  for (const r of result.data) {
    // A row with no figure is a parse artefact, not a price of zero.
    if (r.price === null) {
      dropped += 1;
      continue;
    }
    rows.push({
      source_id: SOURCES.wfpPrices.id,
      market: r.market,
      market_id: r.marketId,
      admin1: r.admin1,
      admin2: r.admin2,
      commodity: r.commodity,
      commodity_category: r.category,
      // Stored verbatim. No conversion happens here: the publisher's unit is part of the
      // fact, and a "price" without it cannot be compared with anything.
      unit: r.unit,
      currency: r.currency,
      retail: r.retail,
      observed_on: r.observedOn,
      price: r.price,
      usd_price: r.usdPrice,
      price_flag: r.priceFlag,
      value_kind: provenance.valueKind,
      ...provColumns(provenance),
      coverage: `${r.admin1 ?? 'Ethiopia'} — ${r.market}`,
    });
  }

  const outcome = await upsertBatch(rows, 'market_price_observations', 'source_id,market_key,commodity,unit,currency,retail,observed_on');

  return {
    task: 'market-prices',
    sourceIds: [SOURCES.wfpPrices.id],
    status: outcome.error && outcome.written === 0 ? 'failed' : outcome.rejected > 0 || dropped > 0 ? 'partial' : 'succeeded',
    rowsWritten: outcome.written,
    rowsRejected: outcome.rejected + dropped,
    observedAt: provenance.observedAt,
    error: outcome.error,
  };
}

/* ------------------------------------------------------------------ *
 * Task 2 — daily climate from two publishers, plus the legacy mirror
 * ------------------------------------------------------------------ */

async function syncClimate(): Promise<TaskReport> {
  const places = [DEFAULT_ETHIOPIAN_LOCATION, ...ETHIOPIAN_MARKET_LOCATIONS]
    .slice(0, CLIMATE_PLACES)
    .map((m) => ({
      key: locationKeyFor(m.marketId, m.name),
      name: m.name,
      ref: toRef(m.name, m.admin1, m.admin2, m.latitude, m.longitude),
    }));

  const end = new Date(Date.now() - 86_400_000);
  const start = new Date(end.getTime() - (CLIMATE_DAYS_PER_RUN - 1) * 86_400_000);

  const rows: Record<string, unknown>[] = [];
  const mirror: Record<string, unknown>[] = [];
  const sourceIds = new Set<string>();
  const problems: string[] = [];
  let newestObserved: string | null = null;

  for (const place of places) {
    /*
     * Open-Meteo supplies the analysed past days AND the coming week from one call. Its
     * past-day values are model output, and its `et0Mm` is the only reference
     * evapotranspiration either publisher gives us per day, so it is also the single
     * designated writer for `public.environmental_data`.
     */
    const forecast = await getWeatherForecast({
      location: place.ref,
      forecastDays: CLIMATE_FORECAST_DAYS,
      pastDays: Math.min(92, CLIMATE_DAYS_PER_RUN),
      includeHourly: false,
    });

    if (!forecast.ok) {
      problems.push(`${SOURCES.openMeteoForecast.id}: ${forecast.error.code}`);
    } else {
      sourceIds.add(SOURCES.openMeteoForecast.id);
      for (const d of forecast.data.daily) {
        if (d.precipitationSumMm === null && d.temperatureMaxC === null) continue;
        // Past days are modeled analysis, not measurements; future days are forecasts.
        const kind = d.isForecast ? 'forecast' : 'modeled';
        rows.push({
          source_id: SOURCES.openMeteoForecast.id,
          location_key: place.key,
          climate_date: d.date,
          is_forecast: d.isForecast,
          precipitation_mm: d.precipitationSumMm,
          precipitation_probability_pct: d.precipitationProbabilityMaxPct,
          temperature_max_c: d.temperatureMaxC,
          temperature_min_c: d.temperatureMinC,
          relative_humidity_pct: d.relativeHumidityMeanPct,
          wind_speed_max_kmh: d.windSpeedMaxKmh,
          et0_mm: d.et0Mm,
          value_kind: kind,
          ...provColumns(forecast.provenance),
          coverage: `${place.ref.admin1 ?? 'Ethiopia'} — ${place.name}`,
        });
        if (!d.isForecast) {
          if (!newestObserved || d.date > newestObserved) newestObserved = d.date;
          mirror.push({
            location_name: place.name,
            date: d.date,
            location_key: place.key,
            source_id: SOURCES.openMeteoForecast.id,
            source_name: forecast.provenance.source,
            source_url: forecast.provenance.sourceUrl,
            units: forecast.provenance.units,
            methodology: forecast.provenance.methodology,
            coverage: `${place.name}, ${place.ref.admin1 ?? 'Ethiopia'}`,
            quality: forecast.provenance.quality,
            value_kind: kind,
            is_forecast: false,
            rainfall_mm: d.precipitationSumMm,
            temp_max: d.temperatureMaxC,
            temperature_min_c: d.temperatureMinC,
            relative_humidity_pct: d.relativeHumidityMeanPct,
            et0_mm: d.et0Mm,
            // No wind column is mirrored: the legacy table has none, and converting km/h to
            // m/s to fit a column whose `units` string says km/h would put a number in a row
            // that no longer describes itself.
            retrieved_at: forecast.provenance.retrievedAt,
            record_replaced_at: new Date().toISOString(),
          });
        }
      }
    }

    /*
     * NASA POWER adds the radiation term and an independent precipitation estimate. It is
     * stored as its own rows — never averaged with Open-Meteo — because two models that
     * disagree produce a figure neither publisher stands behind.
     */
    const power = await getAgroclimateDaily({ location: place.ref, start: compactDay(start), end: compactDay(end) });
    if (!power.ok) {
      problems.push(`${SOURCES.nasaPower.id}: ${power.error.code}`);
      continue;
    }
    sourceIds.add(SOURCES.nasaPower.id);
    for (const d of power.data.daily) {
      if (d.precipitationMm === null && d.temperatureMaxC === null && d.shortwaveRadiationMjPerM2 === null) continue;
      rows.push({
        source_id: SOURCES.nasaPower.id,
        location_key: place.key,
        climate_date: d.date,
        is_forecast: false,
        precipitation_mm: d.precipitationMm,
        temperature_max_c: d.temperatureMaxC,
        temperature_min_c: d.temperatureMinC,
        relative_humidity_pct: d.relativeHumidityPct,
        wind_speed_ms: d.windSpeedMs,
        shortwave_radiation_mj_per_m2: d.shortwaveRadiationMjPerM2,
        value_kind: power.provenance.valueKind,
        ...provColumns(power.provenance),
        coverage: `${place.ref.admin1 ?? 'Ethiopia'} — ${place.name}`,
      });
      if (!newestObserved || d.date > newestObserved) newestObserved = d.date;
    }
  }

  const climate = await upsertBatch(rows, 'daily_climate', 'source_id,location_key,climate_date');

  /*
   * The legacy mirror. Conflict target is the uniqueness file 0001 guarantees; the payload
   * contains only the columns the sync owns, so `soil_moisture_pct`, `ndvi_index` and
   * `climate_risk_score` keep whatever the old harvester wrote and stay null on new rows.
   */
  const legacy = await upsertLegacyMirror(mirror);

  const written = climate.written;
  const errors = [climate.error, legacy.error].filter(Boolean) as { code: string; message: string }[];
  if (problems.length > 0) errors.push({ code: 'network', message: truncate(problems.slice(0, 3).join('; ')) });

  return {
    task: 'climate',
    sourceIds: [...sourceIds],
    status: written === 0 && legacy.written === 0 ? 'failed' : errors.length > 0 || climate.rejected > 0 ? 'partial' : 'succeeded',
    rowsWritten: written,
    rowsRejected: climate.rejected,
    observedAt: newestObserved,
    error: errors[0] ?? null,
  };
}

async function upsertLegacyMirror(rows: Record<string, unknown>[]): Promise<BatchOutcome> {
  if (rows.length === 0) return { written: 0, rejected: 0, error: null };
  const client = getSyncClient();

  let written = 0;
  let rejected = 0;
  let error: { code: string; message: string } | null = null;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const attempt = await client.from('environmental_data').upsert(batch, { onConflict: 'location_name,date' });
    if (!attempt.error) {
      written += batch.length;
      continue;
    }
    error = { code: 'legacy_mirror_rejected', message: truncate(attempt.error.message) };
    // A missing column (an older production revision) rejects the batch, not the row, so
    // retry singly and count what genuinely could not be written.
    for (const row of batch) {
      const single = await client.from('environmental_data').upsert(row, { onConflict: 'location_name,date' });
      if (single.error) {
        rejected += 1;
        error = { code: 'legacy_mirror_rejected', message: truncate(single.error.message) };
      } else {
        written += 1;
      }
    }
  }

  return { written, rejected, error };
}

/* ------------------------------------------------------------------ *
 * Task 3 — exchange rates and macro context, in three separated buckets
 * ------------------------------------------------------------------ */

async function syncExchange(): Promise<TaskReport> {
  const sourceIds: string[] = [];
  const problems: string[] = [];
  const rateRows: Record<string, unknown>[] = [];
  const indicatorRows: Record<string, unknown>[] = [];
  let newestObserved: string | null = null;

  /*
   * Bucket 1 — NBE official daily indicative rate. The publisher answers per date, so
   * `getUsdRateSeries` walks a bounded number of days back; the all-currency snapshot for
   * the newest publication comes from `getExchangeRates`.
   */
  const official = await getExchangeRates();
  if (official.ok) {
    sourceIds.push(SOURCES.nbeRates.id);
    for (const r of official.data) {
      if (r.weightedAverage === null && r.buying === null && r.selling === null) continue;
      rateRows.push({
        source_id: SOURCES.nbeRates.id,
        observed_on: r.observedOn,
        currency_code: r.currencyCode,
        currency_name: r.currencyName,
        quote: 'ETB per 1 unit',
        value: r.weightedAverage,
        buying_rate: r.buying,
        selling_rate: r.selling,
        rate_kind: 'official-indicative',
        frequency: 'daily',
        value_kind: official.provenance.valueKind,
        ...provColumns(official.provenance),
      });
      if (!newestObserved || r.observedOn > newestObserved) newestObserved = r.observedOn;
    }
  } else {
    problems.push(`${SOURCES.nbeRates.id}: ${official.error.code}`);
  }

  const usdSeries = await getUsdRateSeries({ wanted: 12, maxDaysBack: 30 });
  if (usdSeries.ok) {
    sourceIds.push(SOURCES.nbeRates.id);
    for (const p of usdSeries.data) {
      if (p.usdToEtb === null) continue;
      rateRows.push({
        source_id: SOURCES.nbeRates.id,
        observed_on: p.observedOn,
        currency_code: 'USD',
        currency_name: 'US Dollar',
        quote: 'ETB per 1 US$',
        value: p.usdToEtb,
        buying_rate: null,
        selling_rate: null,
        rate_kind: 'official-indicative',
        frequency: 'daily',
        value_kind: usdSeries.provenance.valueKind,
        ...provColumns(usdSeries.provenance),
      });
      if (!newestObserved || p.observedOn > newestObserved) newestObserved = p.observedOn;
    }
  } else {
    problems.push(`${SOURCES.nbeRates.id} series: ${usdSeries.error.code}`);
  }

  /*
   * Bucket 2 — World Bank monthly unofficial ("Market Average") parallel rate. A different
   * market and a different cadence from bucket 1, hence a different `source_id` and
   * `rate_kind`; the two are never averaged, and the stored `frequency` is what stops a UI
   * from plotting one as if it updated daily.
   */
  const unofficial = await getUnofficialRateSeries(24);
  if (unofficial.ok) {
    sourceIds.push(SOURCES.worldBankPrices.id);
    for (const p of unofficial.data.series) {
      rateRows.push({
        source_id: SOURCES.worldBankPrices.id,
        observed_on: p.observedOn,
        currency_code: 'USD',
        currency_name: 'US Dollar',
        quote: 'ETB per 1 US$ (unofficial)',
        value: p.unofficialUsdToEtb,
        buying_rate: null,
        selling_rate: null,
        rate_kind: 'unofficial-market-average',
        frequency: 'monthly',
        value_kind: unofficial.provenance.valueKind,
        ...provColumns(unofficial.provenance),
      });
      if (!newestObserved || p.observedOn > newestObserved) newestObserved = p.observedOn;
    }
  } else {
    problems.push(`${SOURCES.worldBankPrices.id}: ${unofficial.error.code}`);
  }

  /*
   * Bucket 3 — annual macro indicators. Published with a lag of months to years: stored
   * with their period and frequency so nothing can render them as current.
   */
  const benchmarks = await getBenchmarkIndicators();
  if (benchmarks.ok) {
    sourceIds.push(SOURCES.worldBankIndicators.id);
    for (const indicator of benchmarks.data.indicators) {
      for (const o of indicator.observations) {
        indicatorRows.push({
          source_id: SOURCES.worldBankIndicators.id,
          indicator_code: indicator.code,
          indicator_name: indicator.name,
          frequency: indicator.frequency,
          period: o.period,
          // A publisher gap stays null. Never 0, never interpolated.
          value: o.value,
          value_kind: benchmarks.provenance.valueKind,
          ...provColumns(benchmarks.provenance),
          // After the spread: each indicator is published in its own unit, and the series'
          // unit must win over the generic string the connector put on the payload.
          units: indicator.unit,
          coverage: `Ethiopia — ${indicator.name}`,
        });
      }
    }
  } else {
    problems.push(`${SOURCES.worldBankIndicators.id}: ${benchmarks.error.code}`);
  }

  const rates = await upsertBatch(dedupe(rateRows, ['source_id', 'observed_on', 'currency_code']), 'exchange_rate_observations', 'source_id,observed_on,currency_code');
  const indicators = await upsertBatch(dedupe(indicatorRows, ['source_id', 'indicator_code', 'period']), 'economic_indicator_observations', 'source_id,indicator_code,period');

  const errors = [rates.error, indicators.error].filter(Boolean) as { code: string; message: string }[];
  if (problems.length > 0) errors.push({ code: 'network', message: truncate(problems.slice(0, 3).join('; ')) });
  const written = rates.written + indicators.written;

  return {
    task: 'exchange',
    sourceIds: [...new Set(sourceIds)],
    status: written === 0 ? 'failed' : errors.length > 0 ? 'partial' : 'succeeded',
    rowsWritten: written,
    rowsRejected: rates.rejected + indicators.rejected,
    observedAt: newestObserved,
    error: errors[0] ?? null,
  };
}

/** Two calls can describe the same (source, date, currency); keep the last, drop the dupe. */
function dedupe(rows: Record<string, unknown>[], keyColumns: string[]): Record<string, unknown>[] {
  const byKey = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    byKey.set(keyColumns.map((c) => String(row[c] ?? '')).join('|'), row);
  }
  return [...byKey.values()];
}

/* ------------------------------------------------------------------ *
 * Task 4 — satellite layer registry and point readings
 * ------------------------------------------------------------------ */

async function syncSatellite(): Promise<TaskReport> {
  const points = [DEFAULT_ETHIOPIAN_LOCATION, ...ETHIOPIAN_MARKET_LOCATIONS].slice(0, SATELLITE_POINTS);
  const layerRows: Record<string, unknown>[] = [];
  const sampleRows: Record<string, unknown>[] = [];
  const problems: string[] = [];
  let newestScene: string | null = null;

  for (const layer of GIBS_LAYERS) {
    // The registry row records what the publisher confirmed, including a failed check.
    const latest = await findLatestLayerDate(layer);
    layerRows.push({
      layer_id: layer.id,
      title: layer.title,
      meaning: layer.meaning,
      caveat: layer.caveat,
      source_id: SOURCES.nasaGibs.id,
      source_name: layer.source,
      source_url: layer.sourceUrl,
      license: layer.license,
      resolution: layer.resolution,
      cadence: layer.cadence,
      matrix_set: layer.matrixSet,
      tile_url_template: layer.tileUrlTemplate,
      min_zoom: layer.minZoom,
      max_zoom: layer.maxZoom,
      value_range: layer.valueRange,
      units: layer.units,
      value_kind: layer.valueKind,
      latest_available_date: latest.ok ? latest.data : null,
      availability_checked_at: new Date().toISOString(),
      availability_error: latest.ok ? null : truncate(latest.error.message),
      methodology:
        'Layer metadata and the newest confirmed scene date come from the service’s own GetCapabilities and tile endpoint; a null date with an error means the check ran and the endpoint did not answer.',
      coverage: 'Global composites; sampling limited to Ethiopian market centres',
      quality: 'high',
    });

    if (!latest.ok) {
      problems.push(`${layer.id}: ${latest.error.code}`);
      continue;
    }
    if (!newestScene || latest.data > newestScene) newestScene = latest.data;

    for (const point of points) {
      const sample = await sampleLayerAtCoordinate({
        layerId: layer.id,
        latitude: point.latitude,
        longitude: point.longitude,
        date: latest.data,
      });
      if (!sample.ok) {
        problems.push(`${layer.id}/${point.name}: ${sample.error.code}`);
        continue;
      }
      sampleRows.push({
        layer_id: layer.id,
        location_key: locationKeyFor(point.marketId, point.name),
        scene_date: sample.data.tileDate,
        latitude: sample.data.latitude,
        longitude: sample.data.longitude,
        pixel_size_meters: sample.data.pixelSizeMeters,
        // Null stays null: an unmapped pixel is "we could not read this", not a value.
        value: sample.data.value,
        band: sample.data.band,
        value_kind: sample.provenance.valueKind,
        units: sample.provenance.units,
        methodology: sample.provenance.methodology,
        quality: sample.data.quality,
        retrieved_at: sample.provenance.retrievedAt,
      });
    }
  }

  const layers = await upsertBatch(layerRows, 'satellite_layers', 'layer_id');
  const samples = await upsertBatch(dedupe(sampleRows, ['layer_id', 'scene_date', 'location_key']), 'satellite_observations', 'layer_id,scene_date,location_key');

  const errors = [layers.error, samples.error].filter(Boolean) as { code: string; message: string }[];
  if (problems.length > 0) errors.push({ code: 'network', message: truncate(problems.slice(0, 3).join('; ')) });
  const written = layers.written + samples.written;

  return {
    task: 'satellite',
    sourceIds: [SOURCES.nasaGibs.id],
    status: written === 0 ? 'failed' : errors.length > 0 ? 'partial' : 'succeeded',
    rowsWritten: written,
    rowsRejected: samples.rejected,
    observedAt: newestScene,
    error: errors[0] ?? null,
  };
}

/* ------------------------------------------------------------------ *
 * Orchestration: lease, run, bookkeep
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * Task 5 — geospatial reference layers, gated on an unapplied migration
 * ------------------------------------------------------------------ */

/** Which publisher a registered layer belongs to, so a run can be tied to who was contacted. */
const GEO_SOURCE_BY_PROVIDER: Record<string, string> = {
  ethioAdmin: SOURCES.ethioAdminBoundaries.id,
  grid3Eth: SOURCES.grid3Ethiopia.id,
  cdeWater: SOURCES.cdeEthiopia.id,
};

/**
 * The registry half of geospatial persistence: one row per published layer, carrying the
 * publisher's own live count beside the count measured when the layer was verified, plus its
 * stated vintage, licence and generalisation tolerance.
 *
 * It writes the registry and the staleness clock, and nothing else. The geometry rows in
 * `data.geo_vector_features` are deliberately not written here: the archive needs the
 * publisher's own GeoJSON ring grouping (`f=geojson`), which has not been verified against
 * these three services — the live route asks `f=json` and re-groups rings in the connector,
 * which is adequate for drawing and not something to bake into an archive untested. That
 * prerequisite is stated in the migration header and in docs/DATA_SYNC.md rather than worked
 * around with a silent approximation.
 */
async function syncGeoVectorRegistry(): Promise<TaskReport> {
  const index = await readVectorLayerIndex();
  if (!index.ok) return failedTask('geo-vectors', [], index.error);

  const client = getSyncClient();
  const previous = await client.schema('data').from('geo_vector_layers').select('layer_id, source_count').limit(50);
  if (previous.error) {
    return failedTask('geo-vectors', [], { code: 'read_failed', message: truncate(previous.error.message) });
  }

  const seen = new Map<string, number | null>();
  for (const row of previous.data ?? []) {
    seen.set(String(row.layer_id), row.source_count === null ? null : Number(row.source_count));
  }

  const checkedAt = new Date().toISOString();
  const rows: Record<string, unknown>[] = [];

  for (const entry of index.data) {
    const definition = VECTOR_LAYER_BY_ID.get(entry.id);
    if (!definition) continue;

    const prior = seen.get(entry.id);
    // The staleness signal a reference dataset can actually give: its publisher's own count
    // moved since the last time anyone asked. Null on a layer this run saw for the first time,
    // because there is nothing for it to have changed against. Age is not stored here —
    // `count_checked_at` is, and how long a copy may sit before it is re-read is the geometry
    // step's decision, which does not exist yet.
    const countChanged = prior === undefined ? null : prior !== entry.liveCount;

    rows.push({
      layer_id: entry.id,
      title: entry.title,
      meaning: entry.meaning,
      caveat: entry.caveat,
      layer_group: entry.group,
      source_id: GEO_SOURCE_BY_PROVIDER[definition.provider] ?? SOURCES.ethioAdminBoundaries.id,
      provider: definition.provider,
      service_path: definition.path,
      publisher_layer: entry.layerLabel,
      geometry_kind: entry.geometryKind,
      name_fields: definition.nameFields,
      keep_fields: definition.keepFields,
      // Both counts or neither: a live count without the verification baseline next to it is
      // how a partial copy starts to look like a complete one.
      source_count: entry.liveCount,
      measured_count: entry.liveCount === null ? null : definition.measuredCount,
      count_checked_at: checkedAt,
      count_changed: countChanged,
      features_stored: 0,
      feature_limit: definition.featureLimit,
      tolerance_degrees: definition.toleranceDegrees,
      vertices_stored: null,
      needs_bbox: definition.needsBbox,
      extent_filtered: null,
      color: entry.color,
      value_kind: definition.valueKind,
      units: 'degrees (WGS84)',
      attribute_notes: entry.attributeNotes,
      vintage_note: entry.vintageNote,
      publisher_vintage: entry.vintage,
      license: entry.license,
      source_url: entry.sourceUrl,
      storage_srid: null,
      storage_crs_text: null,
      last_full_sync_at: null,
      last_error: entry.status === 'available' ? null : truncate(`${entry.status}: ${entry.statusDetail ?? 'the publisher did not answer the count query'}`),
      methodology: index.provenance.methodology,
      coverage: 'Ethiopia',
      quality: index.provenance.quality,
    });
  }

  const outcome = await upsertBatch(rows, 'geo_vector_layers', 'layer_id');
  const errors = outcome.error ? [outcome.error] : [];
  const newestVintage = index.data.map((e) => e.vintage).filter((v): v is string => typeof v === 'string').sort().at(-1) ?? null;

  return {
    task: 'geo-vectors',
    sourceIds: [...new Set(index.data.map((e) => GEO_SOURCE_BY_PROVIDER[VECTOR_LAYER_BY_ID.get(e.id)?.provider ?? ''] ?? '').filter(Boolean))],
    status: outcome.written === 0 ? 'failed' : outcome.rejected > 0 ? 'partial' : 'succeeded',
    rowsWritten: outcome.written,
    rowsRejected: outcome.rejected,
    observedAt: newestVintage ? `${newestVintage}T00:00:00Z` : null,
    error: errors[0] ?? null,
  };
}

/**
 * Does the table this task writes to exist? PostgREST answers `PGRST205` for a relation that
 * is not in the exposed schema, which is what "the migration has not been applied" looks like
 * from here. The reason is kept, not swallowed: absence and denial need different fixes.
 */
async function probeTable(table: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const client = getSyncClient();
  const probe = await client.schema('data').from(table).select('*', { count: 'exact', head: true });
  if (probe.error) return { ok: false, reason: truncate(`${probe.error.code ?? 'error'}: ${probe.error.message}`) };
  return { ok: true };
}

/**
 * Tasks whose tables come from a migration that is proposed but not applied. They are absent
 * from the run until their preflight passes, so the scheduled sync keeps reporting the work
 * it genuinely did; applying the file starts them with no further code change.
 */
export const GATED_SYNC_TASKS: { key: SyncTaskKey; run: () => Promise<TaskReport>; table: string }[] = [
  { key: 'geo-vectors', run: syncGeoVectorRegistry, table: 'geo_vector_layers' },
];

export const SYNC_TASK_KEYS = ['locations', 'market-prices', 'climate', 'exchange', 'satellite', 'geo-vectors'] as const;
export type SyncTaskKey = (typeof SYNC_TASK_KEYS)[number];

const TASKS: { key: SyncTaskKey; run: () => Promise<TaskReport> }[] = [
  { key: 'locations', run: syncLocations },
  { key: 'market-prices', run: syncMarketPrices },
  { key: 'climate', run: syncClimate },
  { key: 'exchange', run: syncExchange },
  { key: 'satellite', run: syncSatellite },
];

export const SYNC_LEASE_KEY = 'nexus-data-sync';

function failedTask(task: string, sourceIds: string[], error: { code: string; message: string }): TaskReport {
  return { task, sourceIds, status: 'failed', rowsWritten: 0, rowsRejected: 0, observedAt: null, error: { code: error.code, message: truncate(error.message) } };
}

/**
 * One sync attempt. Returns a report rather than throwing: a scheduler needs to record the
 * failure, and an operator needs to read which publisher broke.
 */
export async function runSync(selected?: SyncTaskKey[]): Promise<SyncReport> {
  const startedAt = new Date();
  const holder = `${startedAt.toISOString().replace(/[-:.TZ]/g, '')}-${Math.random().toString(16).slice(2, 10)}`;
  const tasks = TASKS.filter((t) => !selected || selected.length === 0 || selected.includes(t.key));

  const config = configured();
  if (!config.ok) {
    return report(holder, startedAt, null, config.reason, []);
  }

  const client = getSyncClient();

  // ---- overlap protection, before any publisher is contacted ----
  const claim = await client.schema('data').rpc('claim_sync_lease', {
    p_source_key: SYNC_LEASE_KEY,
    p_holder: holder,
    p_ttl: `${LEASE_TTL_MINUTES} minutes`,
  });
  if (claim.error || claim.data !== true) {
    const message = claim.error ? truncate(claim.error.message) : 'Another sync run holds the lease';
    return report(holder, startedAt, null, `skipped_overlap: ${message}`, [
      {
        task: 'all',
        sourceIds: [],
        status: 'skipped_overlap',
        rowsWritten: 0,
        rowsRejected: 0,
        observedAt: null,
        error: { code: 'skipped_overlap', message },
      },
    ]);
  }

  // ---- gated tasks: a task whose tables come from an unapplied migration stays out of the
  // run, so the report describes the work that was actually done. The probe is one head
  // request per gated task, and it runs under the lease. ----
  const deferred: SyncReport['deferred'] = [];
  for (const gated of GATED_SYNC_TASKS) {
    if (selected && selected.length > 0 && !selected.includes(gated.key)) continue;
    const ready = await probeTable(gated.table);
    if (ready.ok) tasks.push(gated);
    else deferred.push({ task: gated.key, reason: ready.reason });
  }

  // ---- open the run row ----
  const opened = await client
    .schema('data')
    .from('sync_runs')
    .insert({ source_key: SYNC_LEASE_KEY, status: 'running', started_at: startedAt.toISOString(), detail: { holder, tasks: tasks.map((t) => t.key), deferred } })
    .select('run_id')
    .single();

  if (opened.error) {
    await client.schema('data').rpc('release_sync_lease', { p_source_key: SYNC_LEASE_KEY, p_holder: holder });
    return report(holder, startedAt, null, `sync_runs is not writable: ${truncate(opened.error.message)}`, [], null, deferred);
  }

  const runId = opened.data.run_id as number;
  const results: TaskReport[] = [];
  try {
    for (const task of tasks) {
      try {
        results.push(await task.run());
      } catch (err) {
        // A connector throwing is the publisher's failure, recorded like any other.
        results.push({
          task: task.key,
          sourceIds: [],
          status: 'failed',
          rowsWritten: 0,
          rowsRejected: 0,
          observedAt: null,
          error: { code: 'task_threw', message: err instanceof Error ? truncate(err.name) : 'task failed' },
        });
      }
    }
  } finally {
    const finishedAt = new Date();
    const overall = results.some((r) => r.status === 'failed')
      ? results.every((r) => r.status === 'failed')
        ? 'failed'
        : 'partial'
      : results.some((r) => r.status === 'partial')
        ? 'partial'
        : 'succeeded';

    await client
      .schema('data')
      .from('sync_runs')
      .update({
        status: overall,
        finished_at: finishedAt.toISOString(),
        rows_written: results.reduce((s, r) => s + r.rowsWritten, 0),
        rows_rejected: results.reduce((s, r) => s + r.rowsRejected, 0),
        observed_at: newestOf(results),
        source_url: SOURCES.wfpPrices.homeUrl,
        error_code: firstErrorCode(results),
        error_message: firstErrorMessage(results),
        detail: { tasks: results.map((r) => ({ task: r.task, status: r.status, written: r.rowsWritten, rejected: r.rowsRejected, error: r.error?.code ?? null })), deferred },
        record_replaced_at: finishedAt.toISOString(),
      })
      .eq('run_id', runId);

    await client.schema('data').rpc('release_sync_lease', { p_source_key: SYNC_LEASE_KEY, p_holder: holder });
    return report(holder, startedAt, finishedAt, null, results, runId, deferred);
  }
}

function report(
  holder: string,
  startedAt: Date,
  finishedAt: Date | null,
  blocked: string | null,
  tasks: TaskReport[],
  runId: number | null = null,
  deferred: SyncReport['deferred'] = [],
): SyncReport {
  return {
    ranAt: startedAt.toISOString(),
    finishedAt: (finishedAt ?? new Date()).toISOString(),
    holder,
    runId,
    blocked,
    tasks,
    deferred,
  };
}

function newestOf(results: TaskReport[]): string | null {
  const dates = results.map((r) => r.observedAt).filter((d): d is string => typeof d === 'string');
  return dates.length > 0 ? dates.sort().at(-1)! : null;
}

function firstErrorCode(results: TaskReport[]): string | null {
  return results.find((r) => r.error)?.error?.code ?? null;
}

function firstErrorMessage(results: TaskReport[]): string | null {
  return results.find((r) => r.error)?.error?.message ?? null;
}

function configured(): { ok: true } | { ok: false; reason: string } {
  if (typeof window !== 'undefined') return { ok: false, reason: 'The sync runs on the server only.' };
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return { ok: false, reason: 'NEXT_PUBLIC_SUPABASE_URL is not set on the server.' };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { ok: false, reason: 'SUPABASE_SERVICE_ROLE_KEY is not set on the server.' };
  return { ok: true };
}

/* ------------------------------------------------------------------ *
 * Read side: what the source-status view shows as "last synced"
 * ------------------------------------------------------------------ */

/**
 * Newest recorded run per source key. Returns an empty list when the database is not
 * configured or the schema is not exposed — the status view then says "no sync recorded",
 * which is the truth, instead of inventing a timestamp.
 */
export async function getSyncFreshness(): Promise<SyncFreshness[]> {
  const config = configured();
  if (!config.ok) return [];

  const client = getSyncClient();
  const res = await client.schema('data').from('v_source_freshness').select('*').order('started_at', { ascending: false });
  if (res.error || !Array.isArray(res.data)) return [];

  return res.data.map((row) => ({
    sourceKey: String(row.source_key),
    status: String(row.status) as SyncStatus,
    finishedAt: row.finished_at ? new Date(String(row.finished_at)).toISOString() : null,
    rowsWritten: Number(row.rows_written ?? 0),
    observedAt: row.observed_at ? new Date(String(row.observed_at)).toISOString() : null,
    errorMessage: row.error_message ? String(row.error_message) : null,
  }));
}
