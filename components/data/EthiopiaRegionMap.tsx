'use client';
import React, { useMemo, useRef, useState } from 'react';
import { Crosshair, Layers, MapPinned, Minus, MousePointerClick, Plus, RotateCcw } from 'lucide-react';

import { ProvenanceLabel, SourceUnavailable } from '@/components/data/ProvenanceLabel';
import type { ProvenanceView } from '@/components/data/ProvenanceLabel';
import { Loading, Metric, Panel, Refreshing, fmt, fmtInt } from '@/components/data/ui';
import { useLiveData } from '@/hooks/useLiveData';
import { useVectorLayers } from '@/hooks/useVectorLayers';

/**
 * The Ethiopia map: one SVG canvas in Web Mercator carrying four groups of real data —
 * a NASA GIBS composite underneath, vector layers from three ArcGIS REST services,
 * geoBoundaries outlines and WFP market points on top.
 *
 * Nothing here is drawn from a fixture. Every layer, count, colour, tolerance and
 * timestamp comes from `/api/data/*`, which reads it from the publisher at request time
 * or from a cached copy that is labelled as cached. When a publisher fails, that layer
 * is shown as unavailable with the publisher’s own reason, and no outline is invented.
 */

/* ------------------------------------------------------------------ *
 * Client mirrors of the route payloads. Structural on purpose: importing
 * `lib/data/*` here would pull server fetch code into the browser bundle.
 * ------------------------------------------------------------------ */

type Position = [number, number];

type FeatureGeometryView =
  | { kind: 'point'; longitude: number; latitude: number }
  | { kind: 'line'; paths: Position[][] }
  | { kind: 'polygon'; rings: Position[][] };

interface BBoxView {
  minLongitude: number;
  minLatitude: number;
  maxLongitude: number;
  maxLatitude: number;
}

interface FeatureView {
  sourceId: string;
  name: string | null;
  properties: Record<string, string | number | boolean | null>;
  geometry: FeatureGeometryView;
  bbox: BBoxView;
  centroid: { latitude: number; longitude: number };
}

interface VectorPayloadView {
  layerId: string;
  title: string;
  meaning: string;
  caveat: string;
  group: string;
  layerLabel: string;
  geometryKind: 'point' | 'polygon';
  color: string;
  features: FeatureView[];
  returned: number;
  outsideExtent: number;
  sourceCount: number;
  truncated: boolean;
  droppedNoGeometry: number;
  droppedUnplotable: number;
  vertices: number;
  pages: number;
  pageSize: number;
  featureLimit: number;
  offset: number;
  extentFiltered: boolean;
  toleranceDegrees: number;
  toleranceMeters: number;
  bbox: BBoxView;
  attributeNotes: string;
  vintageNote: string;
  publisherLayer: string;
}

interface VectorIndexView {
  id: string;
  title: string;
  meaning: string;
  caveat: string;
  group: string;
  layerLabel: string;
  geometryKind: 'point' | 'polygon';
  color: string;
  needsBbox: boolean;
  source: string;
  license: string;
  sourceUrl: string;
  vintage: string | null;
  vintageNote: string;
  attributeNotes: string;
  measuredCount: number;
  liveCount: number | null;
  status: 'available' | 'no_data' | 'unavailable';
  statusDetail: string | null;
  featureLimit: number;
  endpoint: string;
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
  bbox: BBoxView;
  rings: [number, number][][];
}

interface GeoPayload {
  places: Place[];
  default: Place;
  regionNames: string[];
  regions?: Region[];
}

/* ------------------------------------------------------------------ *
 * Projection and view geometry
 * ------------------------------------------------------------------ */

const TILE_SIZE = 256;
/** The viewBox is a fixed window in world pixels: zoom rescales it, pan translates it. */
const WINDOW = { w: TILE_SIZE * 2, h: 320 };
const MIN_ZOOM = 4;
const MAX_ZOOM = 10;
/** Ethiopia’s published extent, mirroring the envelope the API enforces on every query. */
const ENVELOPE = { minLongitude: 32.9, minLatitude: 3.3, maxLongitude: 48.1, maxLatitude: 15.1 };
const HOME = { longitude: 40.4, latitude: 8.9, zoom: 5 };
const DEFAULT_POINT = { latitude: 9.02, longitude: 38.75, label: 'Addis Ababa' };

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

