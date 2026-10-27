'use client';
import React, { useMemo, useState } from 'react';
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CloudSun, Satellite, Sprout } from 'lucide-react';

import { LocationPicker, type SelectedPlace } from '@/components/data/LocationPicker';
import { ProvenanceLabel, SourceUnavailable } from '@/components/data/ProvenanceLabel';
import { SourceStatusPanel } from '@/components/data/SourceStatusPanel';
import { Loading, Metric, Panel, Refreshing, dayLabel, fmt } from '@/components/data/ui';
import { useLiveData, type LiveDataState } from '@/hooks/useLiveData';

const ADDIS: SelectedPlace = {
  name: 'Addis Ababa',
  admin1: 'Addis Ababa',
  admin2: 'Addis Ababa',
  latitude: 9.02,
  longitude: 38.75,
};

/** Catalogue places are addressed by name so the publisher's own coordinates and region labels are used. */
function locationParams(place: SelectedPlace): string {
  return place.admin1
    ? `place=${encodeURIComponent(place.name)}`
    : `lat=${place.latitude.toFixed(4)}&lon=${place.longitude.toFixed(4)}`;
}

/**
 * A tile sample is read out of a pixel, so it needs a coordinate: the route rejects a place
 * name for `view=sample` rather than guessing which of two markets of the same name was meant.
 */
function coordinateParams(place: SelectedPlace): string {
  return `lat=${place.latitude.toFixed(4)}&lon=${place.longitude.toFixed(4)}`;
}

interface CurrentWeather {
  observedAt: string;
  temperatureC: number | null;
  relativeHumidityPct: number | null;
  precipitationMm: number | null;
  windSpeedKmh: number | null;
  weatherCode: number | null;
}

interface DailyRow {
  date: string;
  isForecast: boolean;
  precipitationSumMm: number | null;
  precipitationProbabilityMaxPct: number | null;
  temperatureMaxC: number | null;
  temperatureMinC: number | null;
  relativeHumidityMeanPct: number | null;
  windSpeedMaxKmh: number | null;
  et0Mm: number | null;
}

interface WeatherPayload {
  location: { name: string; admin1: string | null; admin2: string | null; latitude: number; longitude: number };
  timezone: string;
  elevationM: number | null;
  current: CurrentWeather | null;
  daily: DailyRow[];
  withinEthiopia: boolean;
}

interface AgroRow {
  date: string;
  temperatureMaxC: number | null;
  temperatureMinC: number | null;
  relativeHumidityPct: number | null;
  windSpeedMs: number | null;
  precipitationMm: number | null;
  shortwaveRadiationMjPerM2: number | null;
}

interface AgroPayload {
  location: WeatherPayload['location'];
  daily: AgroRow[];
  normals: { month: string; parameter: string; units: string; value: number | null }[];
  window: { start: string; end: string; days: number };
  annualNormalMmPerDay: number | null;
  normalsUnavailableReason: string | null;
  derived: {
    period: string;
    observedMm: number;
    expectedMm: number;
    anomalyPct: number | null;
    daysWithData: number;
    daysRequested: number;
    sufficientCoverage: boolean;
    valueKind: 'estimated';
  } | null;
}

interface SamplePayload {
  layerId: string;
  tileDate: string;
  latitude: number;
  longitude: number;
  value: number | null;
  band: string | null;
  pixelSizeMeters: number;
  layer: { title: string; meaning: string; caveat: string; units: string; cadence: string; resolution: string } | null;
  withinEthiopia: boolean;
}

