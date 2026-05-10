import React from 'react';

interface StatsCardProps {
  title: string;
  value: string | number;
  subtitle: string;
}

export const StatsCard = ({ title, value, subtitle }: StatsCardProps) => {
  return (
    <div className="bg-white dark:bg-zinc-900 p-6 rounded-xl border border-gray-100 dark:border-zinc-800 shadow-sm flex flex-col">
      <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">{title}</h3>
      <p className="text-3xl font-bold text-gray-900 dark:text-white">{value}</p>
      <p className="text-xs text-gray-400 mt-2">{subtitle}</p>
    </div>
  );
};
