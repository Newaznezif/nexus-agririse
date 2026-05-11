"use client";

import { useAuth } from '@/hooks/useAuth';
import { useDemoMode } from '@/context/DemoModeContext';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useCallback, useRef } from 'react';
import { StatsCard } from '@/components/StatsCard';
import { UploadCard } from '@/components/UploadCard';
import { InsightTimeline, InsightTimelineHandle } from '@/components/InsightTimeline';
import { DatasetTable } from '@/components/DatasetTable';
import { DatasetPreview } from '@/components/DatasetPreview';
import { DemoToggle } from '@/components/DemoToggle';
import { DashboardAnalytics } from '@/components/DashboardAnalytics';
import { getUserDatasets } from '@/services/database';
import { demoDatasets } from '@/data/demoDatasets';
import { demoInsights } from '@/data/demoInsights';
import { Dataset } from '@/types';
import { Sparkles, Globe2, Database, BrainCircuit, Globe, CalendarDays } from 'lucide-react';
import Link from 'next/link';

export default function DashboardPage() {
  const { user, loading } = useAuth();
  const { isDemoMode } = useDemoMode();
  const router = useRouter();

  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [fetching, setFetching] = useState(true);

  const [previewData, setPreviewData] = useState<any[] | null>(null);
  const [previewColumns, setPreviewColumns] = useState<string[]>([]);
  const [previewFileName, setPreviewFileName] = useState<string>('');

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
      fetchDatasets();
    }
  }, [user, loading, router, fetchDatasets]);

  // In demo mode, always show fetched immediately
  useEffect(() => {
    if (isDemoMode) setFetching(false);
  }, [isDemoMode]);

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse p-8">
        <div className="h-10 bg-gray-200 dark:bg-zinc-800 rounded w-1/3"></div>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          {[0,1,2,3].map(i => <div key={i} className="h-28 bg-gray-200 dark:bg-zinc-800 rounded-xl" />)}
        </div>
        <div className="grid grid-cols-2 gap-6">
          <div className="h-72 bg-gray-200 dark:bg-zinc-800 rounded-xl" />
          <div className="h-72 bg-gray-200 dark:bg-zinc-800 rounded-xl" />
        </div>
      </div>
    );
  }

  if (!user) return null;

  const activeDatasets = isDemoMode ? demoDatasets : datasets;
  const insightCount = isDemoMode ? demoInsights.length : 0;
  const countries = [...new Set(activeDatasets.map(d => d.country).filter(Boolean))];

  const handlePreviewReady = (data: any[], columns: string[], fileName: string) => {
    setPreviewData(data);
    setPreviewColumns(columns);
    setPreviewFileName(fileName);
  };

  const handleUploadComplete = () => {
    fetchDatasets();
    insightTimelineRef.current?.refreshInsights();
  };

  return (
    <div className="space-y-8">
      {/* HERO WELCOME BANNER */}
      <div className="bg-gradient-to-r from-emerald-600 to-teal-700 dark:from-emerald-800 dark:to-teal-900 rounded-2xl p-8 text-white shadow-lg">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Sparkles size={20} className="text-emerald-200" />
              <span className="text-emerald-200 text-sm font-medium uppercase tracking-widest">Nexus AgriRise Africa</span>
            </div>
            <h1 className="text-3xl font-bold leading-tight">
              AI-powered Agribusiness Intelligence<br className="hidden md:block" /> for African Growth
            </h1>
            <p className="text-emerald-100 mt-2 text-sm max-w-xl">
              Upload agricultural datasets, generate AI-powered market insights, and discover cross-border trade opportunities across Africa.
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <DemoToggle />
            <Link href="/dashboard/comparison"
              className="flex items-center gap-2 px-4 py-2 bg-white/20 hover:bg-white/30 text-white rounded-lg text-sm font-medium transition-colors border border-white/20">
              <Globe2 size={15} /> Cross-Border Intel
            </Link>
          </div>
        </div>
        {isDemoMode && (
          <div className="mt-4 flex items-center gap-2 bg-violet-600/30 border border-violet-400/30 rounded-lg px-4 py-2 text-sm text-violet-100">
            <span className="w-2 h-2 rounded-full bg-violet-300 animate-pulse" />
            Demo Mode active — using pre-loaded African agribusiness intelligence data
          </div>
        )}
      </div>

      {/* STATS SECTION */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          title="Datasets Uploaded"
          value={activeDatasets.length}
          subtitle="Ready for analysis"
          icon={Database}
          iconColor="text-blue-600 dark:text-blue-400"
          iconBg="bg-blue-50 dark:bg-blue-900/20"
        />
        <StatsCard
          title="AI Insights Generated"
          value={isDemoMode ? insightCount : '—'}
          subtitle="Active intelligence"
          icon={BrainCircuit}
          iconColor="text-emerald-600 dark:text-emerald-400"
          iconBg="bg-emerald-50 dark:bg-emerald-900/20"
        />
        <StatsCard
          title="Countries Covered"
          value={countries.length}
          subtitle="Regional footprint"
          icon={Globe}
          iconColor="text-purple-600 dark:text-purple-400"
          iconBg="bg-purple-50 dark:bg-purple-900/20"
        />
        <StatsCard
          title="Last Upload"
          value={activeDatasets.length > 0 && activeDatasets[0].created_at
            ? new Date(activeDatasets[0].created_at).toLocaleDateString()
            : '—'}
          subtitle="Most recent activity"
          icon={CalendarDays}
          iconColor="text-amber-600 dark:text-amber-400"
          iconBg="bg-amber-50 dark:bg-amber-900/20"
        />
      </section>

      {/* UPLOAD + INSIGHTS SPLIT */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {!isDemoMode ? (
          <UploadCard onPreviewReady={handlePreviewReady} onUploadComplete={handleUploadComplete} />
        ) : (
          <div className="bg-white dark:bg-zinc-900 rounded-xl border border-violet-100 dark:border-violet-800 shadow-sm p-6 flex flex-col items-center justify-center text-center min-h-[260px] gap-3">
            <div className="bg-violet-50 dark:bg-violet-900/20 p-4 rounded-full">
              <Sparkles size={24} className="text-violet-500" />
            </div>
            <h3 className="font-semibold text-gray-800 dark:text-white">Demo Mode Active</h3>
            <p className="text-sm text-gray-500">File uploads are disabled in demo mode. Turn off Demo Mode to upload real datasets.</p>
          </div>
        )}
        <div>
          <h2 className="text-xl font-bold mb-4">Latest Intelligence</h2>
          {isDemoMode ? (
            <div className="space-y-4">
              {demoInsights.slice(0, 2).map(ins => (
                <div key={ins.id} className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-100 dark:border-zinc-800 shadow-sm p-5">
                  <div className="flex justify-between items-center mb-3">
                    <span className="text-xs font-semibold uppercase tracking-wider text-emerald-600">Market Intelligence</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      ins.risk_level === 'Low' ? 'bg-emerald-100 text-emerald-700' :
                      ins.risk_level === 'Medium' ? 'bg-yellow-100 text-yellow-700' :
                      'bg-red-100 text-red-700'
                    }`}>{ins.risk_level} Risk</span>
                  </div>
                  <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed line-clamp-4">{ins.summary}</p>
                  <p className="text-xs text-gray-500 mt-2 italic">{ins.trend.slice(0, 100)}...</p>
                </div>
              ))}
            </div>
          ) : (
            <InsightTimeline ref={insightTimelineRef} datasets={datasets} />
          )}
        </div>
      </section>

      {/* CSV PREVIEW */}
      {previewData && !isDemoMode && (
        <section>
          <DatasetPreview data={previewData} columns={previewColumns} fileName={previewFileName} />
        </section>
      )}

      {/* ANALYTICS SECTION */}
      <section>
        <h2 className="text-xl font-bold mb-4">Agribusiness Analytics Overview</h2>
        <DashboardAnalytics />
      </section>

      {/* DATASETS TABLE */}
      <section>
        <DatasetTable datasets={activeDatasets} />
      </section>
    </div>
  );
}
