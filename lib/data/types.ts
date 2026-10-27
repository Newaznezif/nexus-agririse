/**
 * Shared vocabulary for every external data connector in `lib/data`.
 *
 * The rule this model exists to enforce: no number may reach the UI without
 * the units, the observation date, the retrieval date and the kind of value it
 * is (measured vs modelled vs forecast). See `Provenance`.
 */

export type ValueKind = 'observed' | 'modeled' | 'forecast' | 'estimated' | 'imputed';

export type QualityTier = 'high' | 'medium' | 'low';

/** Connection state as shown in the source-status view. */
export type SourceState = 'connected' | 'stale' | 'unavailable' | 'auth_required' | 'disabled';

/** Stable, client-safe error codes. Never carries an upstream body or a key. */
export type SourceErrorCode =
  | 'timeout'
  | 'network'
  | 'http_status'
  | 'rate_limited'
  | 'payload_too_large'
  | 'parse_failed'
  | 'no_data'
  | 'bad_input'
  | 'auth_required'
  | 'not_configured';

export interface Provenance {
  /** Human-readable publisher, e.g. "National Bank of Ethiopia". */
  source: string;
  /** Documentation or dataset landing page shown as the source link. */
  sourceUrl: string;
  /** Endpoint actually called (no query secrets — none of these sources need keys). */
  endpoint: string;
  license: string;
  /** ISO timestamp this payload was fetched by our server. */
  retrievedAt: string;
  /** ISO date the underlying observation was made or published; null when unknown. */
  observedAt: string | null;
  valueKind: ValueKind;
  units: string;
  methodology: string;
  quality: QualityTier;
  /** Geographic scope of the returned rows. */
  coverage: string;
  /** Freshness contract declared by the connector. */
  maxAgeSeconds: number;
  stale: boolean;
  servedFromCache: boolean;
}

export interface SourceError {
  code: SourceErrorCode;
  /** Operator-facing detail. Sanitized: no upstream HTML, no keys, no stack. */
  message: string;
  /** Upstream HTTP status when one was actually received. */
  status?: number;
  /** Seconds to wait before retrying, when the source told us. */
  retryAfterSeconds?: number;
}

export type ConnectorResult<T> =
  | { ok: true; data: T; provenance: Provenance }
  | { ok: false; error: SourceError; provenance: Provenance };

export interface SourceDescriptor {
  id: string;
  name: string;
  category: 'weather' | 'agroclimatology' | 'market_prices' | 'exchange_rates' | 'geospatial' | 'economic_benchmarks';
  homeUrl: string;
  license: string;
  /** Cadence the publisher actually uses — decides the staleness threshold. */
  cadence: 'realtime' | 'hourly' | 'daily' | '8daily' | 'monthly' | 'quarterly' | 'annual' | 'irregular';
  /**
   * How long after the observation the publisher normally takes to release it.
   * Without this, NASA POWER's 2-3 day reanalysis latency would be reported as
   * the data being stale, which it is not.
   */
  publicationLagSeconds?: number;
  requiresKey: boolean;
}

/* ------------------------------------------------------------------ *
 * Weather / agroclimatology
 * ------------------------------------------------------------------ */

export interface CurrentWeather {
  observedAt: string;
  temperatureC: number | null;
  relativeHumidityPct: number | null;
  precipitationMm: number | null;
  windSpeedKmh: number | null;
  weatherCode: number | null;
}

export interface DailyWeatherPoint {
  date: string;
  /** True when the date is in the future, i.e. the values are forecasts. */
  isForecast: boolean;
  precipitationSumMm: number | null;
  precipitationProbabilityMaxPct: number | null;
  temperatureMaxC: number | null;
  temperatureMinC: number | null;
  relativeHumidityMeanPct: number | null;
  windSpeedMaxKmh: number | null;
  /** FAO-56 reference evapotranspiration, mm. */
  et0Mm: number | null;
}

export interface HourlyWeatherPoint {
  time: string;
  temperatureC: number | null;
  precipitationMm: number | null;
  relativeHumidityPct: number | null;
}

export interface WeatherSeries {
  location: LocationRef;
  timezone: string;
  elevationM: number | null;
  current: CurrentWeather | null;
  daily: DailyWeatherPoint[];
  hourly: HourlyWeatherPoint[];
}

