import { Dataset } from '@/types';

export const demoDatasets: Dataset[] = [
  {
    id: 'demo-1',
    user_id: 'demo-user',
    name: 'Ethiopia_Maize_Market_2024.csv',
    country: 'Ethiopia',
    type: 'csv',
    file_url: '#',
    created_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'demo-2',
    user_id: 'demo-user',
    name: 'Rwanda_Bean_Export_Q1_2024.csv',
    country: 'Rwanda',
    type: 'csv',
    file_url: '#',
    created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'demo-3',
    user_id: 'demo-user',
    name: 'CAR_Cassava_Supply_Chain.csv',
    country: 'Central African Republic',
    type: 'csv',
    file_url: '#',
    created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'demo-4',
    user_id: 'demo-user',
    name: 'Ethiopia_Coffee_Export_2024.csv',
    country: 'Ethiopia',
    type: 'csv',
    file_url: '#',
    created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
  },
];
