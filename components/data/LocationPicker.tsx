'use client';
import React, { useEffect, useMemo, useState } from 'react';
import { MapPin } from 'lucide-react';

export interface SelectedPlace {
  name: string;
  admin1: string | null;
  admin2: string | null;
  latitude: number;
  longitude: number;
}

interface PlaceRow {
  name: string;
  admin1: string;
  admin2: string;
  latitude: number;
  longitude: number;
}

interface LocationsPayload {
  places: PlaceRow[];
  default: PlaceRow;
}

/**
 * Location selection for the Ethiopian data views.
 *
 * The list is not a hardcoded array in the bundle: it comes from `/api/data/locations`,
 * which is generated from WFP's own market reference table, so a chosen town always
 * carries the publisher's coordinates and its region/zone labels. A typed coordinate
 * is offered separately and is labelled as the user's own point.
 */
export const LocationPicker = ({
  value,
  onChange,
  label = 'Location',
}: {
  value: SelectedPlace;
  onChange: (place: SelectedPlace) => void;
  label?: string;
}) => {
  const [places, setPlaces] = useState<PlaceRow[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [lat, setLat] = useState(String(value.latitude));
  const [lon, setLon] = useState(String(value.longitude));

  useEffect(() => {
    let cancelled = false;
    fetch('/api/data/locations', { headers: { accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { data: LocationsPayload }) => {
        if (!cancelled) setPlaces(body.data.places);
      })
      .catch(() => {
        if (!cancelled) setFailed('Location list could not be loaded; the coordinate box still works.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const grouped = useMemo(() => {
    const byRegion = new Map<string, PlaceRow[]>();
    for (const p of places ?? []) {
      const list = byRegion.get(p.admin1);
      if (list) list.push(p);
      else byRegion.set(p.admin1, [p]);
    }
    return [...byRegion.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [places]);

  const isCustom = !places?.some((p) => p.name === value.name);

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-100 dark:border-zinc-800 shadow-sm p-4 md:p-5">
      <div className="flex flex-col md:flex-row md:items-end gap-4">
        <div className="flex-1">
          <label htmlFor="market-place" className="text-xs font-black uppercase tracking-widest text-gray-400">
            {label}
          </label>
          <div className="mt-1.5 flex items-center gap-2">
            <MapPin size={16} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
            <select
              id="market-place"
              value={isCustom ? '__custom__' : value.name}
              onChange={(e) => {
                const found = places?.find((p) => p.name === e.target.value);
                if (!found) return;
                setLat(String(found.latitude));
                setLon(String(found.longitude));
                onChange({ name: found.name, admin1: found.admin1, admin2: found.admin2, latitude: found.latitude, longitude: found.longitude });
              }}
              className="w-full bg-transparent text-sm font-semibold text-gray-900 dark:text-white focus:outline-none"
            >
              {isCustom && <option value="__custom__">Custom coordinate</option>}
              {grouped.length === 0 && <option>{value.name}</option>}
              {grouped.map(([region, list]) => (
                <optgroup key={region} label={region}>
                  {list.map((p) => (
                    <option key={`${region}-${p.name}`} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        </div>

        <div className="md:w-auto">
          <span className="text-xs font-black uppercase tracking-widest text-gray-400">Own coordinates</span>
          <div className="mt-1.5 flex items-center gap-2">
            <input
              aria-label="Latitude"
              inputMode="decimal"
              value={lat}
              onChange={(e) => setLat(e.target.value)}
              className="w-24 px-2 py-1.5 rounded-lg text-sm bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 text-gray-900 dark:text-white"
            />
            <input
              aria-label="Longitude"
              inputMode="decimal"
              value={lon}
              onChange={(e) => setLon(e.target.value)}
              className="w-24 px-2 py-1.5 rounded-lg text-sm bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 text-gray-900 dark:text-white"
            />
            <button
              type="button"
              onClick={() => {
                const latitude = Number(lat);
                const longitude = Number(lon);
                if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return;
                onChange({ name: 'Selected coordinate', admin1: null, admin2: null, latitude, longitude });
              }}
              className="px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider bg-emerald-600 text-white hover:bg-emerald-500 transition-colors"
            >
              Go
            </button>
          </div>
        </div>
      </div>

      <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-3">
        {value.admin1
          ? `${value.name} — ${value.admin1}${value.admin2 ? ` · ${value.admin2}` : ''} (${value.latitude.toFixed(3)}, ${value.longitude.toFixed(3)}). Region and zone names are as published by WFP.`
          : `${value.name} (${value.latitude.toFixed(3)}, ${value.longitude.toFixed(3)}) — your own point, so no administrative names are attached.`}
      </p>
      {failed && <p className="text-[11px] text-orange-600 dark:text-orange-400 mt-1">{failed}</p>}
    </div>
  );
};
