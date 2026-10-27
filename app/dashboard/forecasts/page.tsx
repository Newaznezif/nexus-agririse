import { MarketIntelligence } from '@/components/data/MarketIntelligence';

export const metadata = {
  title: 'Market Intelligence · Nexus AgriRise',
  description: 'WFP-surveyed Ethiopian market prices, NBE exchange rates and World Bank benchmarks, kept in separate labelled categories.',
};

export default function ForecastsPage() {
  return <MarketIntelligence />;
}
