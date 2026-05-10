export type User = {
  id: string;
  email: string;
};

export type Dataset = {
  id: string;
  name: string;
  country: string;
  data: any;
};

export type Insight = {
  summary: string;
  riskLevel: 'Low' | 'Medium' | 'High';
  trend: 'Up' | 'Down' | 'Stable';
};
