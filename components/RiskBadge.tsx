import React from 'react';

interface RiskBadgeProps {
  level: "Low" | "Medium" | "High" | string;
}

export const RiskBadge = ({ level }: RiskBadgeProps) => {
  let bgClass = "bg-gray-100 dark:bg-zinc-800";
  let textClass = "text-gray-800 dark:text-gray-300";
  let dotClass = "bg-gray-500";

  if (level === "Low") {
    bgClass = "bg-emerald-100 dark:bg-emerald-900/30";
    textClass = "text-emerald-800 dark:text-emerald-400";
    dotClass = "bg-emerald-500";
  } else if (level === "Medium") {
    bgClass = "bg-yellow-100 dark:bg-yellow-900/30";
    textClass = "text-yellow-800 dark:text-yellow-400";
    dotClass = "bg-yellow-500";
  } else if (level === "High") {
    bgClass = "bg-red-100 dark:bg-red-900/30";
    textClass = "text-red-800 dark:text-red-400";
    dotClass = "bg-red-500";
  }

  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium ${bgClass} ${textClass}`}>
      <span className={`w-2 h-2 rounded-full ${dotClass}`}></span>
      {level}
    </div>
  );
};
