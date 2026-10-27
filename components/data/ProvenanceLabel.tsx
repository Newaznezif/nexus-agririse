'use client';
import React from 'react';

/**
 * Client-side mirror of the provenance block every data route returns.
 * Kept structural (not imported from `lib/data`) so page bundles do not pull
 * server code in; the fields are a subset and all optional-tolerant.
 */
export interface ProvenanceView {
  source: string;
  sourceUrl: string;
  retrievedAt: string;
  observedAt: string | null;
  valueKind: 'observed' | 'modeled' | 'forecast' | 'estimated' | 'imputed';
  units: string;
  methodology: string;
  quality: 'high' | 'medium' | 'low';
  coverage: string;
  stale: boolean;
  servedFromCache: boolean;
}

export interface SourceErrorView {
  code: string;
  message: string;
  status?: number;
}

const KIND_LABEL: Record<ProvenanceView['valueKind'], { label: string; cls: string }> = {
  observed: { label: 'Observed', cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400' },
  modeled: { label: 'Modelled', cls: 'bg-sky-50 text-sky-700 dark:bg-sky-900/20 dark:text-sky-400' },
  forecast: { label: 'Forecast', cls: 'bg-violet-50 text-violet-700 dark:bg-violet-900/20 dark:text-violet-400' },
  estimated: { label: 'Derived', cls: 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400' },
  imputed: { label: 'Filled in', cls: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400' },
};

function formatStamp(value: string): string {
  const t = Date.parse(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(t)) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Addis_Ababa' }).format(new Date(t));
}

interface Props {
  provenance: ProvenanceView | null;
  /** Short context shown before the source link, e.g. "Dessie · S. WELLO". */
  context?: string;
  compact?: boolean;
}

/**
 * Every figure on the dashboard is followed by this block: who published it, when
 * it was observed, when we fetched it, and what kind of number it is. A cached
 * answer is labelled cached, and a late publication is labelled stale.
 */
export const ProvenanceLabel = ({ provenance, context, compact = false }: Props) => {
  if (!provenance) {
    return (
      <p className="text-[11px] text-gray-400 dark:text-gray-500">
        No source available for this figure.
      </p>
    );
  }

  const kind = KIND_LABEL[provenance.valueKind] ?? KIND_LABEL.estimated;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
      <span className={`px-1.5 py-0.5 rounded-md font-semibold ${kind.cls}`}>{kind.label}</span>
      {provenance.stale && (
        <span className="px-1.5 py-0.5 rounded-md font-semibold bg-orange-50 text-orange-700 dark:bg-orange-900/20 dark:text-orange-400">
          Behind schedule
        </span>
      )}
      {provenance.servedFromCache && (
        <span className="px-1.5 py-0.5 rounded-md font-semibold bg-gray-100 text-gray-600 dark:bg-zinc-800 dark:text-gray-400">
          Cached copy
        </span>
      )}
      <span className="font-semibold text-gray-600 dark:text-gray-300">{provenance.source}</span>
      <a
        href={provenance.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="underline decoration-gray-300 underline-offset-2 hover:text-emerald-600 dark:hover:text-emerald-400"
      >
        source
      </a>
      {!compact && (
        <>
          <span aria-hidden>·</span>
          <span>observed {provenance.observedAt ? formatStamp(provenance.observedAt) : 'date not stated'}</span>
          <span aria-hidden>·</span>
          <span>fetched {formatStamp(provenance.retrievedAt)} (EAT)</span>
          <span aria-hidden>·</span>
          <span title={provenance.methodology}>{provenance.units}</span>
          {context && (
            <>
              <span aria-hidden>·</span>
              <span>{context}</span>
            </>
          )}
        </>
      )}
    </div>
  );
};

/** Honest empty state: the reason, the source, and no invented number. */
export const SourceUnavailable = ({ error, source }: { error: SourceErrorView; source?: string }) => (
  <div className="rounded-xl border border-dashed border-orange-200 dark:border-orange-900/50 bg-orange-50/40 dark:bg-orange-950/10 p-4">
    <p className="text-xs font-black uppercase tracking-widest text-orange-700 dark:text-orange-400">
      Not available
    </p>
    <p className="text-sm text-gray-700 dark:text-gray-300 mt-1.5 leading-relaxed">
      {source ? `${source}: ` : ''}
      {error.message}
    </p>
    <p className="text-[11px] text-gray-500 dark:text-gray-500 mt-1.5">
      Code <code className="font-mono">{error.code}</code>. No substitute value is shown for this source.
    </p>
  </div>
);
