/**
 * Transport-level checks for `lib/data/http.ts`, against a stubbed fetch.
 *
 * This is the one place in the harness set where the upstream is deliberately not real: these
 * assertions are about how a *status code and a header line* are turned into a `SourceError`,
 * and the two conditions they pin were each measured arriving from a live publisher
 * (HDX, 2026-11-04: HTTP 406 `{"error":"Blocked due to bot activity."}` and HTTP 202 with
 * `x-amzn-waf-action: challenge` and a zero-byte body). No publisher data is involved, so
 * nothing here can pass a value off as a source's answer — a stub is the only way to make the
 * zero-byte case reproducible, because the real edge does not offer it on demand.
 *
 * Run: node scripts/check-http-transport.mjs
 */

import { register } from 'node:module';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');
register(pathToFileURL(resolvePath(ROOT, 'scripts/ts-report-hooks.mjs')).href, import.meta.url);
const { httpText, httpJson } = await import(pathToFileURL(resolvePath(ROOT, 'lib/data/http.ts')).href);

let checks = 0;
let failures = 0;
const assert = (label, cond, detail) => {
  checks += 1;
  if (cond) return;
  failures += 1;
  console.log(`  FAIL  ${label}${detail === undefined ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
};

const realFetch = globalThis.fetch;
/** Serve one canned response and record what the client actually sent. */
function stubResponse({ status, headers = {}, body = '' }) {
  const seen = { headers: null, count: 0 };
  globalThis.fetch = async (url, init) => {
    seen.count += 1;
    seen.headers = init.headers;
    return new Response(body, { status, headers });
  };
  return { seen, restore: () => { globalThis.fetch = realFetch; } };
}

/* 1 — a 406 bot refusal is named as such, is not retried, and is not reported as missing data. */
{
  const stub = stubResponse({ status: 406, headers: { 'content-type': 'application/json' }, body: '{"error":"Blocked due to bot activity."}' });
  const res = await httpText('https://example.test/prices.csv');
  assert('406: code is publisher_blocked', res.ok === false && res.error.code === 'publisher_blocked', res.ok ? 'answered ok' : res.error);
  assert('406: the message says the data is published', res.ok === false && /still published/.test(res.error.message), res.ok ? '' : res.error.message);
  assert('406: the status is carried through', res.ok === false && res.error.status === 406);
  assert('406: not retried', stub.seen.count === 1, { requests: stub.seen.count });
  stub.restore();
}

/* 2 — the WAF challenge form of the same refusal (a 2xx!) is still a refusal. */
{
  const stub = stubResponse({ status: 202, headers: { 'x-amzn-waf-action': 'challenge' } });
  const res = await httpText('https://example.test/prices.csv');
  assert('202 challenge: code is publisher_blocked', res.ok === false && res.error.code === 'publisher_blocked', res.ok ? 'answered ok' : res.error);
  assert('202 challenge: names the challenge, not the data', res.ok === false && /challenge/.test(res.error.message), res.ok ? '' : res.error.message);
  assert('202 challenge: not retried', stub.seen.count === 1, { requests: stub.seen.count });
  stub.restore();
}

/* 2b — but a WAF header on a response that really did carry the file is not a reason to drop it. */
{
  const stub = stubResponse({ status: 200, headers: { 'content-type': 'text/csv', 'x-amzn-waf-action': 'challenge' }, body: 'date,market,price\n2026-10-15,Dessie,4200\n' });
  const res = await httpText('https://example.test/prices.csv');
  assert('200 + WAF header + body: the file is served', res.ok === true && res.text.includes('Dessie'), res.ok ? res.text : res.error);
  stub.restore();
}

/* 3 — a 2xx with no body must never reach a parser as an empty document. */
{
  const stub = stubResponse({ status: 200, headers: { 'content-type': 'text/csv' }, body: '' });
  const res = await httpText('https://example.test/prices.csv');
  assert('empty 200: is a failure, not an empty file', res.ok === false, res.ok ? { text: JSON.stringify(res.text) } : res.error);
  assert('empty 200: code is empty_response', res.ok === false && res.error.code === 'empty_response', res.ok ? '' : res.error);
  assert('empty 200: does not claim a parse result', res.ok === false && res.error.code !== 'parse_failed');
  assert('empty 200: retried, because reading no bytes is cheap', stub.seen.count === 3, { requests: stub.seen.count });
  stub.restore();
}

/* 4 — Accept is a legal media range per payload kind. */
{
  for (const [kind, call] of [['text', httpText], ['json', httpJson]]) {
    const stub = stubResponse({ status: 200, headers: { 'content-type': 'text/csv' }, body: kind === 'json' ? '{"a":1}' : 'a,b\n1,2' });
    const res = await call('https://example.test/x');
    assert(`${kind}: succeeds on a real body`, res.ok === true, res.ok ? '' : res.error);
    const accept = String(stub.seen.headers.accept);
    const ranges = accept.split(',').map((s) => s.trim());
    assert(`${kind}: every Accept range is type/subtype`, ranges.every((r) => /^[a-z0-9.*+-]+\/[a-z0-9.*+-]+$/.test(r)), accept);
    assert(`${kind}: Accept does not contain a bare type`, !ranges.some((r) => r === 'text'), accept);
    stub.restore();
  }
}

/* 5 — the pre-existing rules still hold, so this change did not move them. */
{
  const stub503 = stubResponse({ status: 503 });
  const r503 = await httpText('https://example.test/x');
  assert('503: still retried and still http_status', r503.ok === false && r503.error.code === 'http_status' && stub503.seen.count === 3, { code: r503.ok ? '' : r503.error.code, requests: stub503.seen.count });
  stub503.restore();

  const stub404 = stubResponse({ status: 404 });
  const r404 = await httpText('https://example.test/x');
  assert('404: still not retried', r404.ok === false && stub404.seen.count === 1, { requests: stub404.seen.count });
  stub404.restore();

  const stubJson = stubResponse({ status: 200, headers: { 'content-type': 'application/json' }, body: 'not json at all' });
  const rJson = await httpJson('https://example.test/x');
  assert('bad JSON body: still parse_failed', rJson.ok === false && rJson.error.code === 'parse_failed', rJson.ok ? '' : rJson.error);
  stubJson.restore();
}

console.log(`\n${checks - failures}/${checks} transport assertions passed`);
process.exit(failures === 0 ? 0 : 1);
