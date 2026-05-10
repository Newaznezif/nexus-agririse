import React from 'react';

export const InsightSkeleton = () => {
  return (
    <div className="bg-white dark:bg-zinc-900 p-6 rounded-xl border border-gray-100 dark:border-zinc-800 shadow-sm animate-pulse flex flex-col gap-4">
      <div className="h-6 bg-gray-200 dark:bg-zinc-800 rounded w-1/3 mb-4"></div>
      
      <div className="space-y-3">
        <div className="h-4 bg-gray-200 dark:bg-zinc-800 rounded w-full"></div>
        <div className="h-4 bg-gray-200 dark:bg-zinc-800 rounded w-5/6"></div>
        <div className="h-4 bg-gray-200 dark:bg-zinc-800 rounded w-4/6"></div>
      </div>
      
      <div className="grid grid-cols-2 gap-4 mt-4">
        <div className="h-20 bg-gray-200 dark:bg-zinc-800 rounded"></div>
        <div className="h-20 bg-gray-200 dark:bg-zinc-800 rounded"></div>
      </div>
    </div>
  );
};
