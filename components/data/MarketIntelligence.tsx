'use client';
import React, { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Coins, Store, TrendingUp } from 'lucide-react';

import { ProvenanceLabel, SourceUnavailable, type ProvenanceView, type SourceErrorView } from '@/components/data/ProvenanceLabel';
import { SourceStatusPanel } from '@/components/data/SourceStatusPanel';
import { Loading, Metric, Panel, Refreshing, dayLabel, fmt, fmtInt, monthLabel } from '@/components/data/ui';
import { useLiveData } from '@/hooks/useLiveData';

/* ------------------------------------------------------------------ *
 * Shapes returned by /api/data/markets and /api/data/exchange
 * ------------------------------------------------------------------ */

interface PriceRow {
  observedOn: string;
  market: string;
  admin1: string | null;
  commodity: string;
  unit: string;
  currency: string;
  price: number | null;
  retail: string;
  priceFlag: string;
}

interface PriceChange {
  commodity: string;
  market: string;
  unit: string;
  currency: string;
  latestObservedOn: string;
  latestPrice: number;
  previousObservedOn: string | null;
  previousPrice: number | null;
  changePct: number | null;
  observations: number;
}

interface OverviewPayload {
  asOf: string;
  commodities: { commodity: string; avgEtbPerUnit: number; unit: string; markets: number }[];
}

interface SnapshotPayload {
  asOfLatestObservation: string | null;
  markets: number;
  commodities: number;
  rows: PriceRow[];
  changes: PriceChange[];
}

interface HistoryPayload {
  series: PriceRow[];
}

interface ExchangePayload {
  categories: string[];
  official: { observedOn: string; usdToEtb: number | null }[] | null;
  unofficial: { observedOn: string; unofficialUsdToEtb: number }[] | null;
  benchmarks: {
    code: string;
    name: string;
    frequency: string;
    unit: string;
    observations: { period: string; value: number | null }[];
  }[] | null;
}

/** The combined exchange response answers with one provenance and one error per category. */
interface ExchangeProvenances {
  official: ProvenanceView | null;
  unofficial: ProvenanceView | null;
  benchmark: ProvenanceView | null;
}

interface ExchangeErrors {
  official: SourceErrorView | null;
  unofficial: SourceErrorView | null;
  benchmark: SourceErrorView | null;
}

type ExchangeExtra = Partial<{ errors: ExchangeErrors }>;

/** The five commodities this product tracks; every value comes from WFP’s own rows. */
const COMMODITIES = ['Teff', 'Maize', 'Wheat', 'Sorghum', 'Coffee'] as const;

const CHART_COLORS = ['#10b981', '#0ea5e9', '#f59e0b', '#8b5cf6', '#ef4444'];

/** One series per (commodity, unit, price type): the publisher’s units are never merged. */
interface TrendSeries {
  label: string;
  color: string;
  points: { month: string; avg: number; markets: number }[];
}

function buildTrendSeries(rows: PriceRow[]): TrendSeries[] {
  const byKey = new Map<string, Map<string, { sum: number; n: number; markets: Set<string> }>>();
  for (const r of rows) {
    if (r.price === null) continue;
    const key = `${r.commodity} · ${r.unit} · ${r.retail}`;
    const months = byKey.get(key) ?? new Map<string, { sum: number; n: number; markets: Set<string> }>();
    const month = r.observedOn.slice(0, 7);
    const bucket = months.get(month) ?? { sum: 0, n: 0, markets: new Set<string>() };
    bucket.sum += r.price;
    bucket.n += 1;
    bucket.markets.add(r.market);
    months.set(month, bucket);
    byKey.set(key, months);
  }

  const series: TrendSeries[] = [];
  let i = 0;
  for (const [label, months] of [...byKey.entries()]) {
    const points = [...months.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, b]) => ({ month, avg: b.sum / b.n, markets: b.markets.size }));
    if (points.length < 2) continue;
    series.push({ label, color: CHART_COLORS[i++ % CHART_COLORS.length], points });
  }
  return series.sort((a, b) => b.points.length - a.points.length).slice(0, 4);
}

