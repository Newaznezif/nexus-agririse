"use client";

import { useAuth } from '@/hooks/useAuth';
import { useDemoMode } from '@/context/DemoModeContext';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { BarChart3, TrendingUp, Users, Target, Loader2 } from 'lucide-react';
import { ComparisonChart } from '@/components/ComparisonChart';
import { demoDatasets } from '@/data/demoDatasets';
import { demoInsights } from '@/data/demoInsights';
import { compareCountries } from '@/services/comparison';
import { getUserDatasets, getUserInsights } from '@/services/database';
import { Dataset, Insight } from '@/types';
import toast from 'react-hot-toast';

export default function AnalyticsPage() {
  const { user, loading: authLoading } = useAuth();
  const { isDemoMode } = useDemoMode();
  const router = useRouter();

  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [isFetching, setIsFetching] = useState(true);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    const fetchData = async () => {
      if (!user) return;
      
      setIsFetching(true);
      if (isDemoMode) {
        setDatasets(demoDatasets);
        setInsights(demoInsights);
        setIsFetching(false);
        return;
      }

      try {
        const [datasetsRes, insightsRes] = await Promise.all([
          getUserDatasets(user.id),
          getUserInsights(user.id)
        ]);

        if (datasetsRes.success && datasetsRes.data) {
          setDatasets(datasetsRes.data);
        } else {
          toast.error("Failed to load datasets.");
        }

        if (insightsRes.success && insightsRes.data) {
          setInsights(insightsRes.data);
        } else {
          toast.error("Failed to load insights.");
        }
      } catch (error) {
        console.error("Error fetching analytics data:", error);
        toast.error("An error occurred while loading analytics.");
      } finally {
        setIsFetching(false);
      }
    };

    fetchData();
  }, [user, isDemoMode]);

  if (authLoading || (isFetching && !isDemoMode)) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4 bg-white dark:bg-zinc-900 rounded-xl border border-gray-100 dark:border-zinc-800 shadow-sm">
        <Loader2 className="w-8 h-8 text-emerald-600 animate-spin" />
        <p className="text-gray-500 font-medium">Gathering real-time analytics...</p>
      </div>
    );
  }
  
  if (!user) return null;

  const countryData = compareCountries(datasets, insights);

  // Calculate dynamic metrics
  const totalVolume = datasets.length;
  const insightsCount = insights.length;
  const lowRiskCount = insights.filter(i => i.risk_level.toLowerCase() === 'low').length;
  const successRate = insightsCount > 0 ? Math.round((lowRiskCount / insightsCount) * 100) : 0;

  return (
    <div className="space-y-8 pb-12">
      <header>
        <div className="flex items-center gap-2 mb-2">
          <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg text-emerald-600 dark:text-emerald-400">
            <BarChart3 size={24} />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">
            Performance Analytics
          </h1>
        </div>
        <p className="text-gray-500 dark:text-gray-400">
          In-depth analysis of your agribusiness metrics based on {isDemoMode ? 'curated demo' : 'real-time user'} data.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white dark:bg-zinc-900 p-6 rounded-2xl border border-gray-100 dark:border-zinc-800 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-xl text-blue-600 dark:text-blue-400">
              <TrendingUp size={24} />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Total Datasets</p>
              <p className="text-3xl font-black text-gray-900 dark:text-white">{isDemoMode ? '14.2K' : totalVolume}</p>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-zinc-900 p-6 rounded-2xl border border-gray-100 dark:border-zinc-800 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl text-emerald-600 dark:text-emerald-400">
              <Users size={24} />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Insights Generated</p>
              <p className="text-3xl font-black text-gray-900 dark:text-white">{isDemoMode ? '12,400' : insightsCount}</p>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-zinc-900 p-6 rounded-2xl border border-gray-100 dark:border-zinc-800 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-purple-50 dark:bg-purple-900/20 rounded-xl text-purple-600 dark:text-purple-400">
              <Target size={24} />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Low Risk Ratio</p>
              <p className="text-3xl font-black text-gray-900 dark:text-white">{isDemoMode ? '89%' : `${successRate}%`}</p>
            </div>
          </div>
        </div>
      </div>

      <section className="bg-white dark:bg-zinc-900 p-6 rounded-2xl border border-gray-100 dark:border-zinc-800 shadow-sm">
        {countryData.length > 0 ? (
          <ComparisonChart countryDataList={countryData} />
        ) : (
          <div className="h-64 flex items-center justify-center text-gray-500 dark:text-gray-400">
            No data available yet. Please upload datasets and generate insights.
          </div>
        )}
      </section>

      <div className="bg-emerald-50/50 dark:bg-emerald-900/10 p-6 rounded-2xl border border-dashed border-emerald-200 dark:border-emerald-800/50 text-center text-sm font-medium text-emerald-700 dark:text-emerald-400">
        Advanced predictive modeling and seasonal forecasting components are actively gathering historical data for future releases.
      </div>
    </div>
  );
}