interface View {
  longitude: number;
  latitude: number;
  zoom: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Keeps the centre inside a generous Horn-of-Africa box so a pan cannot lose the country. */
function clampView(view: View): View {
  return { longitude: clamp(view.longitude, 28, 54), latitude: clamp(view.latitude, -4, 22), zoom: Math.round(clamp(view.zoom, MIN_ZOOM, MAX_ZOOM)) };
}

function viewRectDeg(view: View): BBoxView {
  const x = xOf(view.longitude, view.zoom);
  const y = yOf(view.latitude, view.zoom);
  return {
    minLongitude: lonOf(x - WINDOW.w / 2, view.zoom),
    maxLongitude: lonOf(x + WINDOW.w / 2, view.zoom),
    maxLatitude: latOf(y - WINDOW.h / 2, view.zoom),
    minLatitude: latOf(y + WINDOW.h / 2, view.zoom),
  };
}

/**
 * The part of the view inside Ethiopia, or null once the view has left the country. The
 * API rejects an extent that cannot touch Ethiopia, so such a request is never sent.
 */
function clampedBbox(view: View): string | null {
  const rect = viewRectDeg(view);
  const minLongitude = Math.max(rect.minLongitude, ENVELOPE.minLongitude);
  const maxLongitude = Math.min(rect.maxLongitude, ENVELOPE.maxLongitude);
  const minLatitude = Math.max(rect.minLatitude, ENVELOPE.minLatitude);
  const maxLatitude = Math.min(rect.maxLatitude, ENVELOPE.maxLatitude);
  if (maxLongitude <= minLongitude || maxLatitude <= minLatitude) return null;
  return `${minLongitude.toFixed(3)},${minLatitude.toFixed(3)},${maxLongitude.toFixed(3)},${maxLatitude.toFixed(3)}`;
}

/** Coarser generalisation while zoomed out: an overview does not need every vertex. */
const detailFor = (zoom: number) => (zoom <= 5 ? 'overview' : zoom <= 7 ? 'standard' : 'detailed');

function featurePath(geometry: FeatureGeometryView, zoom: number): string {
  if (geometry.kind === 'point') return '';
  const rings = geometry.kind === 'polygon' ? geometry.rings : geometry.paths;
  const close = geometry.kind === 'polygon' ? ' Z' : '';
  return rings.map((ring) => ring.map(([lon, lat], i) => `${i === 0 ? 'M' : 'L'}${xOf(lon, zoom).toFixed(1)} ${yOf(lat, zoom).toFixed(1)}`).join(' ') + close).join(' ');
}

const GROUPS = ['hydrology', 'administrative', 'settlement'] as const;
const GROUP_LABEL: Record<string, string> = {
  hydrology: 'Hydrology · CDE',
  administrative: 'Administrative · EthioAdmin',
  settlement: 'Settlement · GRID3',
};

/* ------------------------------------------------------------------ *
 * Small shared bits
 * ------------------------------------------------------------------ */

const Chip = ({ tone, children }: { tone: 'live' | 'cached' | 'warn' | 'bad' | 'mute'; children: React.ReactNode }) => {
  const cls =
    tone === 'live'
      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400'
      : tone === 'cached'
        ? 'bg-gray-100 text-gray-600 dark:bg-zinc-800 dark:text-gray-400'
        : tone === 'warn'
          ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400'
          : tone === 'bad'
            ? 'bg-orange-50 text-orange-700 dark:bg-orange-900/20 dark:text-orange-400'
            : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400';
  return <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide ${cls}`}>{children}</span>;
};

const Swatch = ({ color, kind }: { color: string; kind: 'point' | 'polygon' }) => (
  <span
    aria-hidden
    className="inline-block shrink-0 border"
    style={
      kind === 'point'
        ? { width: 9, height: 9, borderRadius: 9999, background: color, borderColor: 'rgba(255,255,255,.85)' }
        : { width: 12, height: 9, background: `${color}26`, borderColor: color, borderRadius: 3 }
    }
  />
);

const stamp = (iso: string | null): string => {
  if (!iso) return 'never';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Addis_Ababa' }).format(new Date(t));
};

/* ------------------------------------------------------------------ *
 * The map
 * ------------------------------------------------------------------ */

export const EthiopiaRegionMap = () => {
  const [rasterId, setRasterId] = useState('VIIRS_SNPP_NDVI_8Day');
  const [view, setView] = useState<View>(HOME);
  /**
   * Requests read the *committed* view, not the one being dragged: panning would
   * otherwise re-download every dense layer on each mouse move. Drawing stays live.
   */
  const [committed, setCommitted] = useState<View>(HOME);
  const [enabled, setEnabled] = useState<Record<string, boolean>>({
    'geo-outlines': true,
    'geo-places': true,
    'cde-basin': true,
    'cde-dam': true,
    'grid3-urban-point': true,
  });
  const [point, setPoint] = useState<{ latitude: number; longitude: number; label: string }>(DEFAULT_POINT);
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ layerId: string; feature: FeatureView } | null>(null);
  const [tileFailure, setTileFailure] = useState(false);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; centerX: number; centerY: number; zoom: number; moved: boolean } | null>(null);
  /**
   * A drag releases over a click event, and that click must neither select nor sample.
   * The flag is cleared by the next pointerdown, so every gesture decides for itself:
   * drag → suppressed, plain click → allowed.
   */
  const suppressClick = useRef(false);

  const layers = useLiveData<LayersPayload>('/api/data/geospatial?view=layers');
  const geo = useLiveData<GeoPayload>('/api/data/locations?regions=1');
  const index = useLiveData<VectorIndexView[]>('/api/data/geospatial?view=vectors');

  const entries = useMemo(() => index.data ?? [], [index.data]);
  const raster = layers.data?.layers.find((l) => l.id === rasterId) ?? null;
  const sceneDate = raster?.latestAvailableDate ?? null;

  const active = useMemo(() => entries.filter((e) => enabled[e.id]), [entries, enabled]);
  const requests = useMemo(
    () =>
      active.map((e) => {
        const base = `/api/data/geospatial?view=vector&layer=${e.id}&detail=${detailFor(committed.zoom)}`;
        // Layers the publisher already scopes to Ethiopia need no extent; the dense ones
        // are read for the current view only.
        if (!e.needsBbox) return { key: e.id, path: base };
        const bbox = clampedBbox(committed);
        return { key: e.id, path: bbox === null ? null : `${base}&bbox=${bbox}` };
      }),
    [active, committed],
  );
  const slots = useVectorLayers<VectorPayloadView>(requests);
  const layerViews = useMemo(() => active.map((entry, i) => ({ entry, slot: slots[i] ?? null })), [active, slots]);

  const drawn = useMemo(() => {
    const shapes: { entryId: string; color: string; kind: 'point' | 'shape'; feature: FeatureView; d: string; x: number; y: number }[] = [];
    for (const { entry, slot } of layerViews) {
      const payload = slot?.data;
      if (!payload) continue;
      for (const feature of payload.features) {
        if (feature.geometry.kind === 'point') {
          shapes.push({ entryId: entry.id, color: entry.color, kind: 'point', feature, d: '', x: xOf(feature.geometry.longitude, view.zoom), y: yOf(feature.geometry.latitude, view.zoom) });
        } else {
          shapes.push({
            entryId: entry.id,
            color: entry.color,
            kind: 'shape',
            feature,
            d: featurePath(feature.geometry, view.zoom),
            x: xOf(feature.centroid.longitude, view.zoom),
            y: yOf(feature.centroid.latitude, view.zoom),
          });
        }
      }
    }
    return shapes;
  }, [layerViews, view.zoom]);

  const shapes = useMemo(() => drawn.filter((s) => s.kind === 'shape'), [drawn]);
  const dots = useMemo(() => drawn.filter((s) => s.kind === 'point'), [drawn]);

  const regions = useMemo(() => geo.data?.regions ?? [], [geo.data]);
  const places = useMemo(() => geo.data?.places ?? [], [geo.data]);
  const shownPlaces = useMemo(() => (selectedRegion ? places.filter((p) => p.admin1 === selectedRegion) : places).slice(0, 220), [places, selectedRegion]);

  const outlines = useMemo(
    () =>
      regions.map((r) => ({
        ...r,
        d: r.rings.map((ring) => ring.map(([lon, lat], i) => `${i === 0 ? 'M' : 'L'}${xOf(lon, view.zoom).toFixed(1)} ${yOf(lat, view.zoom).toFixed(1)}`).join(' ') + ' Z').join(' '),
      })),
    [regions, view.zoom],
  );

  const viewBox = `${xOf(view.longitude, view.zoom) - WINDOW.w / 2} ${yOf(view.latitude, view.zoom) - WINDOW.h / 2} ${WINDOW.w} ${WINDOW.h}`;

  /* Tiles are fetched at the composite’s own zoom ceiling and enlarged, so zooming past a
     coarse layer shows its real pixels bigger instead of failing. */
  const tileZoom = Math.min(view.zoom, raster?.maxZoom ?? view.zoom);
  const tileScale = 2 ** (view.zoom - tileZoom);
  const tiles = useMemo(() => {
    if (!raster || !sceneDate) return [];
    const x0 = xOf(view.longitude, view.zoom) - WINDOW.w / 2;
    const y0 = yOf(view.latitude, view.zoom) - WINDOW.h / 2;
    const span = TILE_SIZE * tileScale;
    const maxTile = 2 ** tileZoom;
    const list: { key: string; url: string; x: number; y: number }[] = [];
    for (let tx = Math.floor(x0 / span); tx <= Math.floor((x0 + WINDOW.w) / span); tx += 1) {
      for (let ty = Math.floor(y0 / span); ty <= Math.floor((y0 + WINDOW.h) / span); ty += 1) {
        if (tx < 0 || ty < 0 || tx >= maxTile || ty >= maxTile) continue;
        list.push({
          key: `${tileZoom}/${tx}/${ty}`,
          url: raster.tileUrlTemplate.replace('{date}', sceneDate).replace('{z}', String(tileZoom)).replace('{y}', String(ty)).replace('{x}', String(tx)),
          x: tx * span,
          y: ty * span,
        });
      }
    }
    return list;
  }, [raster, sceneDate, view.longitude, view.latitude, view.zoom, tileZoom, tileScale]);

  const samplePath = sceneDate
    ? `/api/data/geospatial?view=sample&layer=${rasterId}&lat=${point.latitude.toFixed(4)}&lon=${point.longitude.toFixed(4)}&date=${sceneDate}`
    : `/api/data/geospatial?view=sample&layer=${rasterId}&lat=${point.latitude.toFixed(4)}&lon=${point.longitude.toFixed(4)}`;
  const sample = useLiveData<SamplePayload>(samplePath);

  function coordinateFromEvent(event: React.MouseEvent): { latitude: number; longitude: number } | null {
    const svg = svgRef.current;
    if (!svg) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const pt = new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse());
    const latitude = latOf(pt.y, view.zoom);
    const longitude = lonOf(pt.x, view.zoom);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return { latitude, longitude };
  }

  function pickAt(event: React.MouseEvent) {
    if (suppressClick.current) return;
    const coords = coordinateFromEvent(event);
    if (!coords) return;
    setPoint({ ...coords, label: 'Selected coordinate' });
    setSelectedRegion(null);
    setSelected(null);
  }

  function onPointerDown(event: React.PointerEvent<SVGSVGElement>) {
    if (event.button !== 0) return;
    suppressClick.current = false;
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      centerX: xOf(view.longitude, view.zoom),
      centerY: yOf(view.latitude, view.zoom),
      zoom: view.zoom,
      moved: false,
    };
    svgRef.current?.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    const svg = svgRef.current;
    if (!drag || !svg) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    const ctm = svg.getScreenCTM();
    if (!ctm || ctm.a === 0) return;
    setView(clampView({ longitude: lonOf(drag.centerX - dx / ctm.a, drag.zoom), latitude: latOf(drag.centerY - dy / ctm.a, drag.zoom), zoom: drag.zoom }));
  }

  function onPointerUp(event: React.PointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    dragRef.current = null;
    const svg = svgRef.current;
    if (svg?.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    if (!drag?.moved) return;
    suppressClick.current = true;
    // The view the user stopped on is the extent the dense layers are read for. Each move
    // lands in its own task, so `view` here is already the panned position; and the server
    // snaps every extent onto a 0.25° grid, so a pixel of lag cannot change the request.
    setCommitted(view);
  }

  /* Both steps are written as relative updates. Reading `view` from the closing scope would
     give two clicks in the same task the same starting zoom, so the second click would be
     silently lost — and the committed extent would lag the drawn one by a level. */
  function zoomBy(delta: number, centre?: { longitude: number; latitude: number }) {
    const apply = (v: View) => clampView({ longitude: centre?.longitude ?? v.longitude, latitude: centre?.latitude ?? v.latitude, zoom: v.zoom + delta });
    setView(apply);
    setCommitted(apply);
  }

  function flyTo(centre: { longitude: number; latitude: number }, atLeastZoom: number) {
    const apply = (v: View) => clampView({ longitude: centre.longitude, latitude: centre.latitude, zoom: Math.max(v.zoom, atLeastZoom) });
    setView(apply);
    setCommitted(apply);
  }

  function onDoubleClick(event: React.MouseEvent) {
    const coords = coordinateFromEvent(event);
    if (coords) zoomBy(1, coords);
  }

  function selectFeature(entryId: string, feature: FeatureView) {
    if (suppressClick.current) return;
    setSelected({ layerId: entryId, feature });
    setSelectedRegion(null);
    setPoint({ ...feature.centroid, label: feature.name ?? 'Unnamed feature' });
  }

  function focusRegion(region: Region) {
    setSelectedRegion(region.name);
    setPoint({ ...region.centroid, label: region.name });
    flyTo({ longitude: region.centroid.longitude, latitude: region.centroid.latitude }, 6);
  }

  const selectedView = selected ? layerViews.find((l) => l.entry.id === selected.layerId) ?? null : null;
  const busy = layerViews.some((l) => l.slot?.loading || l.slot?.refreshing);
  const offViewLayers = layerViews.filter((l) => l.slot === null && l.entry.needsBbox);

  return (
    <div className="space-y-4 md:space-y-6">
      <header className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
          <MapPinned size={22} />
        </div>
        <div>
          <h1 className="text-2xl md:text-3xl font-black tracking-tight text-gray-900 dark:text-white uppercase">Ethiopia Geospatial</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Twelve vector layers from three ArcGIS services, geoBoundaries outlines and NASA GIBS composites on one canvas. Drag to pan, zoom with the controls or double-click,
            click any feature for its real attributes, and read each layer’s publisher, licence, vintage and retrieval time beside it.
          </p>
        </div>
      </header>

      <Panel
        title="Map"
        hint="Outlines are generalised for drawing and help you pick an area; they do not settle legal boundaries. Dense layers are served for the extent you are looking at, and the counts below say how much of the published layer that is."
        right={
          <div className="flex items-center gap-2 shrink-0">
            {busy && <Refreshing />}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => zoomBy(-1)}
                aria-label="Zoom out"
                className="w-7 h-7 rounded-lg bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 flex items-center justify-center text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-zinc-700"
              >
                <Minus size={14} />
              </button>
              <span className="text-[11px] font-black text-gray-600 dark:text-gray-300 tabular-nums w-14 text-center">zoom {view.zoom}</span>
              <button
                type="button"
                onClick={() => zoomBy(1)}
                aria-label="Zoom in"
                className="w-7 h-7 rounded-lg bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 flex items-center justify-center text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-zinc-700"
              >
                <Plus size={14} />
              </button>
              <button
                type="button"
                onClick={() => {
                  setView(HOME);
                  setCommitted(HOME);
                }}
                aria-label="Reset the view to all of Ethiopia"
                className="w-7 h-7 rounded-lg bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 flex items-center justify-center text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-zinc-700"
              >
                <RotateCcw size={13} />
              </button>
            </div>
          </div>
        }
      >
        <div className="space-y-3 mb-3">
          <div className="flex flex-wrap items-center gap-2">
            <Layers size={14} className="text-gray-400" />
            <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Satellite</span>
            {(layers.data?.layers ?? []).map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => {
                  setRasterId(l.id);
                  setTileFailure(false);
                }}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-black uppercase tracking-wider transition-colors ${
                  rasterId === l.id
                    ? 'bg-emerald-600 text-white'
                    : 'bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-zinc-700'
                }`}
              >
                {l.id.includes('NDVI') && l.id.includes('VIIRS') ? 'NDVI · VIIRS' : l.id.includes('NDVI') ? 'NDVI · MODIS' : 'Rain rate · IMERG'}
              </button>
            ))}
            {layers.loading && <span className="text-[11px] text-gray-400">reading GetCapabilities…</span>}
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Reference</span>
            <Toggle checked={enabled['geo-outlines'] ?? false} onChange={(v) => setEnabled((e) => ({ ...e, 'geo-outlines': v }))} label="geoBoundaries regions" color="#059669" kind="polygon" />
            <Toggle checked={enabled['geo-places'] ?? false} onChange={(v) => setEnabled((e) => ({ ...e, 'geo-places': v }))} label="WFP market centres" color="#0f172a" kind="point" />
            {index.loading && <span className="text-[11px] text-gray-400">asking each service whether it answers…</span>}
            {index.error && <span className="text-[11px] text-orange-600 dark:text-orange-400">Layer list unavailable: {index.error.message}</span>}
          </div>

          {GROUPS.map((group) => {
            const inGroup = entries.filter((e) => e.group === group);
            if (inGroup.length === 0) return null;
            return (
              <div key={group} className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">{GROUP_LABEL[group]}</span>
                {inGroup.map((e) => (
                  <Toggle
                    key={e.id}
                    checked={enabled[e.id] ?? false}
                    onChange={(v) => setEnabled((prev) => ({ ...prev, [e.id]: v }))}
                    label={e.title}
                    color={e.color}
                    kind={e.geometryKind}
                    note={e.status === 'available' ? fmtInt(e.liveCount ?? 0) : e.status === 'no_data' ? 'no records' : 'unavailable'}
                  />
                ))}
              </div>
            );
          })}
        </div>

        {raster && (
          <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed mb-3">
            <strong className="text-gray-600 dark:text-gray-300">{raster.title}</strong> — scene date {sceneDate ?? 'not confirmed'} · {raster.cadence} · {raster.resolution} ·
            values {raster.valueRange} ({raster.units}) · {raster.matrixSet}
            {tileZoom !== view.zoom ? `, tiles fetched at zoom ${tileZoom} and enlarged ${tileScale}× because this layer stops there` : ''}.{' '}
            {raster.availabilityError && `Availability check said: ${raster.availabilityError}.`}
          </p>
        )}
        {layers.error && (
          <div className="mb-3">
            <SourceUnavailable error={layers.error} source="NASA GIBS" />
          </div>
        )}

        <div className="relative rounded-xl overflow-hidden border border-gray-100 dark:border-zinc-800 bg-sky-50/40 dark:bg-zinc-950">
          <svg
            ref={svgRef}
            viewBox={viewBox}
            className="w-full aspect-[4/3] sm:aspect-[16/10] cursor-grab active:cursor-grabbing select-none touch-none"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onDoubleClick={onDoubleClick}
            onClick={pickAt}
            role="img"
            aria-label="Ethiopia map with satellite imagery, region outlines and toggleable vector layers"
          >
            {tiles.map((t) => (
              <image key={t.key} href={t.url} x={t.x} y={t.y} width={TILE_SIZE * tileScale} height={TILE_SIZE * tileScale} opacity={0.92} onError={() => setTileFailure(true)} />
            ))}

            {enabled['geo-outlines'] &&
              outlines.map((r) => (
                <path
                  key={r.id}
                  d={r.d}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (suppressClick.current) return;
                    setSelectedRegion(r.name);
                    setPoint({ ...r.centroid, label: r.name });
                  }}
                  fill={selectedRegion === r.name ? 'rgba(16,185,129,0.18)' : 'transparent'}
                  stroke="#059669"
                  strokeWidth={view.zoom >= 7 ? 0.6 : 1.1}
                  strokeOpacity={0.85}
                  vectorEffect="non-scaling-stroke"
                  className="cursor-pointer"
                >
                  <title>{`${r.name} — geoBoundaries ADM1 outline`}</title>
                </path>
              ))}

            {shapes.map((s) => {
              const hit = selected !== null && selected.layerId === s.entryId && selected.feature.sourceId === s.feature.sourceId;
              return (
                <path
                  key={`${s.entryId}-${s.feature.sourceId}`}
                  d={s.d}
                  onClick={(e) => {
                    e.stopPropagation();
                    selectFeature(s.entryId, s.feature);
                  }}
                  fill={s.color}
                  fillOpacity={hit ? 0.34 : 0.1}
                  stroke={s.color}
                  strokeWidth={hit ? 2 : 1}
                  strokeOpacity={0.9}
                  vectorEffect="non-scaling-stroke"
                  className="cursor-pointer"
                >
                  <title>{`${s.feature.name ?? s.entryId} · ${s.feature.sourceId}`}</title>
                </path>
              );
            })}

            {enabled['geo-places'] &&
              shownPlaces.map((p) => (
                <circle
                  key={`${p.admin1}-${p.name}`}
                  cx={xOf(p.longitude, view.zoom)}
                  cy={yOf(p.latitude, view.zoom)}
                  r={2.6}
                  fill="#0f172a"
                  fillOpacity={0.7}
                  stroke="#ffffff"
                  strokeWidth={0.8}
                  vectorEffect="non-scaling-stroke"
                  className="cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (suppressClick.current) return;
                    setSelectedRegion(p.admin1);
                    setPoint({ latitude: p.latitude, longitude: p.longitude, label: p.name });
                  }}
                >
                  <title>{`${p.name} — WFP market centre (${p.admin1})`}</title>
                </circle>
              ))}

            {dots.map((s) => {
              const hit = selected !== null && selected.layerId === s.entryId && selected.feature.sourceId === s.feature.sourceId;
              return (
                <circle
                  key={`${s.entryId}-${s.feature.sourceId}`}
                  cx={s.x}
                  cy={s.y}
                  r={hit ? 4 : 2.4}
                  fill={s.color}
                  stroke="#0b1220"
                  strokeOpacity={0.7}
                  strokeWidth={0.7}
                  vectorEffect="non-scaling-stroke"
                  className="cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    selectFeature(s.entryId, s.feature);
                  }}
                >
                  <title>{`${s.feature.name ?? 'Unnamed'} — ${s.entryId}`}</title>
                </circle>
              );
            })}

            <circle cx={xOf(point.longitude, view.zoom)} cy={yOf(point.latitude, view.zoom)} r={5} fill="none" stroke="#dc2626" strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
            <circle cx={xOf(point.longitude, view.zoom)} cy={yOf(point.latitude, view.zoom)} r={1.4} fill="#dc2626" />
          </svg>

          {tiles.length === 0 && !layers.loading && (
            <p className="absolute inset-0 flex items-center justify-center text-xs text-gray-500 bg-white/70 dark:bg-zinc-900/70">
              No confirmed scene date for this satellite layer, so no raster is drawn. The vector layers are still real.
            </p>
          )}
        </div>

        {tileFailure && (
          <p className="text-[11px] text-orange-600 dark:text-orange-400 mt-2 leading-relaxed">
            The tile service refused at least one tile for this date or zoom, so part of the raster is missing. Values sampled below come from tiles the server fetched
            successfully, and are unaffected.
          </p>
        )}

        {offViewLayers.length > 0 && (
          <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-2 leading-relaxed">
            {offViewLayers.map((l) => l.entry.title).join(', ')} {offViewLayers.length === 1 ? 'is' : 'are'} served for the view extent, and this view no longer overlaps
            Ethiopia, so nothing was requested for {offViewLayers.length === 1 ? 'it' : 'them'}. Pan back over the country to load real features.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-3 text-[11px] text-gray-500 dark:text-gray-400">
          <span className="flex items-center gap-2">
            <MousePointerClick size={13} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span>
              Reading at <strong>{point.label}</strong> ({point.latitude.toFixed(3)}, {point.longitude.toFixed(3)}) —{' '}
              {sample.data?.withinEthiopia ? 'inside Ethiopia’s published extent' : 'outside Ethiopia’s published extent'}.
            </span>
          </span>
          <span className="flex items-center gap-2">
            <Crosshair size={13} className="text-gray-400 shrink-0" />
            <span>
              View centre {view.latitude.toFixed(2)} N, {view.longitude.toFixed(2)} E · zoom {view.zoom} · vector layers requested at {detailFor(committed.zoom)} detail
              {offViewLayers.length > 0 ? ` · ${offViewLayers.length} extent layer(s) off-country` : ''}
            </span>
          </span>
        </div>
      </Panel>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title="Selected feature" hint="Click any outline, dot or region on the map. The attributes below are the publisher’s own fields, unmodified.">
          {selected === null ? (
            <div className="space-y-3">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Nothing selected yet. Records with no published name still carry the publisher’s feature id, so they can be cited exactly. Use the region list below to jump to
                an area.
              </p>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
                {enabled['geo-outlines'] ? `${regions.length} geoBoundaries areas and ${places.length} WFP market centres are on the map.` : 'Turn on the reference layers above to see geoBoundaries areas and WFP market centres.'}
              </p>
            </div>
          ) : (
            <FeatureInfo selected={selected} entry={selectedView?.entry ?? null} payload={selectedView?.slot?.data ?? null} provenance={selectedView?.slot?.provenance ?? null} />
          )}
        </Panel>

        <Panel title="Satellite read-out at this point" hint="One physical value taken from the published tile for this pixel, with the colour-map band the publisher uses for it.">
          {sample.loading && <Loading label="Fetching and decoding the tile pixel" />}
          {!sample.loading && sample.error && <SourceUnavailable error={sample.error} source="NASA GIBS" />}
          {sample.data && (
            <>
              <div className="flex items-baseline gap-2">
                <p className="text-3xl font-black text-gray-900 dark:text-white tracking-tight">{sample.data.value === null ? 'no value' : fmt(sample.data.value, 3)}</p>
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
        </Panel>
      </div>

      <Panel
        title="Regions and market centres"
        hint="geoBoundaries ADM1 outlines from the existing verified route, with the WFP market centres inside them. Click a row to fly the map there."
      >
        {geo.loading && <Loading label="Loading geoBoundaries outlines" />}
        {!geo.loading && geo.error && <SourceUnavailable error={geo.error} source="geoBoundaries" />}
        <div className="max-h-64 overflow-y-auto pr-1">
          <table className="w-full text-xs">
            <tbody>
              {regions.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => focusRegion(r)}
                  className={`cursor-pointer border-b border-gray-50 dark:border-zinc-800/60 ${
                    selectedRegion === r.name ? 'bg-emerald-50/70 dark:bg-emerald-950/20' : ''
                  }`}
                >
                  <td className="py-1.5 pr-3 font-semibold text-gray-800 dark:text-gray-200">{r.name}</td>
                  <td className="py-1.5 pr-3 text-[10px] text-gray-400 whitespace-nowrap">{r.id}</td>
                  <td className="py-1.5 pr-3 text-[10px] text-gray-400 whitespace-nowrap">
                    {places.filter((p) => p.admin1 === r.name).length} market centre(s)
                  </td>
                  <td className="py-1.5 text-[10px] text-gray-400 whitespace-nowrap text-right">
                    {r.centroid.latitude.toFixed(2)}, {r.centroid.longitude.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3">
          <ProvenanceLabel provenance={geo.provenance} context={selectedRegion ? `filtered to ${selectedRegion}` : undefined} />
        </div>
      </Panel>

      <Panel
        title="Layers on this map"
        hint="What is drawn now, how much of the published layer that is, and when the answer was fetched. Generalisation is our drawing decision, so its tolerance is stated in degrees and metres."
      >
        {index.loading && <Loading label="Reading the layer registry" />}
        {layerViews.length === 0 && !index.loading && <p className="text-sm text-gray-500 dark:text-gray-400">No vector layer is switched on. Turn one on above.</p>}
        <ul className="divide-y divide-gray-50 dark:divide-zinc-800/60">
          {layerViews.map(({ entry, slot }) => (
            <li key={entry.id} className="py-3 flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <Swatch color={entry.color} kind={entry.geometryKind} />
                <span className="text-xs font-black text-gray-800 dark:text-gray-200">{entry.title}</span>
                {entry.status === 'available' && <Chip tone="live">publisher answers</Chip>}
                {entry.status === 'no_data' && <Chip tone="warn">no records</Chip>}
                {entry.status === 'unavailable' && <Chip tone="bad">unavailable</Chip>}
                {slot?.data && <Chip tone="mute">{slot.data.extentFiltered ? 'this extent only' : 'whole layer'}</Chip>}
                {slot?.data?.truncated && <Chip tone="warn">partial view</Chip>}
                {slot?.provenance?.servedFromCache && <Chip tone="cached">cached copy</Chip>}
              </div>

              {slot?.loading && <span className="text-[11px] text-gray-400">reading this layer from {entry.source}…</span>}
              {slot?.refreshing && <span className="text-[11px] text-gray-400">re-reading for the current extent…</span>}
              {slot === null && entry.needsBbox && <span className="text-[11px] text-amber-700 dark:text-amber-400">This view is outside Ethiopia, so no request was made for this layer.</span>}
              {slot?.error && (
                <p className="text-[11px] text-orange-700 dark:text-orange-400 leading-relaxed">
                  {entry.source}: {slot.error.message}
                </p>
              )}

              {slot?.data && (
                <>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
                    <strong className="text-gray-600 dark:text-gray-300">{fmtInt(slot.data.returned)}</strong> of{' '}
                    {slot.data.sourceCount >= 0 ? fmtInt(slot.data.sourceCount) : 'an uncounted number of'} published features
                    {slot.data.extentFiltered ? ' in this extent' : ' (the whole published layer)'} · {slot.data.pages} page(s) of {slot.data.pageSize} · {fmtInt(slot.data.vertices)}{' '}
                    vertices · tolerance {slot.data.toleranceDegrees === 0 ? 'none (points carry no lines)' : `${slot.data.toleranceDegrees}° (~${fmtInt(slot.data.toleranceMeters)} m)`}
                    {slot.data.outsideExtent > 0 ? ` · ${slot.data.outsideExtent} record(s) outside Ethiopia’s envelope, kept and counted` : ''}
                    {slot.data.droppedNoGeometry + slot.data.droppedUnplotable > 0
                      ? ` · not drawn: ${slot.data.droppedNoGeometry} without geometry, ${slot.data.droppedUnplotable} not drawable at this detail`
                      : ''}
                  </p>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
                    <strong className="text-gray-600 dark:text-gray-300">What it means:</strong> {slot.data.meaning}
                  </p>
                  <p className="text-[11px] text-orange-700 dark:text-orange-400 leading-relaxed">
                    <strong>What it does not mean:</strong> {slot.data.caveat}
                  </p>
                  <ProvenanceLabel provenance={slot.provenance} context={`answered ${stamp(slot.answeredAt)} · ${entry.source} layer ${slot.data.publisherLayer}`} />
                </>
              )}
            </li>
          ))}
        </ul>

        {raster && (
          <div className="mt-4 pt-3 border-t border-gray-50 dark:border-zinc-800/60">
            <div className="flex flex-wrap items-center gap-2">
              <Swatch color="#16a34a" kind="polygon" />
              <span className="text-xs font-black text-gray-800 dark:text-gray-200">{raster.title}</span>
              <Chip tone={sceneDate ? 'live' : 'bad'}>{sceneDate ? `scene ${sceneDate}` : 'no confirmed scene'}</Chip>
              <Chip tone="mute">{raster.resolution}</Chip>
              <Chip tone="mute">{raster.cadence}</Chip>
              <Chip tone={layers.provenance?.servedFromCache ? 'cached' : 'live'}>{layers.provenance?.servedFromCache ? 'cached list' : 'live list'}</Chip>
            </div>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1.5 leading-relaxed">
              <strong className="text-gray-600 dark:text-gray-300">What it means:</strong> {raster.meaning}
            </p>
            <p className="text-[11px] text-orange-700 dark:text-orange-400 leading-relaxed">
              <strong>What it does not mean:</strong> {raster.caveat}
            </p>
            <ProvenanceLabel provenance={layers.provenance} context={`values ${raster.valueRange} ${raster.units} · licence: ${raster.license}`} />
          </div>
        )}
      </Panel>

      <Panel
        title="Every layer offered"
        hint="One cheap count query per layer, answered by the request this panel is built from — the chip below says whether the server answered it from its own cache, which it may for up to six hours. A service that is down is marked before anyone clicks it, and the live count is the publisher’s own, not ours."
      >
        {index.loading && <Loading label="Measuring each service" />}
        {index.error && <SourceUnavailable error={index.error} source="ArcGIS feature services" />}
        {index.data && (
          <div className="overflow-x-auto">
            <div className="flex flex-wrap items-center gap-2 pb-2">
              <Chip tone={index.provenance?.servedFromCache ? 'cached' : 'live'}>{index.provenance?.servedFromCache ? 'cached counts' : 'counts from this request'}</Chip>
              {index.provenance?.retrievedAt && (
                <span className="text-[10px] text-gray-400 tabular-nums">upstream at {index.provenance.retrievedAt.replace('T', ' ').replace(/\.\d+Z$/, ' UTC')}</span>
              )}
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] font-black uppercase tracking-widest text-gray-400">
                  <th className="py-2 pr-3">Layer</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3 text-right">Live count</th>
                  <th className="py-2 pr-3 text-right">Measured</th>
                  <th className="py-2 pr-3">Publisher</th>
                  <th className="py-2 pr-3">Vintage</th>
                  <th className="py-2">Licence</th>
                </tr>
              </thead>
              <tbody>
                {index.data.map((e) => (
                  <tr key={e.id} className="border-t border-gray-50 dark:border-zinc-800/60 align-top">
                    <td className="py-2 pr-3">
                      <span className="flex items-center gap-2">
                        <Swatch color={e.color} kind={e.geometryKind} />
                        <span className="font-semibold text-gray-800 dark:text-gray-200">{e.title}</span>
                      </span>
                      <span className="block text-[10px] text-gray-400 mt-0.5">
                        {e.layerLabel}
                        {e.needsBbox ? ' · served per view extent' : ''}
                      </span>
                    </td>
                    <td className="py-2 pr-3">
                      {e.status === 'available' ? <Chip tone="live">available</Chip> : e.status === 'no_data' ? <Chip tone="warn">no records</Chip> : <Chip tone="bad">unavailable</Chip>}
                      {e.statusDetail && <span className="block text-[10px] text-orange-700 dark:text-orange-400 mt-1 max-w-56 leading-relaxed">{e.statusDetail}</span>}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-gray-700 dark:text-gray-300">{e.liveCount === null ? '—' : fmtInt(e.liveCount)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-gray-500">{fmtInt(e.measuredCount)}</td>
                    <td className="py-2 pr-3">
                      <a
                        href={e.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline decoration-gray-300 text-gray-700 dark:text-gray-300 hover:text-emerald-600 dark:hover:text-emerald-400"
                      >
                        {e.source}
                      </a>
                    </td>
                    <td className="py-2 pr-3 text-gray-500">
                      {e.vintage ?? 'not published'}
                      <span className="block text-[10px] text-gray-400 mt-0.5 max-w-48 leading-relaxed">{e.vintageNote}</span>
                    </td>
                    <td className="py-2 text-gray-500 max-w-64 leading-relaxed">{e.license}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Metric label="Layers offered" value={String(entries.length || '—')} />
        <Metric label="On the map" value={String(layerViews.length)} />
        <Metric label="Features drawn" value={String(drawn.length)} />
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

const Toggle = ({
  checked,
  onChange,
  label,
  color,
  kind,
  note,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  color: string;
  kind: 'point' | 'polygon';
  note?: string;
}) => (
  <label className="flex items-center gap-1.5 cursor-pointer select-none">
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="w-3.5 h-3.5 accent-emerald-600" />
    <span className="flex items-center gap-1.5 text-[11px] font-bold text-gray-700 dark:text-gray-300">
      <Swatch color={color} kind={kind} />
      {label}
    </span>
    {note && <span className="text-[10px] text-gray-400 tabular-nums">{note}</span>}
  </label>
);

/** The attribute read-out for one clicked feature. */
const FeatureInfo = ({
  selected,
  entry,
  payload,
  provenance,
}: {
  selected: { layerId: string; feature: FeatureView };
  entry: VectorIndexView | null;
  payload: VectorPayloadView | null;
  provenance: ProvenanceView | null;
}) => {
  const feature = selected.feature;
  const fields = Object.entries(feature.properties);

  return (
    <div className="space-y-3">
      <div>
        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{entry?.title ?? selected.layerId}</p>
        <p className="text-lg font-black text-gray-900 dark:text-white tracking-tight leading-tight mt-0.5">{feature.name ?? 'Unnamed feature'}</p>
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
          publisher feature id <code className="font-mono">{feature.sourceId}</code> · {feature.geometry.kind}
          {payload ? ` · from ${payload.publisherLayer}` : ''}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div className="p-2 rounded-lg bg-gray-50 dark:bg-zinc-800/60">
          <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Centroid</p>
          <p className="text-gray-700 dark:text-gray-300 tabular-nums mt-0.5">
            {feature.centroid.latitude.toFixed(4)} N, {feature.centroid.longitude.toFixed(4)} E
          </p>
        </div>
        <div className="p-2 rounded-lg bg-gray-50 dark:bg-zinc-800/60">
          <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Own extent</p>
          <p className="text-gray-700 dark:text-gray-300 tabular-nums mt-0.5 leading-relaxed">
            {feature.bbox.minLatitude.toFixed(3)}–{feature.bbox.maxLatitude.toFixed(3)} N · {feature.bbox.minLongitude.toFixed(3)}–{feature.bbox.maxLongitude.toFixed(3)} E
          </p>
        </div>
      </div>

      {fields.length === 0 ? (
        <p className="text-[11px] text-gray-500 dark:text-gray-400">The publisher stores no attributes for this record beyond its id and its shape.</p>
      ) : (
        <div className="rounded-xl border border-gray-100 dark:border-zinc-800 overflow-hidden">
          <table className="w-full text-[11px]">
            <tbody>
              {fields.map(([key, value]) => (
                <tr key={key} className="border-b border-gray-50 dark:border-zinc-800/60 last:border-0">
                  <th scope="row" className="text-left py-1.5 px-2.5 font-bold text-gray-500 dark:text-gray-400 whitespace-nowrap align-top">
                    {key}
                  </th>
                  <td className="py-1.5 px-2.5 text-gray-800 dark:text-gray-200 tabular-nums break-words">
                    {value === null || value === '' ? <span className="text-gray-400">not stated</span> : String(value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(entry?.attributeNotes ?? payload?.attributeNotes) && (
        <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
          <strong className="text-gray-600 dark:text-gray-300">About these fields:</strong> {entry?.attributeNotes ?? payload?.attributeNotes}
        </p>
      )}
      {entry && (
        <p className="text-[11px] text-orange-700 dark:text-orange-400 leading-relaxed">
          <strong>What it does not mean:</strong> {entry.caveat}
        </p>
      )}
      {entry && (
        <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
          <strong>Licence:</strong> {entry.license}
        </p>
      )}
      {payload && (
        <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
          <strong>Vintage:</strong> {entry?.vintage ?? 'not published'} — {payload.vintageNote}. A reference dataset’s vintage is not an observation date.
        </p>
      )}

      <ProvenanceLabel provenance={provenance} />
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
        <Metric label="Window" value={agro.data?.window.days ? `${agro.data.window.days} d` : '—'} />
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
