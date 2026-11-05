/**
 * Market Intelligence availability checks: the real route handlers, the real connectors, the real
 * cache — and a stubbed publisher.
 *
 * Why the publisher is stubbed here, and why that is not a fixture pretending to be evidence: the
 * conditions under test are *answers a live publisher no longer gives us on demand*. HDX's edge
 * refused this repository's Node client 10 times out of 10 sequential attempts on 2026-11-04
 * (HTTP 406 with `{"error":"Blocked due to bot activity."}`, and HTTP 202 with
 * `x-amzn-waf-action: challenge` and no bytes), and it does not offer a 406, an empty body, or a
 * four-month-old survey month to order. `scripts/check-data-routes.mjs` and
 * `scripts/check-report-data.mjs` cover the live publishers; this file covers the states a
 * publisher's answer can be in, which only a stub can hand out on schedule.
 *
 * What this therefore proves is a claim about *our* code and nothing about any publisher: that a
 * refusal is reported as a refusal, that a refusal leaves no invented number or timestamp behind,
 * that a cached copy keeps the fetch time it actually happened at, that an old survey month is
 * marked stale while the retrieval is marked today, that a blocked feed does not take the working
 * publishers down with it, and that a source that answered-with-nothing is not dressed as an
 * outage. No value here is anyone's price, and no message is attributed to a publisher that was
 * not the one called.
 *
 * Run: node scripts/check-market-availability.mjs
 */

import { register } from 'node:module';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');
register(pathToFileURL(resolvePath(ROOT, 'scripts/ts-report-hooks.mjs')).href, import.meta.url);
const ts = (rel) => import(pathToFileURL(resolvePath(ROOT, rel)).href);

const marketsRoute = await ts('app/api/data/markets/route.ts');
const exchangeRoute = await ts('app/api/data/exchange/route.ts');
const { cacheClear, cacheReset, lastSuccessAt } = await ts('lib/data/cache.ts');

