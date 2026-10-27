'use client';
import React, { useMemo, useRef, useState } from 'react';
import { MousePointerClick, Layers, MapPinned } from 'lucide-react';

import { ProvenanceLabel, SourceUnavailable } from '@/components/data/ProvenanceLabel';
import { Loading, Metric, Panel, Refreshing, fmt } from '@/components/data/ui';
import { useLiveData } from '@/hooks/useLiveData';

interface Place {
  name: string;
  admin1: string;
  admin2: string;
  latitude: number;
  longitude: number;
}

interface Region {
  id: string;
  name: string;
  level: number;
  centroid: { latitude: number; longitude: number };
  bbox: { minLatitude: number; minLongitude: number; maxLatitude: number; maxLongitude: number };
  rings: [number, number][][];
}

interface GeoPayload {
  places: Place[];
  default: Place;
  regionNames: string[];
  regions?: Region[];
}

interface LayerInfo {
  id: string;
  title: string;
  meaning: string;
  caveat: string;
  source: string;
  sourceUrl: string;
  license: string;
  resolution: string;
  cadence: string;
  tileUrlTemplate: string;
  matrixSet: string;
  minZoom: number;
  maxZoom: number;
  latestAvailableDate: string | null;
  availabilityError: string | null;
  valueRange: string;
  units: string;
  valueKind: string;
}

interface LayersPayload {
  layers: LayerInfo[];
}

interface SamplePayload {
  layerId: string;
  tileDate: string;
  latitude: number;
  longitude: number;
  value: number | null;
  band: string | null;
  pixelSizeMeters: number;
  quality: string;
  layer: { title: string; meaning: string; caveat: string; units: string; cadence: string; resolution: string } | null;
  withinEthiopia: boolean;
}

const TILE_SIZE = 256;
/** Ethiopia’s published extent, with a margin so the outlines are never clipped. */
const VIEW = { minLon: 32.4, maxLon: 49.8, minLat: 2.2, maxLat: 15.8 };

const worldPx = (z: number) => TILE_SIZE * 2 ** z;
const xOf = (lon: number, z: number) => ((lon + 180) / 360) * worldPx(z);
const yOf = (lat: number, z: number) => {
  const rad = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * worldPx(z);
};
const lonOf = (x: number, z: number) => (x / worldPx(z)) * 360 - 180;
const latOf = (y: number, z: number) => {
  const n = Math.PI - (2 * Math.PI * y) / worldPx(z);
  return (Math.atan(Math.sinh(n)) * 180) / Math.PI;
};

const DEFAULT_POINT = { latitude: 9.02, longitude: 38.75, label: 'Addis Ababa' };

