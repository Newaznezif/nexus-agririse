"use client";

import { useAuth } from '@/hooks/useAuth';
import { useDemoMode } from '@/context/DemoModeContext';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useCallback, useRef } from 'react';
import { InsightTimeline, InsightTimelineHandle } from '@/components/InsightTimeline';
import { getUserDatasets } from '@/services/database';
import { demoDatasets } from '@/data/demoDatasets';
import { Dataset } from '@/types';
import { BrainCircuit } from 'lucide-react';

export default function InsightsPage() {
  const { user, loading } = useAuth();
  const { isDemoMode } = useDemoMode();
  const router = useRouter();

  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [fetching, setFetching] = useState(true);
  const insightTimelineRef = useRef<InsightTimelineHandle>(null);

  const fetchDatasets = useCallback(async () => {
    if (!user) return;
    setFetching(true);
    try {
      const { data, success } = await getUserDatasets(user.id);
      if (success && data) setDatasets(data);
    } finally {
      setFetching(false);
    }
  }, [user]);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    } else if (user) {
      if (!isDemoMode) {
        fetchDatasets();
      } else {
        setDatasets(demoDatasets);
        setFetching(false);
      }
    }
  }, [user, loading, router, fetchDatasets, isDemoMode]);

  if (loading || fetching) {
    return (
      <div className="space-y-6 animate-pulse p-8">
        <div className="h-10 bg-gray-200 dark:bg-zinc-800 rounded w-1/4"></div>
        <div className="space-y-4">
          {[0,1,2].map(i => <div key={i} className="h-40 bg-gray-200 dark:bg-zinc-800 rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="space-y-8">
      <header>
        <div className="flex items-center gap-2 mb-2">
          <BrainCircuit size={24} className="text-emerald-600" />
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">
            AI Market Intelligence
          </h1>
        </div>
        <p className="text-gray-500 dark:text-gray-400">
          Complete archive of AI-generated insights and market trends
        </p>
      </header>

      <section className="max-w-4xl">
        <InsightTimeline 
          ref={insightTimelineRef} 
          datasets={isDemoMode ? demoDatasets : datasets} 
        />
      </section>
    </div>
  );
}
