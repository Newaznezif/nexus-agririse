'use client';
import React from 'react';
import { Loader2 } from 'lucide-react';

export const Panel = ({
  title,
  hint,
  right,
  children,
  className = '',
}: {
  title: string;
  hint?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) => (
  <section className={`bg-white dark:bg-zinc-900 rounded-2xl border border-gray-100 dark:border-zinc-800 shadow-sm p-4 md:p-5 ${className}`}>
    <div className="flex items-start justify-between gap-3">
      <div>
        <h2 className="text-xs font-black uppercase tracking-widest text-gray-400">{title}</h2>
        {hint && <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 leading-relaxed max-w-2xl">{hint}</p>}
      </div>
      {right}
    </div>
    <div className="mt-4">{children}</div>
  </section>
);

export const Loading = ({ label = 'Loading' }: { label?: string }) => (
  <div className="flex items-center gap-2 py-8 text-sm text-gray-500 dark:text-gray-400">
    <Loader2 size={16} className="animate-spin" />
    {label}…
  </div>
);

export const Refreshing = () => (
  <span className="flex items-center gap-1.5 text-[11px] text-gray-400">
    <Loader2 size={12} className="animate-spin" />
    updating
  </span>
);

export const Metric = ({ label, value, unit, tone }: { label: string; value: string; unit?: string; tone?: 'good' | 'bad' | 'warn' }) => {
  const toneCls =
    tone === 'good'
      ? 'text-emerald-600 dark:text-emerald-400'
      : tone === 'bad'
        ? 'text-red-600 dark:text-red-400'
        : tone === 'warn'
          ? 'text-amber-600 dark:text-amber-400'
          : 'text-gray-900 dark:text-white';
  return (
    <div className="p-3 rounded-xl bg-gray-50 dark:bg-zinc-800/60 border border-gray-100 dark:border-zinc-800">
      <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{label}</p>
      <p className={`text-xl font-black tracking-tight mt-1 ${toneCls}`}>
        {value}
        {unit && <span className="text-xs font-semibold text-gray-400 ml-1">{unit}</span>}
      </p>
    </div>
  );
};

/** Consistent, locale-stable number formatting; null never becomes 0. */
export const fmt = (value: number | null | undefined, digits = 1): string =>
  value === null || value === undefined || Number.isNaN(value) ? '—' : value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const fmtInt = (value: number | null | undefined): string =>
  value === null || value === undefined || Number.isNaN(value) ? '—' : Math.round(value).toLocaleString('en-US');

export const monthLabel = (isoMonthOrDate: string): string => {
  const t = Date.parse(isoMonthOrDate.length === 7 ? `${isoMonthOrDate}-01T00:00:00Z` : isoMonthOrDate);
  if (Number.isNaN(t)) return isoMonthOrDate;
  return new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(t));
};

export const dayLabel = (isoDate: string): string => {
  const t = Date.parse(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(t)) return isoDate;
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(t));
};
