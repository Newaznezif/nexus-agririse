"use client";
import { ComparisonRow } from '@/services/comparison';
import { RiskBadge } from './RiskBadge';

interface CountryComparisonTableProps {
  rows: ComparisonRow[];
}

export const CountryComparisonTable = ({ rows }: CountryComparisonTableProps) => {
  if (rows.length === 0) {
    return (
      <div className="bg-white dark:bg-zinc-900 p-10 rounded-xl border border-dashed border-gray-200 dark:border-zinc-700 text-center text-gray-500 text-sm">
        No comparison data available. Upload datasets from multiple countries to begin.
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-100 dark:border-zinc-800 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm text-gray-600 dark:text-gray-300 min-w-[800px]">
          <thead className="bg-gray-50 dark:bg-zinc-950 text-gray-500 text-xs uppercase sticky top-0">
            <tr>
              <th className="px-6 py-3 font-medium">Country</th>
              <th className="px-6 py-3 font-medium">Dataset / Product</th>
              <th className="px-6 py-3 font-medium">Market Trend</th>
              <th className="px-6 py-3 font-medium">Risk Level</th>
              <th className="px-6 py-3 font-medium">Opportunity</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
            {rows.map((row, i) => (
              <tr key={i} className={`transition-colors hover:bg-gray-50 dark:hover:bg-zinc-800/50 ${i % 2 === 0 ? '' : 'bg-gray-50/50 dark:bg-zinc-900/50'}`}>
                <td className="px-6 py-4 font-semibold text-gray-900 dark:text-white whitespace-nowrap">{row.country}</td>
                <td className="px-6 py-4 whitespace-nowrap">{row.product}</td>
                <td className="px-6 py-4 max-w-[200px]">
                  <span className="truncate block">{row.marketTrend}</span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {row.riskLevel !== '—' ? <RiskBadge level={row.riskLevel} /> : <span className="text-gray-400">—</span>}
                </td>
                <td className="px-6 py-4 max-w-[250px]">
                  <span className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">{row.opportunity}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
