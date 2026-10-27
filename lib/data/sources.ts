import type { Provenance, SourceDescriptor, SourceState, ValueKind } from './types';

/**
 * Every upstream we depend on, declared in one place so the source-status view
 * and the freshness rules cannot drift from the code that actually runs.
 *
 * None of these publishers require an API key, which is why there is no secret
 * handling here: the only credentials this layer ever touches are absent ones.
 */

export const SOURCES = {
  openMeteoForecast: {
    id: 'open-meteo-forecast',
    name: 'Open-Meteo Forecast API',
    category: 'weather',
    homeUrl: 'https://open-meteo.com/en/docs',
    license: 'CC BY 4.0 (Open-Meteo), models by DWD/ECMWF/Météo-France etc.',
    cadence: 'hourly',
    requiresKey: false,
  },
  openMeteoHistorical: {
    id: 'open-meteo-historical',
    name: 'Open-Meteo Historical Weather API (ERA5)',
    category: 'weather',
    homeUrl: 'https://open-meteo.com/en/docs/historical-weather-api',
    license: 'CC BY 4.0 (Open-Meteo), ERA5 reanalysis (ECMWF/Copernicus)',
    cadence: 'daily',
    // ERA5 reanalysis is released roughly a week after the observation.
    publicationLagSeconds: 8 * 86400,
    requiresKey: false,
  },
  nasaPower: {
    id: 'nasa-power',
    name: 'NASA POWER Agroclimatology',
    category: 'agroclimatology',
    homeUrl: 'https://power.larc.nasa.gov/docs/services/api/temporal/daily/',
    license: 'NASA open data; no attribution restriction',
    cadence: 'daily',
    // POWER's daily gap-free product is complete about 2-3 days after the day itself.
    publicationLagSeconds: 3 * 86400,
    requiresKey: false,
  },
  wfpPrices: {
    id: 'wfp-ethiopia-prices',
    name: 'WFP Ethiopia Food Prices (rEMS)',
    category: 'market_prices',
    homeUrl: 'https://data.humdata.org/dataset/wfp-food-prices-for-ethiopia',
    license: 'CC BY-IGO (World Food Programme)',
    cadence: 'monthly',
    requiresKey: false,
  },
  worldBankPrices: {
    id: 'worldbank-realtime-prices',
    name: 'World Bank Ethiopia Real-Time Prices',
    category: 'market_prices',
    homeUrl: 'https://data.humdata.org/dataset/ethiopia-real-time-prices',
    license: 'CC BY (World Bank Group)',
    cadence: 'monthly',
    requiresKey: false,
  },
  nbeRates: {
    id: 'nbe-indicative-rates',
    name: 'National Bank of Ethiopia — Daily Indicative Exchange Rates',
    category: 'exchange_rates',
    homeUrl: 'https://nbe.gov.et/exchange/',
    license: 'Official government publication; cite NBE as source',
    cadence: 'daily',
    requiresKey: false,
  },
  worldBankIndicators: {
    id: 'worldbank-indicators',
    name: 'World Bank Open Data — Ethiopia indicators',
    category: 'economic_benchmarks',
    homeUrl: 'https://api.worldbank.org/v2/country/ETH',
    license: 'CC BY 4.0',
    cadence: 'annual',
    requiresKey: false,
  },
  nasaGibs: {
    id: 'nasa-gibs',
    name: 'NASA GIBS (MODIS/VIIRS/IMERG)',
    category: 'geospatial',
    homeUrl: 'https://worldview.earthdata.nasa.gov/',
    license: 'NASA EOSDIS open; citation required per layer',
    cadence: '8daily',
    // A rolling 8-day composite is only labelled with its end date once the
    // window closes, so a scene is normally a few days to a fortnight old.
    publicationLagSeconds: 14 * 86400,
    requiresKey: false,
  },
  geoBoundaries: {
    id: 'geoboundaries-eth',
    name: 'geoBoundaries (ETH administrative boundaries)',
    category: 'geospatial',
    homeUrl: 'https://www.geoboundaries.org/single-state.html?iso3=ETH&level=1',
    license: 'CC BY 4.0 (wmgeolab / geoBoundaries)',
    cadence: 'irregular',
    requiresKey: false,
  },
} satisfies Record<string, SourceDescriptor>;

