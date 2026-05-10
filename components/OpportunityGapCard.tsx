"use client";
import { OpportunityGap } from '@/services/comparison';
import { ArrowRight, Zap } from 'lucide-react';

interface OpportunityGapCardProps {
  opportunity: OpportunityGap;
}

const POTENTIAL_COLORS: Record<string, string> = {
  'High': 'bg-emerald-50 border-emerald-200 dark:bg-emerald-900/10 dark:border-emerald-800',
  'Medium': 'bg-yellow-50 border-yellow-200 dark:bg-yellow-900/10 dark:border-yellow-800',
  'Low': 'bg-blue-50 border-blue-200 dark:bg-blue-900/10 dark:border-blue-800',
};

const POTENTIAL_BADGE: Record<string, string> = {
  'High': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  'Medium': 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  'Low': 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
};

export const OpportunityGapCard = ({ opportunity }: OpportunityGapCardProps) => {
  const cardColor = POTENTIAL_COLORS[opportunity.tradePotential] || POTENTIAL_COLORS['Medium'];
  const badgeColor = POTENTIAL_BADGE[opportunity.tradePotential] || POTENTIAL_BADGE['Medium'];

  return (
    <div className={`rounded-xl border p-5 flex flex-col gap-3 transition-all hover:shadow-sm ${cardColor}`}>
      <div className="flex justify-between items-start gap-2">
        <h4 className="font-semibold text-gray-900 dark:text-white text-sm flex items-center gap-2">
          <Zap size={15} className="text-emerald-600 shrink-0" />
          {opportunity.title}
        </h4>
        <span className={`text-xs font-medium px-2 py-1 rounded-full shrink-0 ${badgeColor}`}>
          {opportunity.tradePotential} Potential
        </span>
      </div>

      <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
        <span>Countries:</span>
        <span className="font-medium text-gray-700 dark:text-gray-300">{opportunity.countries}</span>
      </div>

      <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
        {opportunity.suggestedAction}
      </p>

      <div className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 font-medium mt-1 cursor-pointer hover:underline">
        View full analysis <ArrowRight size={12} />
      </div>
    </div>
  );
};
