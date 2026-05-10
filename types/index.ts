export type User = {
  id: string;
  email: string;
};

export type Dataset = {
  id: string;
  user_id: string;
  name: string;
  country: string;
  type: string;
  file_url: string;
  created_at?: string;
};

export type Insight = {
  id: string;
  user_id: string;
  dataset_id: string;
  summary: string;
  risk_level: 'Low' | 'Medium' | 'High';
  trend: string;
  created_at?: string;
};
