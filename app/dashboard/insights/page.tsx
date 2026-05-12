"use client";

import { useAuth } from '@/hooks/useAuth';
import { useDemoMode } from '@/context/DemoModeContext';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useCallback } from 'react';
import { getUserDatasets } from '@/services/database';
import { getUserInsights } from '@/services/insights';
import { demoDatasets } from '@/data/demoDatasets';
import { demoInsights } from '@/data/demoInsights';
import { Dataset, Insight } from '@/types';
import { 
  BrainCircuit, 
  Globe, 
  ChevronRight, 
  Activity,
  AlertCircle
} from 'lucide-react';
import { CountrySection } from '@/components/CountrySection';

export default function InsightsPage() {
  const { user, loading } = useAuth();
  const { isDemoMode } = useDemoMode();
  const router = useRouter();

  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [fetching, setFetching] = useState(true);
  const [selectedCountry, setSelectedCountry] = useState<string>('');

  const fetchData = useCallback(async () => {
    if (!user) return;
    setFetching(true);
    try {
      if (isDemoMode) {
        setDatasets(demoDatasets);
        setInsights(demoInsights);
        setSelectedCountry(demoDatasets[0].country);
      } else {
        const [dsRes, insRes] = await Promise.all([
          getUserDatasets(user.id),
          getUserInsights(user.id)
        ]);
        if (dsRes.success && dsRes.data) setDatasets(dsRes.data);
        if (insRes.data) setInsights(insRes.data);
        if (dsRes.data && dsRes.data.length > 0) {
          setSelectedCountry(dsRes.data[0].country);
        }
      }
    } finally {
      setFetching(false);
    }
  }, [user, isDemoMode]);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    } else if (user) {
      fetchData();
    }
  }, [user, loading, router, fetchData]);

  // Group countries
  const countries = Array.from(new Set(datasets.map(d => d.country)));
  
  // Find latest insight for selected country
  const filteredDatasets = datasets.filter(d => d.country === selectedCountry);
  const countryInsights = insights.filter(ins => 
    filteredDatasets.some(ds => ds.id === ins.dataset_id)
  ).sort((a, b) => new Date(b.created_at || '').getTime() - new Date(a.created_at || '').getTime());

  const currentInsight = countryInsights[0];
  const currentDataset = filteredDatasets.find(ds => ds.id === currentInsight?.dataset_id);

  if (loading || fetching) {
    return (
      <div className="flex h-[calc(100vh-12rem)] items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-500 font-medium animate-pulse">Syncing Intelligence Streams...</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="h-full flex flex-col gap-6">
      {/* ── HEADER ── */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <BrainCircuit size={28} className="text-emerald-600" />
            <h1 className="text-3xl font-black tracking-tight text-gray-900 dark:text-white uppercase italic">
              Market Intelligence
            </h1>
          </div>
          <p className="text-gray-500 dark:text-gray-400 text-sm font-medium">
            Strategic split-pane dashboard for pan-African agribusiness oversight
          </p>
        </div>
        
        <div className="flex items-center gap-3 bg-emerald-50 dark:bg-emerald-950/30 px-4 py-2 rounded-2xl border border-emerald-100 dark:border-emerald-900/50">
          <Activity size={18} className="text-emerald-600 animate-pulse" />
          <span className="text-xs font-black text-emerald-700 dark:text-emerald-400 uppercase tracking-widest">
            Live Stream Active
          </span>
        </div>
      </header>

      {/* ── MAIN CONTENT (SIDEBAR + DASHBOARD) ── */}
      <div className="flex flex-col xl:flex-row gap-8 flex-1 min-h-0">
        
        {/* SIDEBAR NAVIGATION */}
        <aside className="xl:w-72 flex-shrink-0">
          <div className="sticky top-6 space-y-4">
            <div className="flex items-center gap-2 px-2 mb-4">
              <Globe size={16} className="text-gray-400" />
              <h2 className="text-xs font-black text-gray-400 uppercase tracking-widest">Select Market Region</h2>
            </div>
            
            <nav className="flex flex-row xl:flex-col gap-2 overflow-x-auto pb-2 xl:pb-0 scrollbar-hide">
              {countries.map((country) => (
                <button
                  key={country}
                  onClick={() => setSelectedCountry(country)}
                  className={`flex items-center justify-between px-5 py-4 rounded-2xl transition-all duration-300 text-left min-w-[160px] xl:min-w-0 ${
                    selectedCountry === country
                      ? 'bg-emerald-600 text-white shadow-xl shadow-emerald-600/20 translate-x-1'
                      : 'bg-white dark:bg-zinc-900 text-gray-600 dark:text-gray-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 border border-gray-100 dark:border-zinc-800'
                  }`}
                >
                  <span className="font-bold tracking-tight">{country}</span>
                  <ChevronRight size={18} className={`${selectedCountry === country ? 'opacity-100' : 'opacity-0'} transition-opacity`} />
                </button>
              ))}
              
              {countries.length === 0 && (
                <div className="p-4 bg-gray-50 dark:bg-zinc-900/50 rounded-2xl border border-dashed border-gray-300 dark:border-zinc-800 text-center">
                  <p className="text-xs text-gray-500 italic">No market regions available</p>
                </div>
              )}
            </nav>

            <div className="hidden xl:block p-6 bg-gradient-to-br from-zinc-900 to-black rounded-3xl border border-zinc-800 shadow-2xl mt-8">
              <p className="text-[10px] font-black text-emerald-500 uppercase mb-2">System Status</p>
              <div className="space-y-3">
                <div className="flex justify-between text-[10px]">
                  <span className="text-gray-500">Connected Streams:</span>
                  <span className="text-white font-bold">{datasets.length}</span>
                </div>
                <div className="flex justify-between text-[10px]">
                  <span className="text-gray-500">Global Coverage:</span>
                  <span className="text-white font-bold">{countries.length} Regions</span>
                </div>
              </div>
            </div>
          </div>
        </aside>

        {/* MAIN DASHBOARD VIEW */}
        <main className="flex-1 min-w-0 pb-12">
          {currentInsight && currentDataset ? (
            <CountrySection 
              insight={currentInsight}
              dataset={currentDataset}
              generatorName={user?.email || 'Authorized User'}
            />
          ) : (
            <div className="h-full flex flex-col items-center justify-center bg-white dark:bg-zinc-900 rounded-3xl border-2 border-dashed border-gray-200 dark:border-zinc-800 p-12 text-center">
              <div className="w-20 h-20 bg-gray-50 dark:bg-zinc-800 rounded-full flex items-center justify-center mb-6">
                <AlertCircle size={40} className="text-gray-300" />
              </div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">No Insights Found</h2>
              <p className="text-gray-500 dark:text-gray-400 max-w-sm">
                There are no AI-generated insights for the {selectedCountry} region. Please upload a dataset or run a new analysis.
              </p>
              <button 
                onClick={() => router.push('/dashboard')}
                className="mt-8 px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold transition-colors"
              >
                Go to Dashboard
              </button>
            </div>
          )}
        </main>

      </div>
    </div>
  );
}
