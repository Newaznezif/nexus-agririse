"use client";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, Cell
} from 'recharts';
import { CountryData } from '@/services/comparison';

interface ComparisonChartProps {
  countryDataList: CountryData[];
}

const RISK_SCORE: Record<string, number> = { 'Low': 1, 'Medium': 2, 'High': 3, 'N/A': 0 };
const COUNTRY_COLORS: Record<string, string> = {
  'Ethiopia': '#059669',
  'Rwanda': '#3b82f6',
  'Central African Republic': '#f59e0b',
};

export const ComparisonChart = ({ countryDataList }: ComparisonChartProps) => {
  const chartData = countryDataList.map((c) => ({
    country: c.country === 'Central African Republic' ? 'CAR' : c.country,
    fullName: c.country,
    datasets: c.datasetCount,
    insights: c.insights.length,
    riskScore: RISK_SCORE[c.riskLevel] ?? 0,
  }));

  const hasData = chartData.some(d => d.datasets > 0 || d.insights > 0);

  if (!hasData) {
    return (
      <div className="bg-white dark:bg-zinc-900 rounded-xl border border-dashed border-gray-200 dark:border-zinc-700 p-10 flex items-center justify-center text-gray-400 text-sm italic">
        Upload datasets from multiple countries to see comparison charts.
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-100 dark:border-zinc-800 shadow-sm p-6">
      <h3 className="font-semibold text-lg mb-6">Data Coverage by Country</h3>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="country" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
          <Tooltip
            formatter={(value: any, name: any) => [value, name === 'datasets' ? 'Datasets' : 'AI Insights']}
            labelFormatter={(label: any) => {
              const item = chartData.find(d => d.country === label);
              return item?.fullName || label;
            }}
            contentStyle={{ borderRadius: '8px', fontSize: '12px' }}
          />
          <Legend />
          <Bar dataKey="datasets" name="Datasets" radius={[4, 4, 0, 0]}>
            {chartData.map((entry, index) => (
              <Cell key={index} fill={COUNTRY_COLORS[entry.fullName] || '#6b7280'} />
            ))}
          </Bar>
          <Bar dataKey="insights" name="AI Insights" fill="#a78bfa" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};
