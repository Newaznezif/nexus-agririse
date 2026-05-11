"use client";

import { useAuth } from "@/hooks/useAuth";
import { useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import { getUserDatasets } from "@/services/database";
import { getUserInsights } from "@/services/insights";
import {
  compareCountries,
  buildComparisonRows,
  identifyOpportunities,
  CountryData,
  ComparisonRow,
  OpportunityGap,
} from "@/services/comparison";
import { MarketTrendCard } from "@/components/MarketTrendCard";
import { CountryComparisonTable } from "@/components/CountryComparisonTable";
import { ComparisonChart } from "@/components/ComparisonChart";
import { OpportunityGapCard } from "@/components/OpportunityGapCard";
import { useDemoMode } from "@/context/DemoModeContext";
import { demoDatasets } from "@/data/demoDatasets";
import { demoInsights } from "@/data/demoInsights";
import { Dataset, Insight } from "@/types";

export default function ComparisonPage() {
  const { user, loading } = useAuth();
  const { isDemoMode } = useDemoMode();
  const router = useRouter();

  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [countryDataList, setCountryDataList] = useState<CountryData[]>([]);
  const [comparisonRows, setComparisonRows] = useState<ComparisonRow[]>([]);
  const [opportunities, setOpportunities] = useState<OpportunityGap[]>([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!user) return;
    setFetching(true);
    setError(null);
    try {
      let ds: Dataset[] = [];
      let ins: Insight[] = [];

      if (isDemoMode) {
        ds = demoDatasets;
        ins = demoInsights;
      } else {
        const [dsResult, insResult] = await Promise.all([
          getUserDatasets(user.id),
          getUserInsights(user.id),
        ]);
        ds = dsResult.data || [];
        ins = insResult.data || [];
      }

      setDatasets(ds);
      setInsights(ins);

      const countryData = compareCountries(ds, ins);
      const rows = buildComparisonRows(countryData);
      const opps = identifyOpportunities(countryData);

      setCountryDataList(countryData);
      setComparisonRows(rows);
      setOpportunities(opps);
    } catch (err: any) {
      setError("Failed to load regional intelligence data.");
    } finally {
      setFetching(false);
    }
  }, [user, isDemoMode]);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    } else if (user) {
      fetchData();
    }
  }, [user, loading, router, fetchData]);

  if (loading || fetching) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-10 bg-gray-200 dark:bg-zinc-800 rounded w-1/3"></div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-48 bg-gray-200 dark:bg-zinc-800 rounded-xl"></div>
          ))}
        </div>
        <div className="h-64 bg-gray-200 dark:bg-zinc-800 rounded-xl"></div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="space-y-10">
      {/* SECTION 1: HEADER */}
      <header>
        <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">
          Cross-Border Intelligence Dashboard
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Regional agribusiness market comparison across African economies
        </p>
      </header>

      {error && (
        <div className="p-4 bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400 rounded-xl border border-red-100 dark:border-red-800 text-sm">
          {error}
        </div>
      )}

      {/* SECTION 2: COUNTRY OVERVIEW CARDS */}
      <section>
        <h2 className="text-xl font-semibold mb-4">Country Market Overview</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {countryDataList.map((c) => (
            <MarketTrendCard key={c.country} countryData={c} />
          ))}
        </div>
      </section>

      {/* SECTION 3 & 4: CHART + TABLE SIDE BY SIDE ON LARGE SCREENS */}
      <section>
        <h2 className="text-xl font-semibold mb-4">Data Coverage & Trend Visualization</h2>
        <ComparisonChart countryDataList={countryDataList} />
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-4">Side-by-Side Country Comparison</h2>
        <CountryComparisonTable rows={comparisonRows} />
      </section>

      {/* SECTION 5: OPPORTUNITY GAP ANALYSIS */}
      <section>
        <h2 className="text-xl font-semibold mb-4">Opportunity Gap Analysis</h2>
        {opportunities.length === 0 ? (
          <div className="bg-white dark:bg-zinc-900 p-8 rounded-xl border border-dashed border-gray-200 dark:border-zinc-700 text-center text-sm text-gray-500">
            Not enough regional datasets available for comparison.
            <br />
            Upload datasets from multiple countries to begin analysis.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {opportunities.map((opp, i) => (
              <OpportunityGapCard key={i} opportunity={opp} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
