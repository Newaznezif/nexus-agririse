import { ClimateMonitor } from '@/components/data/ClimateMonitor';

export const metadata = {
  title: 'Climate Monitoring · Nexus AgriRise',
  description: 'Live Ethiopian weather, NASA POWER agroclimatology and satellite readings, with the source and date of every figure.',
};

export default function ClimatePage() {
  return <ClimateMonitor />;
}
