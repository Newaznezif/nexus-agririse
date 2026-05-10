"use client";

import React, { useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useRouter } from 'next/navigation';

export default function DashboardPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  if (loading) {
    return <div className="flex justify-center items-center h-screen">Loading dashboard...</div>;
  }

  if (!user) {
    return null; // Will redirect in useEffect
  }

  return (
    <div className="container mx-auto py-10 px-4">
      <div className="mb-8 flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-gray-500 dark:text-gray-400">Agribusiness Intelligence Overview</p>
        </div>
        <div className="text-sm bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-3 py-1 rounded-full">
          Logged in as: {user.email}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Section 1: Upload Dataset Area */}
        <div className="lg:col-span-1 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-lg p-6 shadow-sm flex flex-col items-center justify-center min-h-[300px]">
          <div className="text-center w-full">
            <h3 className="font-semibold mb-2">Upload Dataset</h3>
            <p className="text-sm text-gray-500 mb-4">CSV or Excel format</p>
            <div className="border-2 border-dashed border-gray-300 dark:border-zinc-700 rounded p-8 w-full flex flex-col items-center justify-center">
              <span className="text-gray-400 text-sm">Drag and drop files here</span>
            </div>
            <p className="text-xs text-blue-500 mt-4 cursor-pointer hover:underline">Coming soon</p>
          </div>
        </div>

        {/* Section 2: AI Insights Panel */}
        <div className="lg:col-span-2 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-lg p-6 shadow-sm flex flex-col min-h-[300px]">
          <h3 className="font-semibold mb-4 border-b border-gray-100 dark:border-zinc-800 pb-2">AI Insights Panel</h3>
          <div className="flex-1 flex items-center justify-center">
            <p className="text-gray-400 italic">No data available. Upload a dataset to generate insights.</p>
          </div>
        </div>
      </div>

      {/* Section 3: Market Summary Cards */}
      <h3 className="font-semibold text-lg mt-10 mb-4">Market Summary</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-lg p-6 shadow-sm">
          <h4 className="text-sm font-medium text-gray-500 mb-1">Maize Futures</h4>
          <p className="text-2xl font-bold">-</p>
          <p className="text-xs text-gray-400 mt-1">Awaiting data stream</p>
        </div>
        <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-lg p-6 shadow-sm">
          <h4 className="text-sm font-medium text-gray-500 mb-1">Risk Index</h4>
          <p className="text-2xl font-bold">N/A</p>
          <p className="text-xs text-gray-400 mt-1">Awaiting calculation</p>
        </div>
        <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-lg p-6 shadow-sm">
          <h4 className="text-sm font-medium text-gray-500 mb-1">Active Alerts</h4>
          <p className="text-2xl font-bold">0</p>
          <p className="text-xs text-gray-400 mt-1">System monitoring active</p>
        </div>
      </div>
    </div>
  );
}
