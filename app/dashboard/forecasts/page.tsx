"use client";
import { ComingSoonModule } from '@/components/ComingSoonModule';
import { TrendingUp } from 'lucide-react';

export default function ForecastsPage() {
  return (
    <ComingSoonModule 
      title="Market Forecasts" 
      icon={TrendingUp} 
      description="Deploying predictive AI models to project commodity price fluctuations and arbitrage opportunities across the next 180 days."
    />
  );
}
