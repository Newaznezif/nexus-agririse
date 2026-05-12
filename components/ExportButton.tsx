"use client";

import React, { useState } from 'react';
import { FileDown, Loader2 } from 'lucide-react';
import { generatePDFReport } from '@/services/pdfExport';
import { Dataset, Insight } from '@/types';
import { useAuth } from '@/hooks/useAuth';

interface ExportButtonProps {
  dataset: Dataset | null;
  insight: Insight | null;
}

export const ExportButton = ({ dataset, insight }: ExportButtonProps) => {
  const { user } = useAuth();
  const [isGenerating, setIsGenerating] = useState(false);

  const handleExport = async () => {
    if (!dataset || !insight) return;

    setIsGenerating(true);
    try {
      // Small delay to show loading state
      await new Promise((resolve) => setTimeout(resolve, 800));
      const generatorName = user?.email || 'Authorized User';
      generatePDFReport(dataset, insight, generatorName);
    } catch (error) {
      console.error('Failed to generate PDF:', error);
      alert('Failed to generate PDF report.');
    } finally {
      setIsGenerating(false);
    }
  };

  if (!dataset || !insight) return null;

  return (
    <button
      onClick={handleExport}
      disabled={isGenerating}
      className={`flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-all shadow-sm focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:opacity-70 disabled:cursor-not-allowed`}
    >
      {isGenerating ? (
        <>
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Generating Report...</span>
        </>
      ) : (
        <>
          <FileDown className="w-4 h-4" />
          <span>Export Report</span>
        </>
      )}
    </button>
  );
};
