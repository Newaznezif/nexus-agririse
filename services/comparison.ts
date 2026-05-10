import { Dataset, Insight } from '@/types';

export interface CountryData {
  country: string;
  datasets: Dataset[];
  insights: Insight[];
  riskLevel: string;
  latestTrend: string;
  datasetCount: number;
}

export interface ComparisonRow {
  country: string;
  product: string;
  avgPrice: string;
  marketTrend: string;
  riskLevel: string;
  opportunity: string;
}

export interface OpportunityGap {
  title: string;
  countries: string;
  tradePotential: string;
  suggestedAction: string;
}

const SUPPORTED_COUNTRIES = ['Ethiopia', 'Rwanda', 'Central African Republic'];

export function compareCountries(datasets: Dataset[], insights: Insight[]): CountryData[] {
  return SUPPORTED_COUNTRIES.map((country) => {
    const countryDatasets = datasets.filter(
      (d) => d.country?.toLowerCase() === country.toLowerCase()
    );
    const countryInsights = insights.filter((ins) =>
      countryDatasets.some((d) => d.id === ins.dataset_id)
    );

    const latestInsight = countryInsights[0];

    return {
      country,
      datasets: countryDatasets,
      insights: countryInsights,
      riskLevel: latestInsight?.risk_level || 'N/A',
      latestTrend: latestInsight?.trend || 'No trend data',
      datasetCount: countryDatasets.length,
    };
  });
}

export function buildComparisonRows(countryDataList: CountryData[]): ComparisonRow[] {
  const rows: ComparisonRow[] = [];

  for (const countryData of countryDataList) {
    for (const dataset of countryData.datasets) {
      const insight = countryData.insights.find((i) => i.dataset_id === dataset.id);
      rows.push({
        country: countryData.country,
        product: dataset.type || 'Agricultural CSV',
        avgPrice: 'See insight',
        marketTrend: insight?.trend || 'Pending',
        riskLevel: insight?.risk_level || 'N/A',
        opportunity: insight
          ? insight.summary.slice(0, 80) + '...'
          : 'Analyze dataset to generate insight',
      });
    }

    if (countryData.datasets.length === 0) {
      rows.push({
        country: countryData.country,
        product: '—',
        avgPrice: '—',
        marketTrend: '—',
        riskLevel: '—',
        opportunity: 'No datasets uploaded for this country',
      });
    }
  }

  return rows;
}

export function identifyOpportunities(countryDataList: CountryData[]): OpportunityGap[] {
  const opportunities: OpportunityGap[] = [];

  const withData = countryDataList.filter((c) => c.insights.length > 0);
  const lowRisk = withData.filter((c) => c.riskLevel === 'Low');
  const highRisk = withData.filter((c) => c.riskLevel === 'High' || c.riskLevel === 'Medium');

  // Generate cross-country opportunities
  for (const low of lowRisk) {
    for (const high of highRisk) {
      opportunities.push({
        title: `Export Opportunity: ${low.country} → ${high.country}`,
        countries: `${low.country} & ${high.country}`,
        tradePotential: 'High',
        suggestedAction: `${low.country} (low risk) can supply to ${high.country} (${high.riskLevel} risk market). Consider bilateral trade agreements to capitalize on market asymmetry.`,
      });
    }
  }

  // Add static seed insights for demo if no real data yet
  if (opportunities.length === 0) {
    opportunities.push(
      {
        title: 'Rwanda Maize Supply Gap',
        countries: 'Rwanda & Ethiopia',
        tradePotential: 'High',
        suggestedAction: 'Rwanda shows rising bean demand while Ethiopia has supply surplus. Facilitate cross-border grain trade corridors.',
      },
      {
        title: 'CAR Processing Opportunity',
        countries: 'Central African Republic',
        tradePotential: 'Medium',
        suggestedAction: 'CAR presents low competition in maize processing. First-mover advantage available for agro-processing investors.',
      },
      {
        title: 'East Africa Price Arbitrage',
        countries: 'Ethiopia & Rwanda',
        tradePotential: 'High',
        suggestedAction: 'Significant price differences detected between Ethiopian and Rwandan markets. Arbitrage opportunities exist for commodity traders.',
      }
    );
  }

  return opportunities;
}
