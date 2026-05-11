"use client";

import { useState } from 'react';
import { Dataset } from '@/types';
import { Database, FileText, Globe, CalendarDays, CheckCircle2, Search, Inbox } from 'lucide-react';

interface DatasetTableProps {
  datasets: Dataset[];
}

const FLAG_MAP: Record<string, string> = {
  'Ethiopia': '🇪🇹',
  'Rwanda': '🇷🇼',
  'Central African Republic': '🇨🇫',
  'Kenya': '🇰🇪',
  'Tanzania': '🇹🇿',
  'Uganda': '🇺🇬',
  'Nigeria': '🇳🇬',
};

export const DatasetTable = ({ datasets }: DatasetTableProps) => {
  const [search, setSearch] = useState('');

  const filtered = datasets.filter(ds =>
    ds.name.toLowerCase().includes(search.toLowerCase()) ||
    (ds.country || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-100 dark:border-zinc-800 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-6 py-5 border-b border-gray-100 dark:border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-xl text-blue-600 dark:text-blue-400">
            <Database size={18} />
          </div>
          <div>
            <h3 className="font-semibold text-base text-gray-900 dark:text-white">Dataset Library</h3>
            <p className="text-xs text-gray-400">{datasets.length} dataset{datasets.length !== 1 ? 's' : ''} total</p>
          </div>
        </div>
        {datasets.length > 0 && (
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search datasets…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8 pr-4 py-2 text-sm border border-gray-200 dark:border-zinc-700 rounded-xl bg-gray-50 dark:bg-zinc-800 text-gray-700 dark:text-gray-300 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent w-full sm:w-52 transition-all"
            />
          </div>
        )}
      </div>

      {/* Empty State */}
      {datasets.length === 0 ? (
        <div className="p-14 flex flex-col items-center justify-center text-center gap-3">
          <div className="w-14 h-14 rounded-2xl bg-gray-50 dark:bg-zinc-800 flex items-center justify-center">
            <Inbox size={24} className="text-gray-300 dark:text-gray-600" />
          </div>
          <p className="font-semibold text-gray-600 dark:text-gray-400">No datasets yet</p>
          <p className="text-xs text-gray-400 max-w-[220px] leading-relaxed">
            Upload your first agricultural CSV to begin generating AI insights.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="p-10 text-center text-sm text-gray-400">
          No datasets match &ldquo;{search}&rdquo;
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-zinc-950 text-gray-500 dark:text-gray-400">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider">
                  <div className="flex items-center gap-1.5"><FileText size={12} /> Dataset Name</div>
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider">
                  <div className="flex items-center gap-1.5"><Globe size={12} /> Country</div>
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider">Type</th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider">
                  <div className="flex items-center gap-1.5"><CalendarDays size={12} /> Uploaded</div>
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-zinc-800">
              {filtered.map((ds) => {
                const date = ds.created_at
                  ? new Date(ds.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                  : '—';
                const flag = FLAG_MAP[ds.country || ''] || '🌍';
                return (
                  <tr key={ds.id} className="hover:bg-gray-50/70 dark:hover:bg-zinc-800/40 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center shrink-0">
                          <FileText size={14} className="text-emerald-600 dark:text-emerald-400" />
                        </div>
                        <span className="font-medium text-gray-900 dark:text-white truncate max-w-[220px]" title={ds.name}>
                          {ds.name}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2 text-gray-600 dark:text-gray-300">
                        <span>{flag}</span>
                        <span>{ds.country || 'Global'}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="px-2.5 py-1 rounded-md text-xs font-semibold bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-gray-300 uppercase">
                        {ds.type || 'CSV'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-500 dark:text-gray-400">{date}</td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400">
                        <CheckCircle2 size={11} />
                        Processed
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
