import { EthiopiaRegionMap } from '@/components/data/EthiopiaRegionMap';

export const metadata = {
  title: 'Geospatial · Nexus AgriRise',
  description: 'Ethiopian administrative boundaries over NASA GIBS satellite composites, with per-pixel NDVI and rainfall sampling.',
};

export default function MapPage() {
  return <EthiopiaRegionMap />;
}
