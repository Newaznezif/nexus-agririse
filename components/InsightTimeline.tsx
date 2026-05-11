"use client";
import React, { useEffect, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import { InsightCard } from './InsightCard';
import { InsightSkeleton } from './InsightSkeleton';
import { getUserInsights } from '@/services/insights';
import { useAuth } from '@/hooks/useAuth';
import { useDemoMode } from '@/context/DemoModeContext';
import { demoInsights } from '@/data/demoInsights';
import { Insight, Dataset } from '@/types';

export interface InsightTimelineHandle {
  refreshInsights: () => Promise<void>;
}

interface InsightTimelineProps {
  datasets: Dataset[];
}

export const InsightTimeline = forwardRef<InsightTimelineHandle, InsightTimelineProps>(({ datasets }, ref) => {
  const { user } = useAuth();
  const { isDemoMode } = useDemoMode();
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchInsights = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      if (isDemoMode) {
        setInsights(demoInsights);
        return;
      }
      const { data, error: fetchError } = await getUserInsights(user.id);
      if (fetchError) throw new Error(fetchError);
      
      const validInsights = (data || []).filter(i => i.summary && i.risk_level);
      setInsights(validInsights);
    } catch (err: any) {
      setError("Failed to load AI insights.");
    } finally {
      setLoading(false);
    }
  }, [user, isDemoMode]);

  useEffect(() => {
    fetchInsights();
  }, [fetchInsights]);

  useImperativeHandle(ref, () => ({
    refreshInsights: fetchInsights
  }));

  if (loading) {
    return (
      <div className="space-y-6">
        <InsightSkeleton />
        <InsightSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400 p-6 rounded-xl border border-red-100 dark:border-red-800 text-center text-sm">
        {error}
      </div>
    );
  }

  if (insights.length === 0) {
    return (
      <div className="bg-white dark:bg-zinc-900 p-10 rounded-xl border border-gray-100 dark:border-zinc-800 shadow-sm flex flex-col items-center justify-center text-center">
        <div className="bg-emerald-50 dark:bg-emerald-900/20 p-4 rounded-full mb-4">
          <svg className="w-8 h-8 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>
        <h3 className="font-semibold text-lg text-gray-900 dark:text-white mb-2">No AI insights generated yet.</h3>
        <p className="text-gray-500 dark:text-gray-400 text-sm max-w-sm">
          Upload and analyze an agricultural dataset to begin receiving actionable agribusiness intelligence.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {insights.map((insight) => {
        const dataset = datasets.find(d => d.id === insight.dataset_id);
        return <InsightCard key={insight.id} insight={insight} dataset={dataset} />;
      })}
    </div>
  );
});
InsightTimeline.displayName = 'InsightTimeline';