export const ClimateMonitor = () => {
  const [place, setPlace] = useState<SelectedPlace>(ADDIS);
  const base = locationParams(place);

  const weather = useLiveData<WeatherPayload>(`/api/data/weather?${base}&days=7&pastDays=7`);
  const agro = useLiveData<AgroPayload>(`/api/data/agroclimate?${base}&days=45`);
  const coords = coordinateParams(place);
  const ndvi = useLiveData<SamplePayload>(`/api/data/geospatial?view=sample&layer=VIIRS_SNPP_NDVI_8Day&${coords}`);
  const imerg = useLiveData<SamplePayload>(`/api/data/geospatial?view=sample&layer=IMERG_Precipitation_Rate&${coords}`);

  const daily = useMemo(() => weather.data?.daily ?? [], [weather.data]);
  const observed = daily.filter((d) => !d.isForecast);
  const forecast = daily.filter((d) => d.isForecast);
  const firstForecastDay = forecast[0]?.date;

  const chartRows = useMemo(
    () =>
      daily.map((d) => ({
        day: dayLabel(d.date),
        'Rain, observed': d.isForecast ? null : d.precipitationSumMm,
        'Rain, forecast': d.isForecast ? d.precipitationSumMm : null,
        'Max °C': d.temperatureMaxC,
        'Min °C': d.temperatureMinC,
      })),
    [daily],
  );

  const agroDays = agro.data?.daily ?? [];
  const rainSeries = agroDays.map((d) => ({ day: dayLabel(d.date), 'Rain mm': d.precipitationMm }));
  const normalPerDay = agro.data?.annualNormalMmPerDay ?? null;

  const current = weather.data?.current ?? null;
  const todayEt0 = daily.find((d) => d.date === new Date().toISOString().slice(0, 10))?.et0Mm ?? forecast[0]?.et0Mm ?? null;
  const rainWindow = agroDays.reduce((sum, d) => sum + (d.precipitationMm ?? 0), 0);
  const anomaly = agro.data?.derived ?? null;

  return (
    <div className="space-y-4 md:space-y-6">
      <header className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
          <CloudSun size={22} />
        </div>
        <div>
          <h1 className="text-2xl md:text-3xl font-black tracking-tight text-gray-900 dark:text-white uppercase">Climate Monitoring</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Live Ethiopian weather, agroclimatology and satellite readings. Each figure names its publisher, the date it was observed, and whether it was
            measured, modelled or forecast.
          </p>
        </div>
      </header>

      <LocationPicker value={place} onChange={setPlace} />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 md:gap-6">
        <Panel
          title={`Current conditions · ${place.name}`}
          hint="Open-Meteo’s analysed now-time for the grid cell, with the station-independent elevation the publisher reports."
          right={weather.refreshing && <Refreshing />}
        >
          {weather.loading && <Loading label="Reading Open-Meteo" />}
          {!weather.loading && weather.error && <SourceUnavailable error={weather.error} source="Open-Meteo" />}
          {current && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Metric label="Temperature" value={fmt(current.temperatureC, 1)} unit="°C" />
                <Metric label="Humidity" value={fmt(current.relativeHumidityPct, 0)} unit="%" />
                <Metric label="Wind" value={fmt(current.windSpeedKmh, 1)} unit="km/h" />
                <Metric label="Rain this hour" value={fmt(current.precipitationMm, 1)} unit="mm" />
              </div>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-3 leading-relaxed">
                Grid elevation{' '}
                {weather.data?.elevationM === null || weather.data?.elevationM === undefined ? 'not reported' : `${fmt(weather.data.elevationM, 0)} m`} · timezone{' '}
                {weather.data?.timezone}.{' '}
                {weather.data && !weather.data.withinEthiopia && 'This point falls outside Ethiopia’s published extent, so national sources may not cover it.'}
              </p>
              <div className="mt-3">
                <ProvenanceLabel provenance={weather.provenance} context={weather.data?.location.admin1 ?? undefined} />
              </div>
            </>
          )}
        </Panel>

        <Panel
          title="The week just past and the week ahead"
          hint="Green bars are analysed observations, violet bars are forecast. One series, two different kinds of number — never blended."
          right={weather.refreshing && <Refreshing />}
        >
          {weather.loading && <Loading label="Building the outlook" />}
          {!weather.loading && weather.error && <SourceUnavailable error={weather.error} source="Open-Meteo" />}
          {chartRows.length > 0 && (
            <>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartRows} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#8888" vertical={false} />
                    <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                    <YAxis yAxisId="rain" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} width={44} unit="mm" />
                    <YAxis yAxisId="temp" orientation="right" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} width={40} unit="°C" />
                    <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e5e7eb', fontSize: 12 }} />
                    {firstForecastDay && (
                      <ReferenceLine yAxisId="rain" x={dayLabel(firstForecastDay)} stroke="#a1a1aa" strokeDasharray="4 4" label={{ value: 'today →', position: 'top', fontSize: 9, fill: '#a1a1aa' }} />
                    )}
                    <Bar yAxisId="rain" dataKey="Rain, observed" stackId="rain" fill="#10b981" radius={[3, 0, 0, 0]} />
                    <Bar yAxisId="rain" dataKey="Rain, forecast" stackId="rain" fill="#8b5cf6" fillOpacity={0.75} radius={[3, 3, 0, 0]} />
                    <Line yAxisId="temp" type="monotone" dataKey="Max °C" stroke="#f59e0b" strokeWidth={1.6} dot={false} />
                    <Line yAxisId="temp" type="monotone" dataKey="Min °C" stroke="#0ea5e9" strokeWidth={1.6} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
                <Metric label={`Rain past ${observed.length} d`} value={fmt(sum(observed.map((d) => d.precipitationSumMm)), 1)} unit="mm" />
                <Metric label={`Rain next ${forecast.length} d`} value={fmt(sum(forecast.map((d) => d.precipitationSumMm)), 1)} unit="mm" tone="warn" />
                <Metric label="ET0 today" value={fmt(todayEt0, 1)} unit="mm" />
                <Metric label="Rain prob today" value={fmt((observed.at(-1) ?? forecast[0])?.precipitationProbabilityMaxPct, 0)} unit="%" />
              </div>

              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[10px] font-black uppercase tracking-widest text-gray-400 border-b border-gray-100 dark:border-zinc-800">
                      <th className="py-1.5 pr-3">Date</th>
                      <th className="py-1.5 pr-3">Kind</th>
                      <th className="py-1.5 pr-3">Rain mm</th>
                      <th className="py-1.5 pr-3">Prob %</th>
                      <th className="py-1.5 pr-3">Max / min °C</th>
                      <th className="py-1.5 pr-3">Humidity %</th>
                      <th className="py-1.5 pr-3">Wind km/h</th>
                      <th className="py-1.5">ET0 mm</th>
                    </tr>
                  </thead>
                  <tbody>
                    {daily.slice(0, 15).map((d) => (
                      <tr key={d.date} className="border-b border-gray-50 dark:border-zinc-800/60">
                        <td className="py-1.5 pr-3 font-semibold text-gray-800 dark:text-gray-200 whitespace-nowrap">{d.date}</td>
                        <td className="py-1.5 pr-3">
                          <span
                            className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold whitespace-nowrap ${
                              d.isForecast
                                ? 'bg-violet-50 text-violet-700 dark:bg-violet-900/20 dark:text-violet-400'
                                : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400'
                            }`}
                          >
                            {d.isForecast ? 'Forecast' : 'Observed'}
                          </span>
                        </td>
                        <td className="py-1.5 pr-3 text-gray-600 dark:text-gray-400">{fmt(d.precipitationSumMm, 1)}</td>
                        <td className="py-1.5 pr-3 text-gray-600 dark:text-gray-400">{fmt(d.precipitationProbabilityMaxPct, 0)}</td>
                        <td className="py-1.5 pr-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                          {fmt(d.temperatureMaxC, 1)} / {fmt(d.temperatureMinC, 1)}
                        </td>
                        <td className="py-1.5 pr-3 text-gray-600 dark:text-gray-400">{fmt(d.relativeHumidityMeanPct, 0)}</td>
                        <td className="py-1.5 pr-3 text-gray-600 dark:text-gray-400">{fmt(d.windSpeedMaxKmh, 1)}</td>
                        <td className="py-1.5 text-gray-600 dark:text-gray-400">{fmt(d.et0Mm, 1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3">
                <ProvenanceLabel provenance={weather.provenance} />
              </div>
            </>
          )}
        </Panel>

        <Panel
          title={`Agroclimatology · ${place.name}`}
          hint="NASA POWER daily surface values for this grid cell. The window ends yesterday because POWER publishes reanalysis with a 1–3 day lag."
          right={agro.refreshing && <Refreshing />}
        >
          {agro.loading && <Loading label="Reading NASA POWER" />}
          {!agro.loading && agro.error && <SourceUnavailable error={agro.error} source="NASA POWER" />}
          {rainSeries.length > 0 && (
            <>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={rainSeries} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
                    <defs>
                      <linearGradient id="rainFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#8888" vertical={false} />
                    <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} width={44} unit="mm" />
                    <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e5e7eb', fontSize: 12 }} />
                    {normalPerDay !== null && (
                      <ReferenceLine
                        y={Number(normalPerDay.toFixed(1))}
                        stroke="#f59e0b"
                        strokeDasharray="4 4"
                        ifOverflow="extendDomain"
                        label={{ value: 'normal mm/day', position: 'insideTopRight', fontSize: 9, fill: '#d97706' }}
                      />
                    )}
                    <Area type="monotone" dataKey="Rain mm" stroke="#10b981" strokeWidth={1.6} fill="url(#rainFill)" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
                <Metric label={`Rain ${agro.data?.window.days ?? 0} d`} value={fmt(rainWindow, 1)} unit="mm" />
                <Metric label="Mean daily max" value={fmt(meanOf(agroDays.map((d) => d.temperatureMaxC)), 1)} unit="°C" />
                <Metric label="Mean daily min" value={fmt(meanOf(agroDays.map((d) => d.temperatureMinC)), 1)} unit="°C" />
                <Metric label="Mean shortwave" value={fmt(meanOf(agroDays.map((d) => d.shortwaveRadiationMjPerM2)), 1)} unit="MJ/m²" />
              </div>

              {anomaly ? (
                <div className="mt-4 rounded-xl border border-amber-200/70 dark:border-amber-900/40 bg-amber-50/50 dark:bg-amber-950/10 p-4">
                  <p className="text-[10px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-400">
                    Rainfall anomaly — computed here, not published
                  </p>
                  <p className="text-sm text-gray-700 dark:text-gray-300 mt-1.5 leading-relaxed">
                    {fmt(anomaly.observedMm, 1)} mm fell against {fmt(anomaly.expectedMm, 1)} mm of climatology for {anomaly.period}:{' '}
                    <strong>
                      {anomaly.anomalyPct === null
                        ? 'not computable from the data returned'
                        : `${anomaly.anomalyPct > 0 ? '+' : ''}${fmt(anomaly.anomalyPct, 0)}%`}
                    </strong>
                    .
                  </p>
                  <p className="text-[11px] text-gray-600 dark:text-gray-400 mt-1.5 leading-relaxed">
                    Ratio of two published quantities (POWER daily against POWER 30-year normals for the same cell). Coverage{' '}
                    {anomaly.daysWithData}/{anomaly.daysRequested} days
                    {anomaly.sufficientCoverage ? '' : ' — too sparse to present as a season total'}.
                  </p>
                </div>
              ) : (
                agro.data?.normalsUnavailableReason && (
                  <p className="text-[11px] text-orange-600 dark:text-orange-400 mt-3 leading-relaxed">
                    No anomaly is shown: the climatology request failed ({agro.data.normalsUnavailableReason}). The observed rainfall above is still real.
                  </p>
                )
              )}

              <div className="mt-3">
                <ProvenanceLabel provenance={agro.provenance} />
              </div>
            </>
          )}
        </Panel>

        <Panel
          title="Satellite reading for this point"
          hint="A physical value read out of the published tile for this exact coordinate, decoded with the publisher’s own colour map."
          right={(ndvi.refreshing || imerg.refreshing) && <Refreshing />}
        >
          <div className="space-y-4">
            <SampleCard title="Vegetation greenness (NDVI, 8-day composite)" icon={Sprout} state={ndvi} />
            <SampleCard title="Precipitation rate (GPM IMERG)" icon={Satellite} state={imerg} />
          </div>
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-4 leading-relaxed">
            The sampled footprint is one tile pixel — hundreds of metres across — not the farmer’s plot. Neither product measures yield or soil conditions; the
            band wording above is the publisher’s own.
          </p>
        </Panel>
      </div>

      <SourceStatusPanel />
    </div>
  );
};

function meanOf(values: (number | null)[]): number | null {
  const clean = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  return clean.length === 0 ? null : clean.reduce((a, b) => a + b, 0) / clean.length;
}

function sum(values: (number | null)[]): number {
  return values.reduce<number>((total, v) => total + (v ?? 0), 0);
}

const SampleCard = ({
  title,
  icon: Icon,
  state,
}: {
  title: string;
  icon: typeof Sprout;
  state: LiveDataState<SamplePayload>;
}) => {
  const sample = state.data;
  return (
    <div className="rounded-xl border border-gray-100 dark:border-zinc-800 p-4">
      <div className="flex items-center gap-2">
        <Icon size={15} className="text-emerald-600 dark:text-emerald-400" />
        <p className="text-xs font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">{title}</p>
      </div>

      {state.loading && <Loading label="Fetching tile" />}
      {!state.loading && state.error && (
        <div className="mt-2">
          <SourceUnavailable error={state.error} source="NASA GIBS" />
        </div>
      )}

      {sample && (
        <>
          <div className="flex items-baseline gap-2 mt-2">
            <p className="text-2xl font-black text-gray-900 dark:text-white tracking-tight">
              {sample.value === null ? 'no value' : fmt(sample.value, 3)}
            </p>
            <span className="text-xs font-semibold text-gray-400">{sample.layer?.units}</span>
          </div>
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
            {sample.band ? `Published band: “${sample.band}”. ` : 'This pixel carries no mapped value, so none is claimed. '}
            Scene date {sample.tileDate} · pixel ≈ {fmt(sample.pixelSizeMeters, 0)} m · ({sample.latitude.toFixed(3)}, {sample.longitude.toFixed(3)})
            {sample.withinEthiopia ? '' : ' — outside Ethiopia'}.
          </p>
          {sample.layer && (
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-2 leading-relaxed">
              <strong className="text-gray-600 dark:text-gray-300">What it means:</strong> {sample.layer.meaning}
            </p>
          )}
          {sample.layer && (
            <p className="text-[11px] text-orange-700 dark:text-orange-400 mt-1.5 leading-relaxed">
              <strong>Limit:</strong> {sample.layer.caveat}
            </p>
          )}
          <div className="mt-2">
            <ProvenanceLabel provenance={state.provenance} compact />
          </div>
        </>
      )}
    </div>
  );
};
