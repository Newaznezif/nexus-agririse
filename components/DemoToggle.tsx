"use client";
import { useDemoMode } from '@/context/DemoModeContext';
import { FlaskConical } from 'lucide-react';

export const DemoToggle = () => {
  const { isDemoMode, toggleDemoMode } = useDemoMode();

  return (
    <button
      onClick={toggleDemoMode}
      title={isDemoMode ? 'Switch to Real Mode' : 'Switch to Demo Mode'}
      className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all border ${
        isDemoMode
          ? 'bg-violet-100 text-violet-700 border-violet-300 dark:bg-violet-900/30 dark:text-violet-300 dark:border-violet-700'
          : 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-zinc-800 dark:text-gray-400 dark:border-zinc-700 hover:bg-gray-200 dark:hover:bg-zinc-700'
      }`}
    >
      <FlaskConical size={13} />
      {isDemoMode ? 'Demo Mode ON' : 'Demo Mode'}
      <span className={`w-7 h-4 rounded-full relative transition-colors ml-1 ${isDemoMode ? 'bg-violet-500' : 'bg-gray-300 dark:bg-zinc-600'}`}>
        <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-all ${isDemoMode ? 'left-3.5' : 'left-0.5'}`} />
      </span>
    </button>
  );
};