export interface AgroclimateDailyPoint {
  date: string;
  temperatureMaxC: number | null;
  temperatureMinC: number | null;
  relativeHumidityPct: number | null;
  windSpeedMs: number | null;
  /** Corrected precipitation, mm/day (POWER PRECTOTCORR). */
  precipitationMm: number | null;
  /** All-sky surface shortwave downward radiation, MJ/m²/day (POWER ALLSKY_SFC_SW_DWN). */
  shortwaveRadiationMjPerM2: number | null;
}

export interface AgroclimateSeries {
  location: LocationRef;
  daily: AgroclimateDailyPoint[];
  /** Monthly climatology normal, when the source supplied one. */
  normals?: MonthlyNormal[];
}

export interface MonthlyNormal {
  month: string;
  parameter: string;
  units: string;
  value: number | null;
}

export interface LocationRef {
  name: string;
  /** Region / admin1 as published by the source. */
  admin1: string | null;
  /** Zone / admin2 as published by the source. */
  admin2: string | null;
  latitude: number;
  longitude: number;
  /** 'source-catalogue' = coordinates came from a publisher; 'user' = typed by a farmer. */
  coordinateSource: 'source-catalogue' | 'user' | 'default';
}

/* ------------------------------------------------------------------ *
 * Market prices
 * ------------------------------------------------------------------ */

export interface MarketPriceObservation {
  /** ISO date of the price survey. */
  observedOn: string;
  market: string;
  marketId: string | null;
  admin1: string | null;
  admin2: string | null;
  latitude: number | null;
  longitude: number | null;
  commodity: string;
  category: string | null;
  /** e.g. "100 KG", "KG", "Head". Kept verbatim: never silently converted. */
  unit: string;
  currency: string;
  price: number | null;
  /** Publisher's own USD conversion, kept separate from ours. */
  usdPrice: number | null;
  retail: 'Retail' | 'Wholesale' | 'aggregate' | 'unknown';
  priceFlag: 'actual' | 'aggregate' | 'replaced' | 'unknown';
}

export interface PriceChange {
  commodity: string;
  market: string;
  unit: string;
  currency: string;
  latestObservedOn: string;
  latestPrice: number;
  previousObservedOn: string | null;
  previousPrice: number | null;
  /** Percent change versus the previous observation at the same market+unit. */
  changePct: number | null;
  observations: number;
}

export interface MarketSnapshot {
  asOfLatestObservation: string | null;
  markets: number;
  commodities: number;
  rows: MarketPriceObservation[];
  changes: PriceChange[];
}

/* ------------------------------------------------------------------ *
 * Exchange rates and economic context
 * ------------------------------------------------------------------ */

export interface ExchangeRateObservation {
  observedOn: string;
  currencyCode: string;
  currencyName: string | null;
  /** ETB per one unit of `currencyCode`, as published. */
  weightedAverage: number | null;
  buying: number | null;
  selling: number | null;
}

export interface EconomicIndicator {
  code: string;
  name: string;
  /** Annual series are explicitly not presented as real-time. */
  frequency: 'daily' | 'monthly' | 'annual';
  unit: string;
  observations: { period: string; value: number | null }[];
}

/* ------------------------------------------------------------------ *
 * Geospatial
 * ------------------------------------------------------------------ */

export interface GeospatialLayer {
  id: string;
  title: string;
  /** Plain-language meaning for the map legend. */
  meaning: string;
  /** What the values are NOT, to stop over-claiming. */
  caveat: string;
  source: string;
  sourceUrl: string;
  license: string;
  resolution: string;
  cadence: string;
  /** Template with {date}/{z}/{y}/{x} placeholders. */
  tileUrlTemplate: string;
  matrixSet: string;
  minZoom: number;
  maxZoom: number;
  /** Most recent date the publisher confirmed has data. */
  latestAvailableDate: string | null;
  valueRange: string;
  units: string;
  valueKind: ValueKind;
}

export interface SatelliteSample {
  layerId: string;
  /** Date stamp actually present on the tile. */
  tileDate: string;
  /** Center coordinate of the sampled pixel. */
  latitude: number;
  longitude: number;
  /** Raw NDVI midpoint from the published colour map, or null when the pixel is nodata/fill. */
  value: number | null;
  /** Value band label exactly as the publisher defines it. */
  band: string | null;
  pixelSizeMeters: number;
  quality: QualityTier;
}
