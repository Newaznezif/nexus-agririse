import { cachedFetch } from './cache';
import { httpBytes, httpText } from './http';
import { decodeIndexedPng } from './pngIndex';
import { provenanceFor, SOURCES } from './sources';
import type { ConnectorResult, GeospatialLayer, SatelliteSample, SourceError } from './types';

/**
 * NASA GIBS serves real satellite composites as Web-Mercator tiles, and publishes
 * the colour map that turns a tile's palette index back into a physical value.
 * That pair is enough to report an actual NDVI or precipitation-rate figure for a
 * coordinate, which is what this module does.
 *
 * Two limits are stated in the layer definitions rather than hidden: the products
 * are composites with a publication lag, and the sampling footprint is the tile
 * pixel (hundreds of metres), not the farmer's plot.
 */

const GIBS_BASE = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';
const EQUATOR_PIXEL_METERS = 156_543.033_928_041;

export const GIBS_LAYERS: GeospatialLayer[] = [
  {
    id: 'VIIRS_SNPP_NDVI_8Day',
    title: 'Vegetation greenness (NDVI, rolling 8-day, VIIRS / Suomi NPP)',
    meaning:
      'Normalised Difference Vegetation Index: how strongly living green vegetation is absorbing red light and reflecting near-infrared. Higher means denser, greener canopy.',
    caveat:
      'NDVI is a canopy signal, not a yield or soil measurement. Cloud contamination, bare soil and dormant crops all move it. Do not read it as “how much grain” or “soil fertility”.',
    source: 'NASA GIBS (VIIRS, Suomi NPP)',
    sourceUrl: 'https://worldview.earthdata.nasa.gov/',
    license: 'NASA EOSDIS open data; cite the sensor and product',
    resolution: 'Tile matrix GoogleMapsCompatible_Level8: ~612 m per pixel at the equator at zoom 8',
    cadence: 'Rolling 8-day composite, published with a lag of a few days',
    tileUrlTemplate: `${GIBS_BASE}/VIIRS_SNPP_NDVI_8Day/default/{date}/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png`,
    matrixSet: 'GoogleMapsCompatible_Level8',
    minZoom: 0,
    maxZoom: 8,
    latestAvailableDate: null,
    valueRange: 'Approximately -0.3 to 1.0 (unitless)',
    units: 'NDVI (unitless index)',
    valueKind: 'observed',
  },
  {
    id: 'MODIS_Terra_NDVI_8Day',
    title: 'Vegetation greenness (NDVI, 8-day composite, MODIS Terra)',
    meaning:
      'The Terra MODIS 8-day NDVI composite, the longer-running counterpart of the VIIRS product and the one behind the pre-2020 trend record.',
    caveat:
      'Same canopy caveats as VIIRS, and the two sensors are not calibrated to be numerically identical; compare each with itself over time rather than mixing series.',
    source: 'NASA GIBS (MODIS, Terra)',
    sourceUrl: 'https://worldview.earthdata.nasa.gov/',
    license: 'NASA EOSDIS open data; cite the sensor and product',
    resolution: 'Tile matrix GoogleMapsCompatible_Level9: ~306 m per pixel at the equator at zoom 9',
    cadence: '8-day composite, published weekly with a lag',
    tileUrlTemplate: `${GIBS_BASE}/MODIS_Terra_NDVI_8Day/default/{date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.png`,
    matrixSet: 'GoogleMapsCompatible_Level9',
    minZoom: 0,
    maxZoom: 9,
    latestAvailableDate: null,
    valueRange: 'Approximately -0.3 to 1.0 (unitless)',
    units: 'NDVI (unitless index)',
    valueKind: 'observed',
  },
  {
    id: 'IMERG_Precipitation_Rate',
    title: 'Precipitation rate (GPM IMERG)',
    meaning:
      'Satellite-retrieved rain rate in millimetres per hour for the composite window, blending GPM constellation microwave passes with infrared estimates.',
    caveat:
      'A blended satellite retrieval at ~0.1° with a several-hour window. It is not a rain-gauge reading and light rain in highlands is the case it misses most.',
    source: 'NASA GIBS (GPM IMERG)',
    sourceUrl: 'https://worldview.earthdata.nasa.gov/',
    license: 'NASA EOSDIS open data; cite GPM IMERG',
    resolution: 'Tile matrix GoogleMapsCompatible_Level6: ~2.4 km per pixel at the equator at zoom 6',
    cadence: 'Near-real-time composite, roughly 4-hourly to daily latency',
    tileUrlTemplate: `${GIBS_BASE}/IMERG_Precipitation_Rate/default/{date}/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png`,
    matrixSet: 'GoogleMapsCompatible_Level6',
    minZoom: 0,
    maxZoom: 6,
    latestAvailableDate: null,
    valueRange: '0.1 to 100 mm/h (log colour scale)',
    units: 'mm/h',
    valueKind: 'modeled',
  },
];

