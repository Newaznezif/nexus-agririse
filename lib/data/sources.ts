import type { ConnectorResult, Provenance, SourceDescriptor, SourceError, SourceErrorCode, SourceState, ValueKind } from './types';

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
  ethioAdminBoundaries: {
    id: 'ethio-admin-boundaries-arcgis',
    name: 'Ethiopia AdminBoundaries (Ethiopia.GeoPortal on ArcGIS Online)',
    category: 'geospatial',
    homeUrl: 'https://www.arcgis.com/home/item.html?id=5fbc3698295e4a97a015219849ed35ad',
    // Measured: the item record carries no licenseInfo, and the service’s own
    // copyrightText names the Ethiopia Humanitarian Response portal. Attribution is
    // therefore required while redistribution permission is not established — the
    // difference is stated in the UI rather than assumed away.
    license: 'No licence stated by the publisher; service attribution reads "ethiopia.humanitarianresponse.info". Redistribution is not established.',
    cadence: 'irregular',
    requiresKey: false,
  },
  grid3Ethiopia: {
    id: 'grid3-ethiopia-arcgis',
    name: 'GRID3 Ethiopia Social Distancing Layers v1.0 (WorldPop/GRID3)',
    category: 'geospatial',
    homeUrl: 'https://www.arcgis.com/home/item.html?id=672a9cbb360b4c809b684768ffb5645d',
    license: 'CC BY 4.0, as stated in the publisher’s own item record ("These data may be redistributed following the terms of a Creative Commons Attribution 4.0 International (CC BY 4.0) license")',
    cadence: 'irregular',
    requiresKey: false,
  },
  cdeEthiopia: {
    id: 'cde-ethiopia-hydrology-arcgis',
    name: 'CDE (University of Bern) Ethiopia hydrology map services',
    category: 'geospatial',
    homeUrl: 'https://gis.cde.unibe.ch/gis/rest/services/',
    // Measured: copyrightText is empty on all four services and no licence page is
    // served with them, so the only defensible claim is the publisher’s identity.
    license: 'Licence not stated by the server; shown for reading with attribution to the Centre for Development and Environment (CDE), University of Bern. Redistribution is not established.',
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
  /**
   * When this process last received bytes for the payload being described. Omitting it means
   * "the call is happening right now", which is what a connector should pass only when it is
   * about to make that call: a cached answer must carry its own stored time, or the UI reads a
   * three-day-old file as a fresh one.
   */
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

/**
 * Error codes where the publisher sent us nothing that could be called a payload. `no_data` and
 * `bad_input` are deliberately absent: there the file really was read (or no request was ever
 * made), so the copy's own retrieval time stands. `parse_failed` is absent for the same reason —
 * bytes arrived, they were just unusable.
 */
const NO_PAYLOAD: readonly SourceErrorCode[] = ['publisher_blocked', 'empty_response', 'network', 'timeout', 'rate_limited', 'http_status', 'payload_too_large', 'auth_required', 'not_configured'];

/**
 * Strips the fetch claim from a provenance that describes a non-answer.
 *
 * `provenanceFor` defaults `retrievedAt` to "now" because a connector that just read bytes has no
 * stored copy to quote — the right answer beside a payload, and a fabrication beside a refusal.
 * Rather than trusting every connector to remember that, the two places that publish a failure
 * (the data routes' error envelope and `evidenceOf`, where a connector outcome becomes report
 * evidence) run the outcome through here. `stale` becomes true because a request that received
 * nothing is not current by any reading, and `servedFromCache` false because no copy was served.
 */
export function nonAnswerProvenance(provenance: Provenance, error: SourceError): Provenance {
  if (!NO_PAYLOAD.includes(error.code)) return provenance;
  return { ...provenance, retrievedAt: null, stale: true, servedFromCache: false };
}

/**
 * What an unavailable source owes the reader, assembled once so no panel can improvise a
 * softer version of the same sentence.
 *
 * The three fields the brief asks an outage to carry — which publisher, why, and when it last
 * worked — are exactly what a bare `{ ok: false, error }` loses, because `error.message`
 * describes the HTTP event rather than the situation. `lastSuccessfulFetchAt` is deliberately
 * narrower than it looks: it is when *this server process* last got a usable answer, and `null`
 * when it never has. It is never the publisher's own publication date, and no UI should render
 * it as though it were.
 */
export interface UnavailableNotice {
  publisher: string;
  publisherUrl: string;
  reason: SourceErrorCode;
  /** `reason` in one plain sentence, written so it can be read aloud to a farmer. */
  reasonDetail: string;
  lastSuccessfulFetchAt: string | null;
  /** Always false, and always present: an unavailable figure is never quietly taken from elsewhere. */
  substituteUsed: false;
}

/**
 * `no_data` is stated separately from the transport failures on purpose: there the publisher
 * answered and the file was read, so the honest message is "this scope has no rows", not
 * "the source is down". Conflating them would send a user to a different publisher when the
 * right answer is a different market or commodity.
 */
function reasonDetail(code: SourceErrorCode): string {
  switch (code) {
    case 'publisher_blocked':
      return 'The publisher still shows the file, but its download endpoint refuses requests from this server, so no row can be read here. No approved alternative publisher is configured for this series, so nothing is shown in its place.';
    case 'empty_response':
      return 'The publisher answered the request but sent no content. No approved alternative publisher is configured for this series, so nothing is shown in its place.';
    case 'auth_required':
      return 'This source needs credentials that are not configured on this server.';
    case 'no_data':
      return 'The publisher answered and the file was read; it simply holds no rows for the market, commodity or period asked for. Nothing was widened, backfilled or substituted to produce a number.';
    case 'not_configured':
      return 'No publisher is configured for this series yet, so it cannot be shown as live.';
    case 'timeout':
      return 'This server asked the publisher and got no answer before its deadline. The figures below are not held back to some earlier value — there is no value for this request.';
    case 'rate_limited':
      return 'The publisher asked us to slow down, so this request carries no rows.';
    default:
      return 'The publisher did not return a usable file for this request, so this figure has no source and is not shown.';
  }
}

/** `null` when the source answered: there is nothing to declare unavailable. */
export function unavailableNotice(
  source: SourceDescriptor,
  result: ConnectorResult<unknown>,
  lastSuccessMs: number | null,
): UnavailableNotice | null {
  if (result.ok) return null;
  return {
    publisher: source.name,
    publisherUrl: source.homeUrl,
    reason: result.error.code,
    reasonDetail: reasonDetail(result.error.code),
    lastSuccessfulFetchAt: lastSuccessMs === null ? null : new Date(lastSuccessMs).toISOString(),
    substituteUsed: false,
  };
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
