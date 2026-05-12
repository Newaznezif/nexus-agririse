"use client";
import { ComingSoonModule } from '@/components/ComingSoonModule';
import { CloudRain } from 'lucide-react';

export default function ClimatePage() {
  return (
    <ComingSoonModule 
      title="Climate Monitoring" 
      icon={CloudRain} 
      description="Integrating real-time satellite meteorology and soil moisture telemetry for pan-African crop yield prediction."
    />
  );
}