const COLORMAP_BY_LAYER: Record<string, string> = {
  VIIRS_SNPP_NDVI_8Day: 'https://gibs.earthdata.nasa.gov/colormaps/v1.3/MODIS_NDVI.xml',
  MODIS_Terra_NDVI_8Day: 'https://gibs.earthdata.nasa.gov/colormaps/v1.3/MODIS_NDVI.xml',
  IMERG_Precipitation_Rate: 'https://gibs.earthdata.nasa.gov/colormaps/v1.3/GPM_Precipitation_Rate.xml',
};

export function getLayer(id: string): GeospatialLayer | undefined {
  return GIBS_LAYERS.find((l) => l.id === id);
}

/** Standard slippy-map maths for EPSG:3857 tile matrices. */
export function latLonToTileXY(latitude: number, longitude: number, zoom: number): { x: number; y: number } {
  const n = 2 ** zoom;
  const x = Math.floor(((longitude + 180) / 360) * n);
  const rad = (latitude * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
  return { x: Math.min(n - 1, Math.max(0, x)), y: Math.min(n - 1, Math.max(0, y)) };
}

export function groundPixelMeters(latitude: number, zoom: number): number {
  return (EQUATOR_PIXEL_METERS / 2 ** zoom) * Math.cos((latitude * Math.PI) / 180);
}

export function buildTileUrl(layer: GeospatialLayer, date: string, zoom: number, x: number, y: number): string {
  return layer.tileUrlTemplate
    .replace('{date}', date)
    .replace('{z}', String(zoom))
    .replace('{y}', String(y))
    .replace('{x}', String(x));
}

export interface ColorMapEntry {
  rgb: string;
  /**
   * The tile palette index the publisher assigns to this colour. GIBS writes the
   * `ref` attribute itself, so index lookup is more reliable than matching the
   * RGB string, which stays as a fallback.
   */
  ref: number | null;
  paletteOrder: number;
  sourceMin: number | null;
  sourceMax: number | null;
  valueMin: number | null;
  valueMax: number | null;
  band: string;
  nodata: boolean;
}

export interface ParsedColorMap {
  entries: ColorMapEntry[];
  byRgb: Map<string, ColorMapEntry>;
  byRef: Map<number, ColorMapEntry>;
  /** Entries that represent real data, in ascending value order. */
  scaleTitle: string | null;
}

/** Exported for tests: GIBS publishes the colour map as XML. */
export function parseColorMap(xml: string): ParsedColorMap {
  // Published files put stray whitespace before the tag's closing bracket, e.g.
  // `<ColorMap title="Vegetation Indices" >`, so the attribute sweep is tolerant.
  const blocks = [...xml.matchAll(/<ColorMap\b[^>]*title="([^"]*)"[^>]*>([\s\S]*?)<\/ColorMap>/g)];
  const entries: ColorMapEntry[] = [];
  const byRgb = new Map<string, ColorMapEntry>();
  const byRef = new Map<number, ColorMapEntry>();
  let order = 0;
  let scaleTitle: string | null = null;

  for (const block of blocks) {
    const title = block[1];
    const isDataMap = !/no data|bad data|missing data|blend|transparent|overview/i.test(title);
    if (isDataMap && !scaleTitle) scaleTitle = title;

    for (const raw of [...block[2].matchAll(/<ColorMapEntry([^>]*)\/>/g)]) {
      const attrs = raw[1];
      const get = (name: string) => (attrs.match(new RegExp(`${name}="([^"]*)"`)) ?? [])[1];
      const rgb = (get('rgb') ?? '').replace(/\s+/g, '');
      const valueRange = get('value') ?? '';
      const sourceRange = get('sourceValue') ?? '';
      const parseRange = (s: string): [number | null, number | null] => {
        const m = s.match(/^\[?\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)/);
        return m ? [Number(m[1]), Number(m[2])] : [null, null];
      };
      const [valueMin, valueMax] = parseRange(valueRange);
      const [sourceMin, sourceMax] = parseRange(sourceRange);
      const refRaw = get('ref');
      const ref = refRaw === undefined || !/^\d+$/.test(refRaw) ? null : Number(refRaw);
      const entry: ColorMapEntry = {
        rgb,
        ref,
        paletteOrder: order++,
        sourceMin,
        sourceMax,
        valueMin,
        valueMax,
        band: valueRange.replace(/[[\]()]/g, '') || get('tooltip') || 'unknown',
        // Fill and bad pixels are marked both explicitly (nodata) and by declaring
        // the colour transparent; either one means "no measurement here".
        nodata: get('nodata') === 'true' || get('transparent') === 'true' || !isDataMap,
      };
      entries.push(entry);
      if (!byRgb.has(rgb)) byRgb.set(rgb, entry);
      if (ref !== null && !byRef.has(ref)) byRef.set(ref, entry);
    }
  }

  return { entries, byRgb, byRef, scaleTitle };
}

async function getColorMap(layerId: string): Promise<ParsedColorMap | null> {
  const url = COLORMAP_BY_LAYER[layerId];
  if (!url) return null;
  const outcome = await cachedFetch<ParsedColorMap>(`gibs:cmap:${url}`, 7 * 86400, async () => {
    const res = await httpText(url, { timeoutMs: 20_000 });
    if (!res.ok) return { ok: false, error: res.error };
    const map = parseColorMap(res.text);
    if (map.entries.length === 0) return { ok: false, error: { code: 'parse_failed', message: 'Colour map yielded no entries' } };
    return { ok: true, value: map };
  });
  return outcome.value.ok ? outcome.value.value : null;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * GIBS answers 404 for a date the product has not published yet, so the cheapest
 * truthful way to find the newest scene is to ask, working backwards. Bounded and
 * cached per layer; the found date is what gets displayed.
 */
export async function findLatestLayerDate(layer: GeospatialLayer, maxLookbackDays = 20): Promise<ConnectorResult<string>> {
  const outcome = await cachedFetch<string>(`gibs:latest:${layer.id}`, 6 * 3600, async () => {
    const today = new Date();
    for (let back = 1; back <= maxLookbackDays; back += 1) {
      const date = isoDate(new Date(today.getTime() - back * 86_400_000));
      const url = buildTileUrl(layer, date, layer.minZoom, 0, 0);
      const res = await httpBytes(url, { timeoutMs: 12_000, retries: 0, maxBytes: 8 * 1024 * 1024, method: 'GET' });
      if (res.ok) return { ok: true, value: date };
      // 404/400 with a tile matrix we control means "no scene for that date".
      if (res.error.code !== 'http_status' && res.error.code !== 'rate_limited') {
        return { ok: false, error: res.error };
      }
    }
    return { ok: false, error: { code: 'no_data', message: `No published scene within ${maxLookbackDays} days` } };
  });

  const built = outcome.value;
  if (!built.ok) {
    return {
      ok: false,
      error: built.error,
      provenance: provenanceFor(SOURCES.nasaGibs, {
        endpoint: layer.tileUrlTemplate,
        observedAt: null,
        valueKind: layer.valueKind,
        units: layer.units,
        methodology: layer.meaning,
        coverage: 'Global',
        quality: 'low',
      }),
    };
  }

  return {
    ok: true,
    data: built.value,
    provenance: provenanceFor(SOURCES.nasaGibs, {
      endpoint: layer.tileUrlTemplate,
      observedAt: built.value,
      valueKind: layer.valueKind,
      units: layer.units,
      methodology: layer.meaning,
      coverage: 'Global composite',
      servedFromCache: outcome.servedFromCache,
      retrievedAt: new Date(outcome.storedAt).toISOString(),
    }),
  };
}

export interface SampleRequest {
  layerId: string;
  latitude: number;
  longitude: number;
  /** Override the sampled tile date; defaults to the newest published scene. */
  date?: string;
  /** Defaults to the layer's maximum zoom, which is the finest pixel available. */
  zoom?: number;
}

function sampleFailure(error: SourceError, layer: GeospatialLayer): ConnectorResult<SatelliteSample> {
  return {
    ok: false,
    error,
    provenance: provenanceFor(SOURCES.nasaGibs, {
      endpoint: layer.tileUrlTemplate,
      observedAt: null,
      valueKind: layer.valueKind,
      units: layer.units,
      methodology: layer.meaning,
      coverage: 'Global',
      quality: 'low',
    }),
  };
}

/** Read one physical value out of the published composite for a coordinate. */
export async function sampleLayerAtCoordinate(req: SampleRequest): Promise<ConnectorResult<SatelliteSample>> {
  const layer = getLayer(req.layerId);
  if (!layer) return sampleFailure({ code: 'bad_input', message: `Unknown geospatial layer: ${req.layerId}` }, { ...GIBS_LAYERS[0], id: 'unknown' });

  if (!Number.isFinite(req.latitude) || !Number.isFinite(req.longitude) || Math.abs(req.latitude) > 85.06) {
    return sampleFailure({ code: 'bad_input', message: 'Coordinate is outside the Web-Mercator coverage of this layer' }, layer);
  }

  const zoom = Math.max(layer.minZoom, Math.min(layer.maxZoom, req.zoom ?? layer.maxZoom));

  let date = req.date;
  if (!date) {
    const found = await findLatestLayerDate(layer);
    if (!found.ok) return sampleFailure(found.error, layer);
    date = found.data;
  }

  const { x, y } = latLonToTileXY(req.latitude, req.longitude, zoom);
  const url = buildTileUrl(layer, date, zoom, x, y);

  const tileOutcome = await cachedFetch<Uint8Array>(`gibs:tile:${layer.id}:${date}:${zoom}:${x}:${y}`, 6 * 3600, async () => {
    const res = await httpBytes(url, { timeoutMs: 20_000, maxBytes: 8 * 1024 * 1024 });
    if (!res.ok) return { ok: false, error: res.error };
    return { ok: true, value: res.bytes };
  });

  const tile = tileOutcome.value;
  if (!tile.ok) return sampleFailure(tile.error, layer);

  const decoded = decodeIndexedPng(tile.value);
  if (!decoded.ok) return sampleFailure({ code: 'parse_failed', message: decoded.reason }, layer);

  const image = decoded.image;
  // The requested coordinate is inside the tile, so convert it to a pixel offset.
  const n = 2 ** zoom;
  const fractionalX = (((req.longitude + 180) / 360) * n - x) * image.width;
  const rad = (req.latitude * Math.PI) / 180;
  const fractionalY = (((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n - y) * image.height;
  const px = Math.min(image.width - 1, Math.max(0, Math.floor(fractionalX)));
  const py = Math.min(image.height - 1, Math.max(0, Math.floor(fractionalY)));

  const paletteIndex = image.indices[py * image.width + px];
  const color = image.palette[paletteIndex];
  if (!color) return sampleFailure({ code: 'parse_failed', message: 'Tile palette is missing the sampled index' }, layer);

  const alpha = image.alpha[paletteIndex] ?? 255;
  const map = await getColorMap(layer.id);
  const rgbKey = `${color.r},${color.g},${color.b}`;
  // The publisher's own `ref` is the tile palette index, so it is the primary
  // lookup; the RGB string is the fallback when a file omits it.
  const entry = map?.byRef.get(paletteIndex) ?? map?.byRgb.get(rgbKey) ?? null;

  const isNoData = alpha === 0 || (entry?.nodata ?? false) || !entry;
  const midpoint =
    entry && entry.valueMin !== null && entry.valueMax !== null ? (entry.valueMin + entry.valueMax) / 2 : null;

  return {
    ok: true,
    data: {
      layerId: layer.id,
      tileDate: date,
      latitude: req.latitude,
      longitude: req.longitude,
      value: isNoData ? null : midpoint === null ? null : Math.round(midpoint * 10000) / 10000,
      band: entry ? entry.band : 'not in published colour map',
      pixelSizeMeters: Math.round(groundPixelMeters(req.latitude, zoom)),
      quality: isNoData ? 'low' : 'medium',
    },
    provenance: provenanceFor(SOURCES.nasaGibs, {
      endpoint: url,
      observedAt: date,
      valueKind: layer.valueKind,
      units: layer.units,
      // Name the quantisation explicitly: the colour map gives a band, not a
      // continuous reading, so a pixel reports an interval rather than a number.
      methodology: `${layer.meaning} Retrieved by decoding the published ${layer.matrixSet} tile for this coordinate and mapping its palette colour back through NASA’s published colour map, which yields a value band; the reported figure is that band’s midpoint. ${layer.caveat}`,
      coverage: `${req.latitude.toFixed(4)}, ${req.longitude.toFixed(4)} — one ${Math.round(groundPixelMeters(req.latitude, zoom))} m pixel`,
      quality: isNoData ? 'low' : 'medium',
      servedFromCache: tileOutcome.servedFromCache,
      retrievedAt: new Date(tileOutcome.storedAt).toISOString(),
    }),
  };
}
