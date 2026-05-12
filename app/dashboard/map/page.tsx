"use client";
import { ComingSoonModule } from '@/components/ComingSoonModule';
import { Map } from 'lucide-react';

export default function MapPage() {
  return (
    <ComingSoonModule 
      title="Supply Chain Map" 
      icon={Map} 
      description="Visualizing the digital infrastructure of African agriculture with interactive logistics mapping and port-to-farm connectivity."
    />
  );
}
