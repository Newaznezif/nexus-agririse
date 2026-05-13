"use client";

import React, { useState } from 'react';
import { FileDown, Loader2, UserCheck, ChevronDown } from 'lucide-react';
import { generatePDFReport } from '@/services/pdfExport';
import { Dataset, Insight } from '@/types';

interface ExportButtonProps {
  dataset: Dataset | null;
  insight: Insight | null;
}

const AUTHORIZED_PROFILES = [
  { name: 'Newaz Nezif', role: 'Director General' },
  { name: 'Augustin Nkundimana', role: 'Executive' },
  { name: 'Adonis Wesley', role: 'Market Lead' },
];

export const ExportButton = ({ dataset, insight }: ExportButtonProps) => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState(AUTHORIZED_PROFILES[0]);
  const [showDropdown, setShowDropdown] = useState(false);

  const [exportData, setExportData] = useState<{ blob: Blob; filename: string } | null>(null);

  const handleExport = async () => {
    if (!dataset || !insight) return;

    // If we already have a generated PDF, trigger the download directly
    if (exportData) {
      const url = window.URL.createObjectURL(exportData.blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', exportData.filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setExportData(null); // Reset after download
      return;
    }

    setIsGenerating(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 800));
      const data = await generatePDFReport(dataset, insight, selectedProfile.name, selectedProfile.role);
      setExportData(data);
    } catch (error) {
      console.error('Failed to generate PDF:', error);
      alert('Failed to generate PDF report.');
    } finally {
      setIsGenerating(false);
    }
  };

  if (!dataset || !insight) return null;

  return (
    <div className="relative inline-flex items-center gap-1">
      {/* ── PROFILE SELECTOR ── */}
      <div className="relative">
        <button
          onClick={() => setShowDropdown(!showDropdown)}
          disabled={isGenerating || !!exportData}
          className="flex items-center gap-2 px-3 py-2 bg-gray-100 dark:bg-zinc-800 hover:bg-gray-200 dark:hover:bg-zinc-700 text-gray-700 dark:text-gray-200 rounded-l-xl border-r border-gray-300 dark:border-zinc-700 transition-all text-xs font-bold disabled:opacity-50"
        >
          <UserCheck size={14} className="text-emerald-600" />
          <div className="text-left hidden sm:block">
            <p className="leading-none">{selectedProfile.name}</p>
            <p className="text-[9px] text-gray-400 font-normal">{selectedProfile.role}</p>
          </div>
          <ChevronDown size={14} className={`transition-transform duration-200 ${showDropdown ? 'rotate-180' : ''}`} />
        </button>

        {showDropdown && (
          <>
            <div 
              className="fixed inset-0 z-40" 
              onClick={() => setShowDropdown(false)}
            />
            <div className="absolute left-0 bottom-full mb-2 w-56 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl shadow-2xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
              <div className="p-3 bg-gray-50 dark:bg-zinc-800/50 border-b border-gray-100 dark:border-zinc-800">
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Authorized Profile</p>
              </div>
              {AUTHORIZED_PROFILES.map((profile) => (
                <button
                  key={profile.name}
                  onClick={() => {
                    setSelectedProfile(profile);
                    setShowDropdown(false);
                  }}
                  className={`w-full flex flex-col items-start px-4 py-3 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors ${
                    selectedProfile.name === profile.name ? 'bg-emerald-50/50 dark:bg-emerald-900/10' : ''
                  }`}
                >
                  <span className={`text-sm font-bold ${selectedProfile.name === profile.name ? 'text-emerald-600' : 'text-gray-900 dark:text-white'}`}>
                    {profile.name}
                  </span>
                  <span className="text-[10px] text-gray-400">{profile.role}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── EXPORT BUTTON ── */}
      <button
        onClick={handleExport}
        disabled={isGenerating}
        className={`flex items-center gap-2 px-5 py-2 rounded-r-xl transition-all shadow-sm focus:ring-2 focus:ring-offset-2 disabled:opacity-70 disabled:cursor-not-allowed text-xs font-black uppercase tracking-wider ${
          exportData 
            ? 'bg-blue-600 hover:bg-blue-700 text-white animate-pulse ring-2 ring-blue-400' 
            : 'bg-emerald-600 hover:bg-emerald-700 text-white focus:ring-emerald-500'
        }`}
      >
        {isGenerating ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Encrypting...</span>
          </>
        ) : exportData ? (
          <>
            <FileDown className="w-4 h-4" />
            <span>Click to Save</span>
          </>
        ) : (
          <>
            <FileDown className="w-4 h-4" />
            <span>Export PDF</span>
          </>
        )}
      </button>
    </div>
  );
};
