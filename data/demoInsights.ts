import { Insight } from '@/types';

export const demoInsights: Insight[] = [
  {
    id: 'ins-demo-1',
    user_id: 'demo-user',
    dataset_id: 'demo-1',
    summary:
      'Ethiopian maize markets are experiencing moderate price inflation driven by seasonal rainfall deficits in the Oromia and SNNPR regions. Farmgate prices have risen 14% quarter-on-quarter. Demand from domestic processors remains strong, creating a short-term supply gap of approximately 180,000 metric tonnes. Export arbitrage to South Sudan and Djibouti presents high-value opportunities for licensed agro-traders.',
    risk_level: 'Medium',
    trend: 'Prices trending upward due to reduced harvest volumes and rising transport costs from production zones to Addis Ababa wholesale markets.',
    created_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'ins-demo-2',
    user_id: 'demo-user',
    dataset_id: 'demo-2',
    summary:
      'Rwanda\'s bean export sector is demonstrating strong fundamentals with consistent demand from East African Community partners. Average FOB prices at Kigali have stabilized at USD 920/MT, up 8% year-on-year. The Northern Province is emerging as a high-yield production cluster, with smallholder cooperatives achieving certification for EU organic standards — opening premium export lanes worth an estimated USD 4.2M annually.',
    risk_level: 'Low',
    trend: 'Stable with an upward bias. Export volumes to Kenya and Uganda have grown 22% since Q3 2023. Seasonal consistency expected to continue through mid-year.',
    created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'ins-demo-3',
    user_id: 'demo-user',
    dataset_id: 'demo-3',
    summary:
      'Central African Republic\'s cassava supply chain presents significant first-mover investment potential. Current processing capacity covers only 12% of harvestable volume, leaving 88% of production unprocessed and subject to post-harvest losses exceeding 35%. Minimal regional competition in cassava flour processing creates a structural market advantage for early entrants. Bangui urban demand for processed starch products is growing at 18% annually.',
    risk_level: 'High',
    trend: 'Unstable pricing with high post-harvest volatility. Infrastructure constraints limit reliable market access. Long-term upside contingent on road network improvements and processing facility investment.',
    created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'ins-demo-4',
    user_id: 'demo-user',
    dataset_id: 'demo-4',
    summary:
      'Ethiopian specialty coffee exports continue to outperform regional benchmarks. Yirgacheffe and Sidama Grade 1 coffees are commanding premiums of 40–65% over commodity futures on specialty auction platforms. The Ethiopian Commodity Exchange (ECX) recorded record volumes in Q1 2024. Growing direct-trade relationships with European and North American specialty roasters are bypassing traditional intermediary chains and improving farmer income retention to 38% of export value.',
    risk_level: 'Low',
    trend: 'Strongly upward. Specialty grade premiums expanding as global demand for traceable origin coffee accelerates. Ethiopia positioned as the continent\'s premier single-origin supplier.',
    created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
  },
];
