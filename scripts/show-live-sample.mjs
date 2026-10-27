// Prints one live value per integration with the publisher's own timestamp and source, so a
// reviewer can see what is actually being served without reading the UI:
//   npm run dev   (in another shell)
//   npm run show:data
const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';
const probes = [
  ['weather (Open-Meteo)', '/api/data/weather?place=Addis%20Ababa&days=1&pastDays=0', (d) => [d.current?.observedAt, `${d.current?.temperatureC} C`] ],
  ['agroclimatology (NASA POWER)', '/api/data/agroclimate?place=Dessie', (d) => { const r = d.normals?.find((n) => n.parameter === 'PRECTOTCORR' && n.month === '07'); return [`${r?.month} · ${r?.parameter}`, `${r?.value} ${r?.units}`]; }],
  ['market prices (WFP/HDX)', '/api/data/markets?mode=overview', (d) => [d.asOf, `${d.commodities?.[0]?.commodity} ${d.commodities?.[0]?.avgEtbPerUnit} ETB/${d.commodities?.[0]?.unit}`] ],
  ['exchange rates (NBE)', '/api/data/exchange?focus=official&points=1', (d) => { const usd = d.find((r) => r.currencyCode === 'USD') ?? d[0]; return [usd?.observedOn, `${usd?.weightedAverage} ETB per ${usd?.currencyCode}`]; }],
  ['unofficial ETB (World Bank)', '/api/data/exchange?focus=unofficial&months=3', (d) => [d.series?.[0]?.observedOn, `${d.series?.[0]?.unofficialUsdToEtb} ETB/USD monthly avg`] ],
  ['satellite NDVI (NASA GIBS)', '/api/data/geospatial?view=sample&layer=VIIRS_SNPP_NDVI_8Day&lat=9.02&lon=38.75', (d) => [d.tileDate, `NDVI ${d.value} · ${d.band ?? 'no data'}`] ],
  ['boundaries (geoBoundaries)', '/api/data/locations?regions=1', (d) => [d.regions?.[0]?.id, `${d.regions?.length} ADM1 outlines, e.g. ${d.regions?.[0]?.name} (no observation date — a boundary is not observed)`] ],
];

for (const [label, path, pick] of probes) {
  const res = await fetch(`${BASE}${path}`, { headers: { accept: 'application/json' } });
  const body = await res.json().catch(() => null);
  if (!body?.ok) {
    console.log(`${label.padEnd(32)} HTTP ${res.status} ${JSON.stringify(body?.error ?? null)}`);
    continue;
  }
  const [stamp, value] = pick(body.data);
  const source = body.provenance?.source ?? body.provenance?.official?.source ?? body.provenance?.wfp?.source ?? '(multi)';
  const kind = body.provenance?.valueKind ?? body.provenance?.official?.valueKind ?? '-';
  console.log(`${label.padEnd(32)} ${String(stamp).padEnd(24)} ${String(value).padEnd(34)} ${kind} · ${source}`);
}