/** How long a value may be shown as current before the UI must call it stale. */
const MAX_AGE_BY_CADENCE: Record<SourceDescriptor['cadence'], number> = {
  realtime: 5 * 60,
  hourly: 6 * 3600,
  daily: 36 * 3600,
  '8daily': 11 * 86400,
  monthly: 45 * 86400,
  quarterly: 120 * 86400,
  annual: 420 * 86400,
  irregular: 400 * 86400,
};

export interface ProvenanceSeed {
  endpoint: string;
  observedAt: string | null;
  valueKind: ValueKind;
  units: string;
  methodology: string;
  coverage: string;
  quality?: Provenance['quality'];
  retrievedAt?: string;
  servedFromCache?: boolean;
}

export function provenanceFor(source: SourceDescriptor, seed: ProvenanceSeed): Provenance {
  const retrievedAt = seed.retrievedAt ?? new Date().toISOString();
  const maxAgeSeconds = MAX_AGE_BY_CADENCE[source.cadence];
  const ageSeconds = (Date.now() - Date.parse(retrievedAt)) / 1000;
  return {
    source: source.name,
    sourceUrl: source.homeUrl,
    endpoint: seed.endpoint,
    license: source.license,
    retrievedAt,
    observedAt: seed.observedAt,
    valueKind: seed.valueKind,
    units: seed.units,
    methodology: seed.methodology,
    quality: seed.quality ?? 'high',
    coverage: seed.coverage,
    maxAgeSeconds,
    // Two independent staleness signals: the payload itself can be old (the
    // publisher lags), and our copy can be old. A farmer must see which.
    stale: ageSeconds > maxAgeSeconds || isObservationLate(source, seed.observedAt, maxAgeSeconds),
    servedFromCache: seed.servedFromCache ?? false,
  };
}

/**
 * The publisher's own delay counts against freshness. A July observation viewed
 * in November is not "current", however recently we downloaded the file.
 */
function isObservationLate(source: SourceDescriptor, observedAt: string | null, maxAgeSeconds: number): boolean {
  if (!observedAt) return false;
  const parsed = Date.parse(observedAt.length === 10 ? `${observedAt}T00:00:00Z` : observedAt);
  if (Number.isNaN(parsed)) return false;
  // The publisher's own release delay, plus one extra cycle for the slow
  // monthly/annual publications, so a legitimately lagging source is not
  // flagged as if it had broken.
  const cadenceGrace = source.cadence === 'monthly' ? 30 * 86400 : source.cadence === 'annual' ? 365 * 86400 : 0;
  return (Date.now() - parsed) / 1000 > maxAgeSeconds + cadenceGrace + (source.publicationLagSeconds ?? 0);
}

export interface SourceStatusEntry {
  id: string;
  name: string;
  category: SourceDescriptor['category'];
  cadence: SourceDescriptor['cadence'];
  homeUrl: string;
  license: string;
  requiresKey: boolean;
  state: SourceState;
  detail: string;
  observedAt: string | null;
  retrievedAt: string | null;
  stale: boolean;
}

/** Aggregate a connector outcome into the state the status view renders. */
export function toStatusEntry(
  source: SourceDescriptor,
  outcome: { ok: true; provenance: Provenance } | { ok: false; error: { code: string; message: string } },
): SourceStatusEntry {
  const base = {
    id: source.id,
    name: source.name,
    category: source.category,
    cadence: source.cadence,
    homeUrl: source.homeUrl,
    license: source.license,
    requiresKey: source.requiresKey,
  };

  if (!outcome.ok) {
    return {
      ...base,
      state: outcome.error.code === 'auth_required' ? 'auth_required' : 'unavailable',
      detail: outcome.error.message,
      observedAt: null,
      retrievedAt: null,
      stale: false,
    };
  }

  const p = outcome.provenance;
  return {
    ...base,
    state: p.stale ? 'stale' : 'connected',
    detail: p.stale
      ? `Reachable, but the newest observation (${p.observedAt ?? 'unknown'}) is older than this source’s normal freshness window.`
      : `Returning data observed ${p.observedAt ?? 'at an unspecified time'}.`,
    observedAt: p.observedAt,
    retrievedAt: p.retrievedAt,
    stale: p.stale,
  };
}