export const MarketIntelligence = () => {
  const [commodity, setCommodity] = useState<(typeof COMMODITIES)[number]>('Teff');
  const [region, setRegion] = useState('');

  const overview = useLiveData<OverviewPayload>('/api/data/markets?mode=overview');
  const history = useLiveData<HistoryPayload>(`/api/data/markets?mode=history&commodity=${encodeURIComponent(commodity)}&months=36`);
  const snapshot = useLiveData<SnapshotPayload>(
    `/api/data/markets?mode=snapshot&months=6&limit=400${region ? `&region=${encodeURIComponent(region)}` : ''}`,
  );
  const fx = useLiveData<ExchangePayload, ExchangeProvenances, ExchangeExtra>('/api/data/exchange?focus=all&points=8&months=18');

  const series = useMemo(() => buildTrendSeries(history.data?.series ?? []), [history.data]);

  const chartData = useMemo(() => {
    const months = [...new Set(series.flatMap((s) => s.points.map((p) => p.month)))].sort();
    return months.map((month) => {
      const row: Record<string, string | number | null> = { month: monthLabel(month) };
      for (const s of series) {
        const hit = s.points.find((p) => p.month === month);
        row[s.label] = hit ? Number(hit.avg.toFixed(1)) : null;
      }
      return row;
    });
  }, [series]);

  const regions = useMemo(() => {
    const names = new Set<string>();
    for (const r of snapshot.data?.rows ?? []) if (r.admin1) names.add(r.admin1);
    return [...names].sort();
  }, [snapshot.data]);

  const changes = (snapshot.data?.changes ?? [])
    .filter((c): c is PriceChange & { changePct: number; previousObservedOn: string } => c.changePct !== null && c.previousObservedOn !== null)
    .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
    .slice(0, 14);

  const officialSeries = (fx.data?.official ?? []).map((p) => ({ day: dayLabel(p.observedOn), 'ETB per US$': p.usdToEtb }));
  const unofficialSeries = (fx.data?.unofficial ?? []).map((p) => ({ month: monthLabel(p.observedOn), 'ETB per US$': p.unofficialUsdToEtb }));
  const fxErrors = fx.extra?.errors;

  return (
    <div className="space-y-4 md:space-y-6">
      <header className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
          <Store size={22} />
        </div>
        <div>
          <h1 className="text-2xl md:text-3xl font-black tracking-tight text-gray-900 dark:text-white uppercase">Market Intelligence</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Prices surveyed in Ethiopian markets by the WFP rEMS monitoring programme, in ETB per the unit the publisher recorded. International commodity
            references are never presented as Ethiopian market prices here.
          </p>
        </div>
      </header>

      <Panel
        title="National grain prices · newest survey month"
        hint="Average of the retail prices actually surveyed in that month, grouped strictly by commodity and unit."
        right={overview.refreshing && <Refreshing />}
      >
        {overview.loading && <Loading label="Loading WFP prices" />}
        {!overview.loading && overview.error && <SourceUnavailable error={overview.error} source="WFP via HDX" />}
        {overview.data && overview.data.commodities.length > 0 && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
              {overview.data.commodities.slice(0, 8).map((c) => (
                <Metric
                  key={`${c.commodity}-${c.unit}`}
                  label={`${c.commodity} · ${c.unit}`}
                  value={fmt(c.avgEtbPerUnit, 0)}
                  unit="ETB"
                />
              ))}
            </div>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-3 leading-relaxed">
              Survey month {overview.data.asOf}; each figure is the mean across the markets shown in its card. Coffee is a beverage crop and is not in this
              grain table — use the history panel below for it.
            </p>
            <div className="mt-2">
              <ProvenanceLabel provenance={overview.provenance} />
            </div>
          </>
        )}
      </Panel>

      <Panel
        title="Price history in Ethiopian markets"
        hint="One line per commodity · unit · price type, averaged over the markets surveyed that month. Where a publisher stopped surveying, the line has a real gap — nothing is interpolated."
        right={history.refreshing && <Refreshing />}
      >
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {COMMODITIES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCommodity(c)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-black uppercase tracking-wider transition-colors ${
                commodity === c
                  ? 'bg-emerald-600 text-white'
                  : 'bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-zinc-700'
              }`}
            >
              {c}
            </button>
          ))}
          <span className="text-[11px] text-gray-400 ml-auto">last 36 survey months</span>
        </div>

        {history.loading && <Loading label={`Loading ${commodity} history`} />}
        {!history.loading && history.error && <SourceUnavailable error={history.error} source="WFP via HDX" />}
        {!history.loading && history.data && series.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
            The publisher has no {commodity} series with at least two months under a single unit and price type, so no line is drawn. No price is invented.
          </p>
        )}

        {chartData.length > 1 && (
          <>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 4, right: 8, left: -6, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#8888" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis
                    tick={{ fontSize: 10, fill: '#9ca3af' }}
                    tickLine={false}
                    axisLine={false}
                    width={66}
                    tickFormatter={(v: number) => v.toLocaleString('en-US')}
                  />
                  <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e5e7eb', fontSize: 12 }} />
                  {series.map((s) => (
                    <Line key={s.label} type="monotone" dataKey={s.label} stroke={s.color} strokeWidth={1.8} dot={{ r: 1.5 }} connectNulls={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3">
              {series.map((s) => (
                <span key={s.label} className="flex items-center gap-1.5 text-[11px] text-gray-600 dark:text-gray-400">
                  <span className="w-3 h-0.5 rounded" style={{ background: s.color }} />
                  {s.label} · {s.points.length} months · up to {Math.max(...s.points.map((p) => p.markets))} markets
                </span>
              ))}
            </div>
            <p className="text-[11px] text-gray-400 mt-2">
              Values are ETB per the stated unit, retail or wholesale as recorded by the surveyor — the two are never averaged together.
            </p>
            <div className="mt-2">
              <ProvenanceLabel provenance={history.provenance} />
            </div>
          </>
        )}
      </Panel>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 md:gap-6">
        <Panel
          title="Cross-market movement"
          hint="Month-on-month change inside one market, commodity and unit. Comparing two markets compares two surveys, not one price."
          right={snapshot.refreshing && <Refreshing />}
        >
          <div className="flex items-center gap-2 mb-3">
            <label htmlFor="region-filter" className="text-[10px] font-black uppercase tracking-widest text-gray-400">
              Region
            </label>
            <select
              id="region-filter"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              className="text-xs bg-transparent font-semibold text-gray-800 dark:text-gray-200 focus:outline-none"
            >
              <option value="">All regions</option>
              {regions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          {snapshot.loading && <Loading label="Loading latest survey month" />}
          {!snapshot.loading && snapshot.error && <SourceUnavailable error={snapshot.error} source="WFP via HDX" />}

          {changes.length > 0 && snapshot.data && (
            <>
              <div className="overflow-x-auto max-h-96 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-white dark:bg-zinc-900">
                    <tr className="text-left text-[10px] font-black uppercase tracking-widest text-gray-400 border-b border-gray-100 dark:border-zinc-800">
                      <th className="py-1.5 pr-3">Market</th>
                      <th className="py-1.5 pr-3">Commodity</th>
                      <th className="py-1.5 pr-3">Latest</th>
                      <th className="py-1.5">Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {changes.map((c) => (
                      <tr key={`${c.market}-${c.commodity}-${c.unit}`} className="border-b border-gray-50 dark:border-zinc-800/60">
                        <td className="py-1.5 pr-3 font-semibold text-gray-800 dark:text-gray-200 whitespace-nowrap">{c.market}</td>
                        <td className="py-1.5 pr-3 text-gray-600 dark:text-gray-400">
                          {c.commodity} <span className="text-gray-400">({c.unit})</span>
                        </td>
                        <td className="py-1.5 pr-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                          {fmtInt(c.latestPrice)} <span className="text-gray-400">{c.currency}</span>
                        </td>
                        <td className={`py-1.5 font-bold whitespace-nowrap ${c.changePct > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                          {c.changePct > 0 ? '↑' : '↓'} {fmt(Math.abs(c.changePct), 1)}%
                          <span className="text-[10px] font-normal text-gray-400 ml-1.5">vs {c.previousObservedOn.slice(0, 7)}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-3 leading-relaxed">
                The {snapshot.data.asOfLatestObservation} survey covered {snapshot.data.markets} markets and {snapshot.data.commodities} commodities. Rows above
                exist only where the publisher has both this month and the previous month for the identical market, commodity and unit.
              </p>
              <div className="mt-2">
                <ProvenanceLabel provenance={snapshot.provenance} />
              </div>
            </>
          )}
        </Panel>

        <Panel
          title="Ethiopian foreign exchange — three separate categories"
          hint="The official rate is a daily NBE publication, the parallel rate is a World Bank monthly national average and the benchmark rate is an annual figure. They are different kinds of number and are shown apart."
          right={fx.refreshing && <Refreshing />}
        >
          {fx.loading && <Loading label="Loading NBE and World Bank" />}
          {!fx.loading && fx.error && <SourceUnavailable error={fx.error} source="NBE / World Bank" />}

          {fx.data && (
            <div className="space-y-5">
              <div>
                <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">
                  <TrendingUp size={12} /> Official · NBE daily indicative
                </p>
                {officialSeries.length > 0 ? (
                  <>
                    <div className="h-28 mt-2">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={officialSeries} margin={{ top: 2, right: 4, left: -16, bottom: 0 }}>
                          <XAxis dataKey="day" tick={{ fontSize: 9, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
                          <YAxis domain={['dataMin - 2', 'dataMax + 2']} tick={{ fontSize: 9, fill: '#9ca3af' }} tickLine={false} axisLine={false} width={52} />
                          <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e5e7eb', fontSize: 12 }} />
                          <Bar dataKey="ETB per US$" fill="#10b981" radius={[3, 3, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1.5 leading-relaxed">
                      One bar per published trading date. This is a reference rate set by the central bank, not a rate a bureau quotes you.
                    </p>
                    {fx.provenance?.official && <ProvenanceLabel provenance={fx.provenance.official} compact />}
                  </>
                ) : (
                  <CategoryFailure label="National Bank of Ethiopia" error={fxErrors?.official} />
                )}
              </div>

              <div className="pt-3 border-t border-gray-100 dark:border-zinc-800">
                <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">
                  <Coins size={12} /> Parallel market · World Bank monthly national average
                </p>
                {unofficialSeries.length > 0 ? (
                  <>
                    <div className="h-28 mt-2">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={unofficialSeries} margin={{ top: 2, right: 4, left: -16, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#8888" vertical={false} />
                          <XAxis dataKey="month" tick={{ fontSize: 9, fill: '#9ca3af' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                          <YAxis domain={['dataMin - 2', 'dataMax + 2']} tick={{ fontSize: 9, fill: '#9ca3af' }} tickLine={false} axisLine={false} width={52} />
                          <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e5e7eb', fontSize: 12 }} />
                          <Line type="monotone" dataKey="ETB per US$" stroke="#0ea5e9" strokeWidth={1.8} dot={{ r: 1.5 }} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1.5 leading-relaxed">
                      A monthly survey average, not a daily quotation: the newest point is the latest month the World Bank has compiled, which may be months
                      behind today.
                    </p>
                    {fx.provenance?.unofficial && <ProvenanceLabel provenance={fx.provenance.unofficial} compact />}
                  </>
                ) : (
                  <CategoryFailure label="World Bank currency series" error={fxErrors?.unofficial} />
                )}
              </div>

              <div className="pt-3 border-t border-gray-100 dark:border-zinc-800">
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">
                  Benchmarks · World Bank annual indicators
                </p>
                {fx.data.benchmarks && fx.data.benchmarks.length > 0 ? (
                  <div className="mt-2 space-y-2">
                    {fx.data.benchmarks.map((ind) => {
                      const latest = ind.observations.filter((o) => o.value !== null).at(-1);
                      return (
                        <div
                          key={ind.code}
                          className="flex items-start justify-between gap-3 rounded-xl bg-gray-50 dark:bg-zinc-800/60 border border-gray-100 dark:border-zinc-800 px-3 py-2"
                        >
                          <div>
                            <p className="text-xs font-semibold text-gray-800 dark:text-gray-200">{ind.name}</p>
                            <p className="text-[10px] text-gray-400">
                              {ind.code} · published {ind.frequency} · {ind.unit}
                            </p>
                          </div>
                          <p className="text-sm font-black text-gray-900 dark:text-white whitespace-nowrap text-right">
                            {fmt(latest?.value ?? null, 2)}
                            <span className="block text-[10px] font-normal text-gray-400">reference {latest?.period ?? '—'}</span>
                          </p>
                        </div>
                      );
                    })}
                    {fx.provenance?.benchmark && <ProvenanceLabel provenance={fx.provenance.benchmark} compact />}
                    <p className="text-[11px] text-orange-700 dark:text-orange-400 leading-relaxed">
                      Annual series published roughly a year in arrears. Context only — these are not current-month figures.
                    </p>
                  </div>
                ) : (
                  <CategoryFailure label="World Bank indicators" error={fxErrors?.benchmark} />
                )}
              </div>
            </div>
          )}
        </Panel>
      </div>

      <SourceStatusPanel />
    </div>
  );
};

/** A category with no rows shows the publisher’s actual failure, never a placeholder number. */
const CategoryFailure = ({ label, error }: { label: string; error?: SourceErrorView | null }) =>
  error ? (
    <div className="mt-2">
      <SourceUnavailable error={error} source={label} />
    </div>
  ) : (
    <p className="text-[11px] text-orange-600 dark:text-orange-400 mt-2 leading-relaxed">
      {label}: this response carried no rows, and nothing was substituted for them.
    </p>
  );
