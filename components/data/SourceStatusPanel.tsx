'use client';
import React, { useState } from 'react';
import { RefreshCw } from 'lucide-react';

import { useLiveData } from '@/hooks/useLiveData';
import { Panel, Refreshing } from '@/components/data/ui';

interface SourceRow {
  id: string;
  name: string;
  category: string;
  cadence: string;
  homeUrl: string;
  license: string;
  requiresKey: boolean;
  state: 'connected' | 'stale' | 'unavailable' | 'auth_required' | 'disabled';
  detail: string;
  observedAt: string | null;
  retrievedAt: string | null;
  stale: boolean;
}

interface SyncRow {
  sourceKey: string;
  status: 'succeeded' | 'partial' | 'failed' | 'skipped_overlap';
  finishedAt: string | null;
  rowsWritten: number;
  observedAt: string | null;
  errorMessage: string | null;
}

interface StatusPayload {
  checkedAt: string;
  counts: Record<string, number>;
  sources: SourceRow[];
  /** Absent when the caller did not ask for it; empty when configured but never run. */
  sync?: SyncRow[];
}

const SYNC_LABEL: Record<SyncRow['status'], string> = {
  succeeded: 'last run wrote everything',
  partial: 'last run wrote some publishers',
  failed: 'last run wrote nothing',
  skipped_overlap: 'skipped, another run was active',
};

const STATE_STYLE: Record<SourceRow['state'], { label: string; dot: string; text: string }> = {
  connected: { label: 'Connected', dot: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-400' },
  stale: { label: 'Behind schedule', dot: 'bg-orange-500', text: 'text-orange-700 dark:text-orange-400' },
  unavailable: { label: 'Unavailable', dot: 'bg-red-500', text: 'text-red-700 dark:text-red-400' },
  auth_required: { label: 'Credentials needed', dot: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-400' },
  disabled: { label: 'Turned off', dot: 'bg-gray-400', text: 'text-gray-600 dark:text-gray-400' },
};

/**
 * Reports each publisher's actual connection state, from a live probe of that
 * source — not from a config flag. The cadence column is the guard against
 * misreading a monthly or annual series as a real-time figure.
 */
export const SourceStatusPanel = () => {
  const [scope, setScope] = useState<'light' | 'all'>('light');
  const { data, loading, refreshing, error, reload } = useLiveData<StatusPayload>(`/api/data/status?sources=${scope}&persisted=1`);

  const rows = data?.sources ?? [];

  return (
    <Panel
      title="Source status"
      hint="Each row is one live probe of the publisher itself. A source we cannot reach is reported as unreachable with the reason, never hidden or replaced."
      right={
        <div className="flex items-center gap-2 shrink-0">
          {refreshing && <Refreshing />}
          <button
            type="button"
            onClick={reload}
            className="p-1.5 rounded-lg border border-gray-200 dark:border-zinc-700 text-gray-500 hover:text-emerald-600"
            aria-label="Re-check sources"
          >
            <RefreshCw size={13} />
          </button>
        </div>
      }
    >
      <div className="flex items-center gap-2 mb-3">
        {(['light', 'all'] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setScope(option)}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-black uppercase tracking-wider transition-colors ${
              scope === option
                ? 'bg-emerald-600 text-white'
                : 'bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-zinc-700'
            }`}
          >
            {option === 'light' ? 'Core sources' : 'All sources'}
          </button>
        ))}
        {data && (
          <span className="text-[11px] text-gray-400 ml-auto">
            {Object.entries(data.counts)
              .map(([state, n]) => `${n} ${state.replace('_', ' ')}`)
              .join(' · ')}
          </span>
        )}
      </div>

      {loading && <p className="py-6 text-sm text-gray-500">Probing sources…</p>}
      {error && !loading && <p className="py-6 text-sm text-red-600 dark:text-red-400">{error.message}</p>}

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] font-black uppercase tracking-widest text-gray-400 border-b border-gray-100 dark:border-zinc-800">
                <th className="py-2 pr-3">Source</th>
                <th className="py-2 pr-3">State</th>
                <th className="py-2 pr-3">Published as</th>
                <th className="py-2 pr-3">Newest observation</th>
                <th className="py-2">Detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const style = STATE_STYLE[row.state] ?? STATE_STYLE.disabled;
                return (
                  <tr key={row.id} className="border-b border-gray-50 dark:border-zinc-800/60 align-top">
                    <td className="py-2.5 pr-3">
                      <a
                        href={row.homeUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold text-gray-900 dark:text-white underline decoration-gray-200 dark:decoration-zinc-700 underline-offset-2 hover:text-emerald-600"
                      >
                        {row.name}
                      </a>
                      <p className="text-[10px] text-gray-400 mt-0.5">{row.license}</p>
                    </td>
                    <td className="py-2.5 pr-3">
                      <span className={`flex items-center gap-1.5 whitespace-nowrap font-semibold ${style.text}`}>
                        <span className={`w-2 h-2 rounded-full ${style.dot}`} />
                        {style.label}
                      </span>
                      {row.requiresKey && <p className="text-[10px] text-gray-400 mt-0.5">API key required</p>}
                    </td>
                    <td className="py-2.5 pr-3 text-gray-600 dark:text-gray-400 capitalize whitespace-nowrap">{row.cadence}</td>
                    <td className="py-2.5 pr-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">{row.observedAt ?? '—'}</td>
                    <td className="py-2.5 text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed max-w-md">{row.detail}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {data && (
        <p className="text-[11px] text-gray-400 mt-3">
          Probes ran at {new Date(data.checkedAt).toLocaleString('en-GB', { timeZone: 'Africa/Addis_Ababa' })} EAT.{' '}
          {scope === 'light' ? '“All sources” also checks the large price and indicator feeds, which take longer.' : ''}
        </p>
      )}

      {data && (
        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-zinc-800">
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5">Stored pipeline</p>
          {(data.sync ?? []).length === 0 ? (
            <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
              No sync run has been recorded for this database, so nothing above is served from storage — every figure on
              this dashboard came from the publisher in this request. That is the working configuration; the sync only
              adds history and survives a publisher outage.
            </p>
          ) : (
            <ul className="space-y-1">
              {(data.sync ?? []).map((run) => (
                <li key={run.sourceKey} className="text-[11px] text-gray-600 dark:text-gray-400 flex flex-wrap gap-x-2">
                  <span className="font-semibold text-gray-800 dark:text-gray-200">{run.sourceKey}</span>
                  <span>{SYNC_LABEL[run.status] ?? run.status}</span>
                  <span>{run.rowsWritten.toLocaleString('en-US')} rows</span>
                  <span>{run.finishedAt ? new Date(run.finishedAt).toLocaleString('en-GB', { timeZone: 'Africa/Addis_Ababa' }) : 'unfinished'}</span>
                  {run.errorMessage && <span className="text-red-600 dark:text-red-400">{run.errorMessage}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Panel>
  );
};
