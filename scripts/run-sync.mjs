#!/usr/bin/env node
/**
 * Trigger a data sync run against a deployed (or local) server.
 *
 *   cd ~/NexusAgririse
 *   SYNC_URL=https://your-app.example.com SYNC_SECRET='the-server-secret' npm run sync:data
 *   SYNC_URL=http://localhost:3000        SYNC_SECRET='…' node scripts/run-sync.mjs --tasks market-prices,climate
 *
 * Why it calls the HTTP endpoint instead of importing the sync code: the sync needs the
 * database service-role key, which lives on the server and must never be copied to a laptop.
 * This script holds only the shared trigger secret, reads both from the environment, and
 * prints neither.
 *
 * Exits 0 on a run that wrote something, 1 on a blocked/failed run, 2 on a transport error.
 */

const args = process.argv.slice(2);
const flagValue = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1] ?? null;
};

const base = (process.env.SYNC_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const secret = process.env.SYNC_SECRET ?? '';

if (!secret) {
  console.error('SYNC_SECRET is not set. Export it first (it is the value configured on the server).');
  console.error('  SYNC_SECRET=… npm run sync:data');
  process.exit(2);
}

const tasks = flagValue('--tasks');
const body = tasks
  ? { tasks: tasks.split(',').map((t) => t.trim()).filter(Boolean) }
  : {};

let res;
try {
  res = await fetch(`${base}/api/data/sync`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
} catch (err) {
  console.error(`Could not reach ${base}/api/data/sync: ${err instanceof Error ? err.name : 'unknown error'}`);
  console.error('The sync runs on the server, so the server must be reachable and configured.');
  process.exit(2);
}

const report = await res.json().catch(() => null);
if (!report) {
  console.error(`The endpoint answered ${res.status} without a JSON body.`);
  process.exit(2);
}

if (res.status === 401) {
  console.error('Rejected: the bearer token did not match the server’s SYNC_SECRET.');
  process.exit(1);
}

const pad = (text, width) => String(text).padEnd(width);
console.log(`Sync ${report.ranAt ?? ''} → ${report.finishedAt ?? ''}  (run #${report.runId ?? 'none'})`);
if (report.blocked) console.log(`BLOCKED: ${report.blocked}`);

const tasksReport = report.tasks ?? [];
if (tasksReport.length === 0) console.log('No task reported.');
for (const task of tasksReport) {
  console.log(
    `  ${pad(task.task, 15)} ${pad(task.status, 16)} wrote ${pad(task.rowsWritten, 7)} rejected ${pad(task.rowsRejected, 6)} newest ${task.observedAt ?? '—'}` +
      (task.error ? `  ${task.error.code}: ${task.error.message}` : ''),
  );
}

const failed = report.blocked || tasksReport.some((t) => t.status === 'failed');
process.exit(failed ? 1 : 0);