export const EthiopiaRegionMap = () => {
  const [layerId, setLayerId] = useState('VIIRS_SNPP_NDVI_8Day');
  const [zoom, setZoom] = useState(5);
  const [point, setPoint] = useState(DEFAULT_POINT);
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [tileFailure, setTileFailure] = useState(false);

  const layers = useLiveData<LayersPayload>('/api/data/geospatial?view=layers');
  const geo = useLiveData<GeoPayload>('/api/data/locations?regions=1');

  const layer = layers.data?.layers.find((l) => l.id === layerId) ?? null;
  const effectiveZoom = Math.min(zoom, layer?.maxZoom ?? zoom);
  const sceneDate = layer?.latestAvailableDate ?? null;

  const samplePath = sceneDate
    ? `/api/data/geospatial?view=sample&layer=${layerId}&lat=${point.latitude.toFixed(4)}&lon=${point.longitude.toFixed(4)}&date=${sceneDate}`
    : `/api/data/geospatial?view=sample&layer=${layerId}&lat=${point.latitude.toFixed(4)}&lon=${point.longitude.toFixed(4)}`;
  const sample = useLiveData<SamplePayload>(samplePath);

  const viewRect = useMemo(() => {
    const x0 = xOf(VIEW.minLon, effectiveZoom);
    const x1 = xOf(VIEW.maxLon, effectiveZoom);
    const y0 = yOf(VIEW.maxLat, effectiveZoom);
    const y1 = yOf(VIEW.minLat, effectiveZoom);
    return { x0, y0, w: x1 - x0, h: y1 - y0 };
  }, [effectiveZoom]);

  const tiles = useMemo(() => {
    if (!layer || !sceneDate) return [];
    const tx0 = Math.floor(viewRect.x0 / TILE_SIZE);
    const tx1 = Math.floor((viewRect.x0 + viewRect.w) / TILE_SIZE);
    const ty0 = Math.floor(viewRect.y0 / TILE_SIZE);
    const ty1 = Math.floor((viewRect.y0 + viewRect.h) / TILE_SIZE);
    const list: { key: string; url: string; x: number; y: number }[] = [];
    for (let tx = tx0; tx <= tx1; tx += 1) {
      for (let ty = ty0; ty <= ty1; ty += 1) {
        list.push({
          key: `${tx}-${ty}`,
          url: layer.tileUrlTemplate
            .replace('{date}', sceneDate)
            .replace('{z}', String(effectiveZoom))
            .replace('{y}', String(ty))
            .replace('{x}', String(tx)),
          x: tx * TILE_SIZE,
          y: ty * TILE_SIZE,
        });
      }
    }
    return list;
  }, [layer, sceneDate, effectiveZoom, viewRect]);

  const regions = useMemo(() => geo.data?.regions ?? [], [geo.data]);

  const regionPaths = useMemo(
    () =>
      regions.map((r) => ({
        ...r,
        d: r.rings
          .map((ring) =>
            ring
              .map(([lon, lat], i) => `${i === 0 ? 'M' : 'L'}${xOf(lon, effectiveZoom).toFixed(1)} ${yOf(lat, effectiveZoom).toFixed(1)}`)
              .join(' ') + ' Z',
          )
          .join(' '),
      })),
    [regions, effectiveZoom],
  );

  function coordinateFromEvent(event: React.MouseEvent): { latitude: number; longitude: number } | null {
    const svg = svgRef.current;
    if (!svg) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const pt = new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse());
    const latitude = latOf(pt.y, effectiveZoom);
    const longitude = lonOf(pt.x, effectiveZoom);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return { latitude, longitude };
  }

  function pickAt(event: React.MouseEvent, label?: string) {
    const coords = coordinateFromEvent(event);
    if (!coords) return;
    setPoint({ ...coords, label: label ?? 'Selected coordinate' });
    if (!label) setSelectedRegion(null);
  }

  const places = useMemo(() => geo.data?.places ?? [], [geo.data]);
  const shownPlaces = useMemo(() => {
    const wanted = selectedRegion ? places.filter((p) => p.admin1 === selectedRegion) : places;
    return wanted.slice(0, 220);
  }, [places, selectedRegion]);

  return (
    <div className="space-y-4 md:space-y-6">
      <header className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
          <MapPinned size={22} />
        </div>
        <div>
          <h1 className="text-2xl md:text-3xl font-black tracking-tight text-gray-900 dark:text-white uppercase">Ethiopia Geospatial</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Administrative outlines from geoBoundaries over NASA GIBS satellite composites. Clicking the map reads a real value out of the published tile for
            that pixel, and every layer states its scene date, its meaning and its limits.
          </p>
        </div>
      </header>

      <Panel
        title="Map"
        hint="Outlines are simplified exterior rings; they are drawn to help you pick an area, not to settle a boundary."
        right={
          <div className="flex items-center gap-2 shrink-0">
            {(sample.refreshing || layers.refreshing) && <Refreshing />}
            <select
              aria-label="Zoom"
              value={String(zoom)}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="text-[11px] font-bold bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-lg px-2 py-1 text-gray-700 dark:text-gray-300"
            >
              {[4, 5, 6].map((z) => (
                <option key={z} value={z}>
                  zoom {z}
                </option>
              ))}
            </select>
          </div>
        }
      >
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <Layers size={14} className="text-gray-400" />
          {(layers.data?.layers ?? []).map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => {
                setLayerId(l.id);
                setTileFailure(false);
              }}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-black uppercase tracking-wider transition-colors ${
                layerId === l.id
                  ? 'bg-emerald-600 text-white'
                  : 'bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-zinc-700'
              }`}
            >
              {l.id.includes('NDVI') && l.id.includes('VIIRS')
                ? 'NDVI · VIIRS'
                : l.id.includes('NDVI')
                  ? 'NDVI · MODIS'
                  : 'Rain rate · IMERG'}
            </button>
          ))}
          {layers.loading && <span className="text-[11px] text-gray-400">reading GetCapabilities…</span>}
        </div>

        {layer && (
          <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed mb-3">
            <strong className="text-gray-600 dark:text-gray-300">{layer.title}</strong> — scene date{' '}
            {sceneDate ?? 'not confirmed'} · {layer.cadence} · {layer.resolution} · values {layer.valueRange} ({layer.units}) ·{' '}
            {layer.matrixSet}
            {layer.maxZoom !== effectiveZoom ? `, tile drawn at zoom ${effectiveZoom} (this layer’s ceiling)` : ''}.{' '}
            {layer.availabilityError && `Availability check said: ${layer.availabilityError}.`}
          </p>
        )}
        {layers.error && <div className="mb-3"><SourceUnavailable error={layers.error} source="NASA GIBS" /></div>}

        <div className="relative rounded-xl overflow-hidden border border-gray-100 dark:border-zinc-800 bg-sky-50/40 dark:bg-zinc-950">
          <svg
            ref={svgRef}
            viewBox={`${viewRect.x0} ${viewRect.y0} ${viewRect.w} ${viewRect.h}`}
            className="w-full h-[420px] md:h-[520px] cursor-crosshair select-none"
            onClick={(e) => pickAt(e)}
            role="img"
            aria-label="Ethiopia map with satellite layer and region outlines"
          >
            {tiles.map((t) => (
              <image
                key={t.key}
                href={t.url}
                x={t.x}
                y={t.y}
                width={TILE_SIZE}
                height={TILE_SIZE}
                opacity={0.92}
                onError={() => setTileFailure(true)}
              />
            ))}

            {regionPaths.map((r) => (
              <path
                key={r.id}
                d={r.d}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedRegion(r.name);
                  const coords = coordinateFromEvent(e);
                  setPoint(coords ? { ...coords, label: r.name } : { ...r.centroid, label: r.name });
                }}
                fill={selectedRegion === r.name ? 'rgba(16,185,129,0.18)' : 'transparent'}
                stroke="#059669"
                strokeWidth={effectiveZoom >= 6 ? 0.6 : 1.1}
                strokeOpacity={0.85}
                vectorEffect="non-scaling-stroke"
                className="cursor-pointer"
              >
                <title>{`${r.name} — click to read the satellite value here`}</title>
              </path>
            ))}

            {shownPlaces.map((p) => (
              <circle
                key={`${p.admin1}-${p.name}`}
                cx={xOf(p.longitude, effectiveZoom)}
                cy={yOf(p.latitude, effectiveZoom)}
                r={2.6}
                fill="#0f172a"
                fillOpacity={0.7}
                stroke="#ffffff"
                strokeWidth={0.8}
                vectorEffect="non-scaling-stroke"
                className="cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedRegion(p.admin1);
                  setPoint({ latitude: p.latitude, longitude: p.longitude, label: p.name });
                }}
              >
                <title>{`${p.name} — WFP market centre (${p.admin1})`}</title>
              </circle>
            ))}

            <circle cx={xOf(point.longitude, effectiveZoom)} cy={yOf(point.latitude, effectiveZoom)} r={5} fill="none" stroke="#dc2626" strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
            <circle cx={xOf(point.longitude, effectiveZoom)} cy={yOf(point.latitude, effectiveZoom)} r={1.4} fill="#dc2626" />
          </svg>

          {tiles.length === 0 && !layers.loading && (
            <p className="absolute inset-0 flex items-center justify-center text-xs text-gray-500 bg-white/70 dark:bg-zinc-900/70">
              No confirmed scene date for this layer, so no satellite raster is drawn. The outlines below are still real.
            </p>
          )}
        </div>

        {tileFailure && (
          <p className="text-[11px] text-orange-600 dark:text-orange-400 mt-2 leading-relaxed">
            The tile service refused at least one tile for this date or zoom, so part of the raster is missing. Values sampled below come from tiles the server
            fetched successfully, and are unaffected.
          </p>
        )}

        <div className="flex items-center gap-2 mt-3 text-[11px] text-gray-500 dark:text-gray-400">
          <MousePointerClick size={13} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span>
            Reading at <strong>{point.label}</strong> ({point.latitude.toFixed(3)}, {point.longitude.toFixed(3)}) —{' '}
            {sample.data?.withinEthiopia ? 'inside Ethiopia’s published extent' : 'outside Ethiopia’s published extent'}.
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
          <div className="rounded-xl border border-gray-100 dark:border-zinc-800 p-4">
            {sample.loading && <Loading label="Fetching and decoding the tile pixel" />}
            {!sample.loading && sample.error && <SourceUnavailable error={sample.error} source="NASA GIBS" />}
            {sample.data && (
              <>
                <div className="flex items-baseline gap-2">
                  <p className="text-3xl font-black text-gray-900 dark:text-white tracking-tight">
                    {sample.data.value === null ? 'no value' : fmt(sample.data.value, 3)}
                  </p>
                  <span className="text-xs font-semibold text-gray-400">{sample.data.layer?.units}</span>
                </div>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1.5 leading-relaxed">
                  {sample.data.band
                    ? `The publisher’s colour map places this pixel in the band “${sample.data.band}”. `
                    : 'This pixel is fill/nodata in the published colour map, so no value is claimed. '}
                  Scene date {sample.data.tileDate} · pixel footprint ≈ {fmt(sample.data.pixelSizeMeters, 0)} m across · quality {sample.data.quality}.
                </p>
                {sample.data.layer && (
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-2 leading-relaxed">
                    <strong className="text-gray-600 dark:text-gray-300">What it means:</strong> {sample.data.layer.meaning}
                  </p>
                )}
                {sample.data.layer && (
                  <p className="text-[11px] text-orange-700 dark:text-orange-400 mt-1.5 leading-relaxed">
                    <strong>What it does not mean:</strong> {sample.data.layer.caveat}
                  </p>
                )}
                <div className="mt-3">
                  <ProvenanceLabel provenance={sample.provenance} />
                </div>
              </>
            )}
          </div>

          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">
              Regions{selectedRegion ? ` · filtered to ${selectedRegion}` : ` · ${regions.length} published areas`}
            </p>
            {geo.loading && <Loading label="Loading geoBoundaries outlines" />}
            {!geo.loading && geo.error && <SourceUnavailable error={geo.error} source="geoBoundaries" />}
            <div className="max-h-64 overflow-y-auto pr-1">
              <table className="w-full text-xs">
                <tbody>
                  {regions.map((r) => (
                    <tr
                      key={r.id}
                      onClick={() => {
                        setSelectedRegion(r.name);
                        setPoint({ ...r.centroid, label: r.name });
                      }}
                      className={`cursor-pointer border-b border-gray-50 dark:border-zinc-800/60 ${
                        selectedRegion === r.name ? 'bg-emerald-50/70 dark:bg-emerald-950/20' : ''
                      }`}
                    >
                      <td className="py-1.5 pr-3 font-semibold text-gray-800 dark:text-gray-200">{r.name}</td>
                      <td className="py-1.5 pr-3 text-[10px] text-gray-400 whitespace-nowrap">{r.id}</td>
                      <td className="py-1.5 text-[10px] text-gray-400 whitespace-nowrap text-right">
                        {r.centroid.latitude.toFixed(2)}, {r.centroid.longitude.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3">
              <ProvenanceLabel provenance={geo.provenance} />
            </div>
          </div>
        </div>
      </Panel>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Metric label="Areas outlined" value={String(regions.length || '—')} />
        <Metric label="Market centres" value={String(places.length || '—')} />
        <Metric label="Tiles drawn" value={String(tiles.length)} />
        <Metric label="Scene date" value={sceneDate ?? '—'} />
      </div>

      <Panel
        title="Drought and agro-climate risk for this point"
        hint="Same coordinate as the map, different sources: NASA POWER rainfall against its own 30-year normals, plus the greenness the satellite actually saw."
      >
        <RiskStrip point={point} />
      </Panel>
    </div>
  );
};

/** Compact risk read-out that reuses the agroclimate route for the selected point. */
const RiskStrip = ({ point }: { point: { latitude: number; longitude: number; label: string } }) => {
  const agro = useLiveData<{
    window: { days: number; start: string; end: string };
    derived: {
      period: string;
      observedMm: number;
      expectedMm: number;
      anomalyPct: number | null;
      daysWithData: number;
      daysRequested: number;
      sufficientCoverage: boolean;
    } | null;
  }>(`/api/data/agroclimate?lat=${point.latitude.toFixed(4)}&lon=${point.longitude.toFixed(4)}&days=60`);

  if (agro.loading) return <Loading label="Comparing rainfall with climatology" />;
  if (agro.error) return <SourceUnavailable error={agro.error} source="NASA POWER" />;

  const d = agro.data?.derived ?? null;
  const tone = d === null || d.anomalyPct === null ? undefined : d.anomalyPct <= -25 ? 'bad' : d.anomalyPct >= 15 ? 'good' : 'warn';

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Metric label="Point" value={agro.data?.window.days ? `${agro.data.window.days} d` : '—'} />
        <Metric label="Rain observed" value={d ? fmt(d.observedMm, 1) : '—'} unit="mm" />
        <Metric label="Rain expected" value={d ? fmt(d.expectedMm, 1) : '—'} unit="mm" />
        <Metric label="Anomaly" value={d?.anomalyPct === null || !d ? '—' : `${d.anomalyPct > 0 ? '+' : ''}${fmt(d.anomalyPct, 0)}`} unit="%" tone={tone} />
      </div>
      <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
        {d
          ? `Computed for ${d.period} from ${d.daysWithData}/${d.daysRequested} days with data. ${
              d.sufficientCoverage
                ? 'A shortfall this large in a 60-day window is the signal the Ethiopian rain-fed maize calendar treats as a moisture stress episode — it is not a yield estimate.'
                : 'Coverage is too sparse to present this as a season total; treat the anomaly as indicative only.'
            }`
          : 'The climatology baseline is unavailable for this cell, so no anomaly is computed.'}
      </p>
      <div>
        <ProvenanceLabel provenance={agro.provenance} />
      </div>
    </div>
  );
};
