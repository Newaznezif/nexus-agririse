import React from 'react';
import { LucideIcon } from 'lucide-react';

interface StatsCardProps {
  title: string;
  value: string | number;
  subtitle: string;
  icon?: LucideIcon;
  iconColor?: string;
  iconBg?: string;
  trend?: { value: string; up: boolean };
}

export const StatsCard = ({
  title,
  value,
  subtitle,
  icon: Icon,
  iconColor = 'text-emerald-600 dark:text-emerald-400',
  iconBg = 'bg-emerald-50 dark:bg-emerald-900/20',
  trend,
}: StatsCardProps) => {
  return (
    <div className="bg-white dark:bg-zinc-900 p-6 rounded-2xl border border-gray-100 dark:border-zinc-800 shadow-sm hover:shadow-md transition-shadow flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{title}</p>
        {Icon && (
          <div className={`w-10 h-10 rounded-xl ${iconBg} flex items-center justify-center ${iconColor}`}>
            <Icon size={20} />
          </div>
        )}
      </div>
      <div>
        <p className="text-3xl font-black text-gray-900 dark:text-white tracking-tight">{value}</p>
        <div className="flex items-center gap-2 mt-1.5">
          <p className="text-xs text-gray-400">{subtitle}</p>
          {trend && (
            <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-md ${
              trend.up
                ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400'
                : 'bg-red-50 text-red-500 dark:bg-red-900/20 dark:text-red-400'
            }`}>
              {trend.up ? '↑' : '↓'} {trend.value}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