let checks = 0;
let failures = 0;
const assert = (label, cond, detail) => {
  checks += 1;
  if (cond) return;
  failures += 1;
  console.log(`  FAIL  ${label}${detail === undefined ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
};
const note = (msg) => console.log(`  note  ${msg}`);

/* ------------------------------------------------------------------ *
 * The four publishers this page contacts, and the answer each one gives
 * ------------------------------------------------------------------ */

const WFP_CSV_URL =
  'https://data.humdata.org/dataset/2e4f1922-e446-4b57-a98a-d0e2d5e34afa/resource/87bac18e-f3aa-4b29-8cf8-76763e823dc5/download/wfp_food_prices_eth.csv';
const WB_CURRENCY_URL =
  'https://data.humdata.org/dataset/7752a1d8-7d7a-4feb-a857-11026dad7188/resource/7a810731-78d5-4342-b5aa-7ed4e5f8eab9/download/real-time-currency-prices-for-ethiopia.csv';

const isoDay = (daysAgo) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);

/** Measured at HDX on 2026-11-04, in both of its forms. */
const BLOCKED_406 = { status: 406, headers: { 'content-type': 'application/json' }, body: '{"error":"Blocked due to bot activity."}' };
const EMPTY_200 = { status: 200, headers: { 'content-type': 'text/csv' }, body: '' };
const SERVER_500 = { status: 500, headers: {}, body: 'upstream error page, never read by our client' };

const csv = (text) => ({ status: 200, headers: { 'content-type': 'text/csv' }, body: text });
const json = (make) => ({ status: 200, headers: { 'content-type': 'application/json' }, body: make });

/**
 * Survey rows shaped the way WFP publishes them. Dates are relative to today on purpose: a
 * fixture frozen at one calendar month would stop exercising the staleness rule the day it was
 * written, and then the suite would quietly assert nothing.
 */
function wfpCsv({ surveyDaysAgo }) {
  const latest = isoDay(surveyDaysAgo);
  const previous = isoDay(surveyDaysAgo + 31);
  const header = 'date,market_code,admin1,admin2,market,market_market_id,market_latitude,market_longitude,category,commodity,unit,priceflag,pricetype,currency,price,usdprice';
  const row = (date, market, admin1, commodity, unit, pricetype, price) =>
    [date, 'ETH02', admin1, `${admin1} Zone`, market, `${market} Market`, '9.70', '39.50', 'Cereals', commodity, unit, 'actual', pricetype, 'ETB', String(price), (price / 125).toFixed(2)].join(',');
  return [
    header,
    // Two markets selling the same Teff unit in the same month. The national figure is the mean of
    // exactly these two; the wholesale line below must stay out of it. Maize gets a second market
    // too, because the connector refuses to call a single market a national average.
    row(latest, 'Dessie', 'Amhara', 'Teff', '100 KG', 'Retail', 3000),
    row(latest, 'Woreba', 'Amhara', 'Teff', '100 KG', 'Retail', 3200),
    row(latest, 'Dessie', 'Amhara', 'Teff', '100 KG', 'Wholesale', 2600),
    row(latest, 'Dessie', 'Amhara', 'Maize', 'KG', 'Retail', 60),
    row(latest, 'Woreba', 'Amhara', 'Maize', 'KG', 'Retail', 66),
    row(previous, 'Dessie', 'Amhara', 'Teff', '100 KG', 'Retail', 2900),
    row(previous, 'Dessie', 'Amhara', 'Maize', 'KG', 'Retail', 55),
  ].join('\n');
}

/** Two national-average months plus a city line the parser must not blend in. */
const wbCurrencyCsv = () =>
  [
    'DATES,country_name,market_name,sector_name,item_name,unit_price,currency,exchange_rate_unofficial,mkt_name,year,month',
    `${isoDay(35)},Ethiopia,,,US Dollar,,ETB,125.50,Market Average,2026,9`,
    `${isoDay(6)},Ethiopia,,,US Dollar,,ETB,127.20,Market Average,2026,10`,
    `${isoDay(6)},Ethiopia,,,US Dollar,,ETB,140.00,Addis Ababa,2026,10`,
  ].join('\n');

/** NBE wraps its rows in `{ success, message, status, data }` and nests the currency. */
const nbeJson = (url) => {
  const date = new URL(url).searchParams.get('date') ?? isoDay(0);
  return JSON.stringify({
    success: true,
    message: 'Operational successfully',
    status: 200,
    data: [
      { date, currency: { name: 'US Dollar', code: 'USD' }, weighted_average: '125.50', buying: '124.80', selling: '126.20' },
      { date, currency: { name: 'Euro', code: 'EUR' }, weighted_average: '145.10', buying: '144.20', selling: '146.00' },
    ],
  });
};

const WB_INDICATOR_VALUE = { 'PA.NUS.FCRF': 57.4, 'FP.CPI.TOTL.ZG': 23.4, 'NV.AGR.TOTL.ZG': 6.1 };
const wbIndicatorJson = (url) => {
  const code = new URL(url).pathname.split('/').at(-1);
  return JSON.stringify([{ total: 1 }, [{ date: '2024', value: WB_INDICATOR_VALUE[code] ?? 1, country: 'Ethiopia' }]]);
};

const working = () => ({
  wfp: csv(wfpCsv({ surveyDaysAgo: 20 })),
  wbCurrency: csv(wbCurrencyCsv()),
  nbe: json(nbeJson),
  wbApi: json(wbIndicatorJson),
});

const publishers = working();
const calls = { wfp: 0, wbCurrency: 0, nbe: 0, wbApi: 0 };

function identify(url) {
  if (url === WFP_CSV_URL) return 'wfp';
  if (url === WB_CURRENCY_URL) return 'wbCurrency';
  if (url.startsWith('https://api.nbe.gov.et')) return 'nbe';
  if (url.startsWith('https://api.worldbank.org')) return 'wbApi';
  // Reaching here means a route contacted a publisher this harness does not model, which would let
  // an assertion pass about a source nobody was watching. Fail loudly instead.
  throw new Error(`un-stubbed upstream URL: ${url}`);
}

globalThis.fetch = async (rawUrl) => {
  const url = String(rawUrl);
  const name = identify(url);
  calls[name] += 1;
  const served = publishers[name];
  const body = typeof served.body === 'function' ? served.body(url) : served.body;
  return new Response(body, { status: served.status, headers: served.headers });
};

const ask = async (route, path) => {
  const res = await route.GET(new Request(`https://app.test${path}`));
  return { status: res.status, cacheControl: res.headers.get('cache-control'), body: await res.json() };
};

const reset = (overrides = {}) => {
  // A full reset: this suite starts every case as a process that has never read the file.
  cacheReset();
  for (const key of Object.keys(calls)) calls[key] = 0;
  Object.assign(publishers, working(), overrides);
};

/* ================================================================== *
 * 1 — a publisher that refuses us: named, reasoned, nothing invented
 * ================================================================== */
{
  reset({ wfp: BLOCKED_406 });
  const modes = ['/api/data/markets?mode=overview', '/api/data/markets?mode=snapshot&months=6&limit=400', '/api/data/markets?mode=history&commodity=Teff&months=36'];

  for (const path of modes) {
    const before = calls.wfp;
    const { status, cacheControl, body } = await ask(marketsRoute, path);
    const mode = path.split('mode=')[1].split('&')[0];
    const u = body.unavailable;
    assert(`${mode}: refused as 502, not a silent 200`, status === 502 && body.ok === false, { status, ok: body.ok });
    assert(`${mode}: code is publisher_blocked`, body.error?.code === 'publisher_blocked', body.error);
    assert(`${mode}: a policy refusal is not retried into a spinner`, calls.wfp === before + 1, { upstreamCallsForThisRequest: calls.wfp - before });
    assert(`${mode}: no empty payload is passed off as data`, body.data === undefined, Object.keys(body));
    assert(`${mode}: the outage is not cached at the edge`, cacheControl === null, cacheControl);
    assert(`${mode}: carries an unavailable block`, u !== undefined && u !== null, Object.keys(body));
    assert(`${mode}: block names the publisher`, u?.publisher === 'WFP Ethiopia Food Prices (rEMS)', u?.publisher);
    assert(`${mode}: block links the publisher`, String(u?.publisherUrl).includes('data.humdata.org'), u?.publisherUrl);
    assert(`${mode}: block repeats the reason code`, u?.reason === 'publisher_blocked', u?.reason);
    assert(`${mode}: block says no approved alternative exists`, /No approved alternative publisher/.test(String(u?.reasonDetail)), u?.reasonDetail);
    assert(`${mode}: no last-good time is invented when there was none`, u?.lastSuccessfulFetchAt === null, u?.lastSuccessfulFetchAt);
    assert(`${mode}: the no-substitution guarantee is explicit`, u?.substituteUsed === false, u?.substituteUsed);
    assert(`${mode}: a non-answer never claims high quality`, body.provenance?.quality === 'low', body.provenance?.quality);
    assert(`${mode}: a non-answer states no observation date`, body.provenance?.observedAt === null, body.provenance?.observedAt);
    assert(`${mode}: a refusal claims no fetch time of its own`, body.provenance?.retrievedAt === null, body.provenance?.retrievedAt);
    assert(`${mode}: and so cannot be read as current`, body.provenance?.stale === true, body.provenance?.stale);
  }

  assert('refusal: nothing is cached, so a recovered publisher is visible on the next request', lastSuccessAt('wfp:prices:all') === null, lastSuccessAt('wfp:prices:all'));
}

/* ================================================================== *
 * 2 — a publisher that answers: real rows, real dates, no notice
 * ================================================================== */
{
  reset();
  const { status, cacheControl, body } = await ask(marketsRoute, '/api/data/markets?mode=overview');
  assert('success: 200', status === 200 && body.ok === true, { status, error: body.error });
  assert('success: rows arrive', body.data?.commodities?.length === 2, body.data?.commodities);
  const teff = body.data?.commodities?.find((c) => c.commodity === 'Teff');
  assert('success: the national figure is the two retail markets only', teff?.avgEtbPerUnit === 3100, teff);
  assert('success: the market count is the markets actually averaged', teff?.markets === 2, teff);
  assert('success: no unavailable block on a payload that arrived', body.unavailable === undefined, Object.keys(body));
  assert('success: provenance observes the survey month, not today', body.provenance?.observedAt === isoDay(20), { observed: body.provenance?.observedAt, expected: isoDay(20) });
  assert('success: retrievedAt is this request’s fetch', Date.now() - Date.parse(body.provenance?.retrievedAt) < 120_000, body.provenance?.retrievedAt);
  assert('success: a three-week-old survey month is not called stale', body.provenance?.stale === false, body.provenance);
  assert('success: servedFromCache is honest about being the first read', body.provenance?.servedFromCache === false, body.provenance?.servedFromCache);
  assert('success: the answer is marked current, so the UI may show it as this month', body.provenance?.quality === 'high' && body.provenance?.valueKind === 'observed', body.provenance?.quality);
  assert('success: the edge may cache it, and says for how long', cacheControl === 'public, s-maxage=21600, stale-while-revalidate=64800', cacheControl);
  assert('success: the last-good read is now recorded', typeof lastSuccessAt('wfp:prices:all') === 'number', lastSuccessAt('wfp:prices:all'));

  const snapshot = await ask(marketsRoute, '/api/data/markets?mode=snapshot&months=6&limit=400');
  const change = snapshot.body.data?.changes?.find((c) => c.commodity === 'Teff' && c.market === 'Dessie' && c.unit === '100 KG');
  // 3000 against 2900 is 3.4482…%; the connector reports it to one decimal, which is the
  // precision a monthly survey price actually supports.
  assert('snapshot: movement is computed only across a real pair of months', change && change.changePct === 3.4 && change.latestPrice === 3000 && change.previousPrice === 2900, change);
  assert('snapshot: the month it compares against is named', change?.previousObservedOn === isoDay(51), change?.previousObservedOn);

  const wholesale = await ask(marketsRoute, '/api/data/markets?mode=snapshot&months=6&limit=400&priceType=Wholesale');
  assert('snapshot: a wholesale filter never blends retail rows in', (wholesale.body.data?.rows ?? []).length > 0 && wholesale.body.data.rows.every((r) => r.retail === 'Wholesale'), wholesale.body.data?.rows?.map((r) => r.retail));

  const bad = await ask(marketsRoute, '/api/data/markets?mode=history');
  assert('bad input: refused before any publisher is contacted', bad.status === 400 && bad.body.unavailable === undefined, { status: bad.status, keys: Object.keys(bad.body) });
  assert('bad input: and the upstream was not called for it', calls.wfp === 1, { upstreamCalls: calls.wfp });
}

/* ================================================================== *
 * 3 — a cached copy keeps the fetch time it actually happened at
 * ================================================================== */
{
  const first = await ask(marketsRoute, '/api/data/markets?mode=overview');
  const before = calls.wfp;
  const second = await ask(marketsRoute, '/api/data/markets?mode=overview');
  assert('cache: the second answer is the stored copy', second.body.provenance?.servedFromCache === true, second.body.provenance?.servedFromCache);
  assert('cache: no second bulk download was paid for', calls.wfp === before, { before, after: calls.wfp });
  assert('cache: the retrieval time is the original one, not re-stamped to now', second.body.provenance?.retrievedAt === first.body.provenance?.retrievedAt, {
    first: first.body.provenance?.retrievedAt,
    second: second.body.provenance?.retrievedAt,
  });
  assert('cache: the observation travels with the copy, so the UI shows which is which', second.body.provenance?.observedAt === first.body.provenance?.observedAt);
}

/* ================================================================== *
 * 4 — an old survey month: fresh retrieval, stale data, kept apart
 * ================================================================== */
{
  reset({ wfp: csv(wfpCsv({ surveyDaysAgo: 140 })) });
  const { status, body } = await ask(marketsRoute, '/api/data/markets?mode=overview');
  assert('stale file: still answers', status === 200 && body.ok === true, { status, error: body.error });
  assert('stale file: the observation is the survey month', body.provenance?.observedAt === isoDay(140), body.provenance?.observedAt);
  assert('stale file: the retrieval is today', Date.now() - Date.parse(body.provenance?.retrievedAt) < 120_000, body.provenance?.retrievedAt);
  assert('stale file: and it is marked stale, so no panel can call it current', body.provenance?.stale === true, body.provenance);
  assert('stale file: against the monthly freshness window the source declares', body.provenance?.maxAgeSeconds === 45 * 86_400, body.provenance?.maxAgeSeconds);
}

/* ================================================================== *
 * 5 — a publisher that answers with no bytes at all
 * ================================================================== */
{
  reset({ wfp: EMPTY_200 });
  const { status, body } = await ask(marketsRoute, '/api/data/markets?mode=overview');
  assert('empty: is a failure', status === 502 && body.ok === false, { status });
  assert('empty: code is empty_response, not a claim about parsing', body.error?.code === 'empty_response', body.error);
  assert('empty: never reaches a parser as an empty file', body.error?.code !== 'parse_failed', body.error?.code);
  assert('empty: the block says no content arrived', /sent no content/.test(String(body.unavailable?.reasonDetail)), body.unavailable?.reasonDetail);
  assert('empty: the block repeats the code', body.unavailable?.reason === 'empty_response', body.unavailable?.reason);
  assert('empty: still no invented last-good time', body.unavailable?.lastSuccessfulFetchAt === null, body.unavailable?.lastSuccessfulFetchAt);
  assert('empty: and no invented fetch time either', body.provenance?.retrievedAt === null, body.provenance?.retrievedAt);
}

/* ================================================================== *
 * 5b — flushing the cached payload keeps the record that it once worked
 * ================================================================== */
{
  reset();
  const first = await ask(marketsRoute, '/api/data/markets?mode=overview');
  const held = first.body.provenance?.retrievedAt;
  assert('flush: a successful read is on the record', typeof held === 'string' && typeof lastSuccessAt('wfp:prices:all') === 'number', { held, lastSuccess: lastSuccessAt('wfp:prices:all') });

  Object.assign(publishers, { wfp: BLOCKED_406 });
  cacheClear();
  assert('flush: the history of that read survives a payload flush', lastSuccessAt('wfp:prices:all') !== null, lastSuccessAt('wfp:prices:all'));

  const before = calls.wfp;
  const outage = await ask(marketsRoute, '/api/data/markets?mode=overview');
  // The flush has to be *seen* by the request, or this case would only prove a cached answer is
  // still cached. One new upstream call is that proof.
  assert('flush: but the payload itself is gone, so the publisher is asked again', calls.wfp === before + 1, { upstreamCalls: calls.wfp - before });
  // `lastSuccess` is stamped when the fetch completes and `retrievedAt` when the envelope is built,
  // so the two are compared as the same instant, not the same millisecond.
  const namedLastGood = outage.body.unavailable?.lastSuccessfulFetchAt;
  assert('flush: an outage after a flush still names the last good read',
    outage.body.error?.code === 'publisher_blocked' && typeof namedLastGood === 'string'
      && Math.abs(Date.parse(namedLastGood) - new Date(held).getTime()) < 5_000,
    { code: outage.body.error?.code, lastSuccessfulFetchAt: namedLastGood, held });
  assert('flush: and the refused read did not overwrite the record',
    Math.abs(lastSuccessAt('wfp:prices:all') - new Date(held).getTime()) < 5_000, {
    lastSuccess: lastSuccessAt('wfp:prices:all'), held,
  });
}

/* ================================================================== *
 * 6 — refused after having worked: the last good read survives
 * ================================================================== */
{
  reset();
  const worked = await ask(exchangeRoute, `/api/data/exchange?focus=official&date=${isoDay(2)}`);
  assert('last-good: NBE answered the first request', worked.status === 200 && worked.body.ok === true, { status: worked.status, error: worked.body.error });
  const fetchedAt = Date.parse(worked.body.provenance?.retrievedAt);

  publishers.nbe = BLOCKED_406;
  const failed = await ask(exchangeRoute, `/api/data/exchange?focus=official&date=${isoDay(1)}`);
  assert('last-good: the refusal is reported', failed.status === 502 && failed.body.error?.code === 'publisher_blocked', failed.body.error);
  assert('last-good: the outage does not erase when the publisher last worked', typeof failed.body.unavailable?.lastSuccessfulFetchAt === 'string', failed.body.unavailable);
  assert('last-good: and the time it reports is the successful fetch', Math.abs(Date.parse(failed.body.unavailable?.lastSuccessfulFetchAt) - fetchedAt) < 5_000, {
    notice: failed.body.unavailable?.lastSuccessfulFetchAt,
    provenance: worked.body.provenance?.retrievedAt,
  });
  assert('last-good: the publisher named is NBE', failed.body.unavailable?.publisher === 'National Bank of Ethiopia — Daily Indicative Exchange Rates', failed.body.unavailable?.publisher);

  const before = calls.nbe;
  const again = await ask(exchangeRoute, `/api/data/exchange?focus=official&date=${isoDay(1)}`);
  assert('last-good: the failure was not cached, so recovery shows at once', calls.nbe > before && again.status === 502, { before, after: calls.nbe });
}

/* ================================================================== *
 * 7 — two feeds down, the rest of the page still shows (partial data)
 * ================================================================== */
{
  reset({ wfp: BLOCKED_406, wbCurrency: BLOCKED_406 });
  const { status, body } = await ask(exchangeRoute, '/api/data/exchange?focus=all&points=8&months=18');
  assert('partial: the page still answers', status === 200 && body.ok === true, { status, error: body.error });
  assert('partial: the NBE official series is still shown', (body.data?.official ?? []).length === 8, body.data?.official?.length);
  assert('partial: the World Bank benchmarks are still shown', (body.data?.benchmarks ?? []).length === 3, body.data?.benchmarks?.length);
  assert('partial: only the blocked parallel rate is missing', body.data?.unofficial === null, body.data?.unofficial);
  assert('partial: the missing rate carries its own error', body.errors?.unofficial?.code === 'publisher_blocked', body.errors?.unofficial);
  assert('partial: and its own block', body.unavailable?.unofficial?.reason === 'publisher_blocked', body.unavailable?.unofficial);
  assert('partial: naming the price feed, not the indicators API', body.unavailable?.unofficial?.publisher === 'World Bank Ethiopia Real-Time Prices', body.unavailable?.unofficial?.publisher);
  assert('partial: a working category carries no block', body.unavailable?.official === null && body.unavailable?.benchmark === null, body.unavailable);
  assert('partial: error and block cover exactly the same categories', Object.keys(body.errors).sort().join() === Object.keys(body.unavailable).sort().join(), {
    errors: Object.keys(body.errors),
    blocks: Object.keys(body.unavailable),
  });
  assert('partial: the working categories keep their provenance', body.provenance?.official !== null && body.provenance?.benchmark !== null, Object.keys(body.provenance ?? {}));

  const prices = await ask(marketsRoute, '/api/data/markets?mode=overview');
  assert('partial: the blocked price panel fails alone, without taking FX with it', prices.status === 502 && prices.body.unavailable?.publisher === 'WFP Ethiopia Food Prices (rEMS)', prices.body.unavailable);
}

/* ================================================================== *
 * 8 — a failing source is attributed to itself, never its neighbour
 * ================================================================== */
{
  reset({ wbApi: SERVER_500 });
  const { body } = await ask(exchangeRoute, '/api/data/exchange?focus=all&points=8&months=18');
  assert('attribution: the benchmarks category is the one missing', body.data?.benchmarks === null && body.data?.unofficial !== null, Object.keys(body.data ?? {}));
  assert('attribution: and it names the indicators publisher', body.unavailable?.benchmark?.publisher === 'World Bank Open Data — Ethiopia indicators', body.unavailable?.benchmark?.publisher);
  assert('attribution: the block is not borrowed from the price feed', body.unavailable?.benchmark?.publisher !== body.unavailable?.unofficial?.publisher, body.unavailable);
  assert('attribution: a 500 is not turned into a credential problem', body.errors?.benchmark?.code === 'http_status', body.errors?.benchmark);
  assert('attribution: a working source keeps its own provenance', body.provenance?.unofficial?.source === 'World Bank Ethiopia Real-Time Prices', body.provenance?.unofficial?.source);
}

/* ================================================================== *
 * 9 — the publisher answered and simply had nothing for this scope
 * ================================================================== */
{
  reset();
  const empty = await ask(marketsRoute, '/api/data/markets?mode=snapshot&months=6&limit=400&region=Somewhere Not Surveyed');
  assert('empty scope: still a success, because the publisher answered', empty.status === 200 && empty.body.ok === true, { status: empty.status, error: empty.body.error });
  assert('empty scope: no rows are invented', (empty.body.data?.rows ?? []).length === 0, empty.body.data?.rows?.length);
  assert('empty scope: no movement is invented', (empty.body.data?.changes ?? []).length === 0, empty.body.data?.changes?.length);
  assert('empty scope: and no outage block, which is what the panel renders apart', empty.body.unavailable === undefined, Object.keys(empty.body));
  assert('empty scope: the survey month it did look at is still named', empty.body.provenance?.observedAt === isoDay(20), empty.body.provenance?.observedAt);

  const missing = await ask(marketsRoute, '/api/data/markets?mode=history&commodity=Quinoa&months=36');
  assert('missing commodity: is no_data rather than an outage', missing.status === 404 && missing.body.error?.code === 'no_data', { status: missing.status, code: missing.body.error?.code });
  assert('missing commodity: the block says the file was read and holds no such row', /holds no rows/.test(String(missing.body.unavailable?.reasonDetail)), missing.body.unavailable?.reasonDetail);
  assert('missing commodity: no alternative publisher is implied', missing.body.unavailable?.substituteUsed === false, missing.body.unavailable);
  assert('missing commodity: the message names the scope it looked in', /Quinoa/.test(String(missing.body.error?.message)), missing.body.error?.message);
  assert(
    'missing commodity: the provenance describes the copy actually held, not a fresh fetch',
    missing.body.provenance?.servedFromCache === true && missing.body.provenance?.retrievedAt === empty.body.provenance?.retrievedAt,
    { servedFromCache: missing.body.provenance?.servedFromCache, retrievedAt: missing.body.provenance?.retrievedAt, held: empty.body.provenance?.retrievedAt },
  );
}

/* ------------------------------------------------------------------ */

console.log(`\n${checks - failures}/${checks} market-availability assertions passed`);
note('every case above runs against a stubbed publisher answer: these assert how our data path reports, and are not evidence about any publisher.');
process.exit(failures === 0 ? 0 : 1);
