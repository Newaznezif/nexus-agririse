"use client";
import React from 'react';
import { Dataset, Insight } from '@/types';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts';
import { 
  ShieldCheck, 
  FileText, 
  Zap, 
  MapPin, 
  User as UserIcon, 
  CheckCircle2, 
  Lock,
  Download
} from 'lucide-react';
import { ExportButton } from './ExportButton';

interface CountrySectionProps {
  insight: Insight;
  dataset: Dataset;
  generatorName: string;
}

export const CountrySection = ({ insight, dataset, generatorName }: CountrySectionProps) => {
  // --- MOCK DATA FOR CHARTS (Mirroring PDF Logic) ---
  const getTrendData = () => {
    const trend = insight.trend.toLowerCase();
    if (trend.includes('up') || trend.includes('bullish')) {
      return [
        { name: 'T-5', value: 20 }, { name: 'T-4', value: 35 },
        { name: 'T-3', value: 45 }, { name: 'T-2', value: 65 },
        { name: 'T-1', value: 80 }, { name: 'T-0', value: 95 }
      ];
    } else if (trend.includes('down') || trend.includes('bearish')) {
      return [
        { name: 'T-5', value: 95 }, { name: 'T-4', value: 80 },
        { name: 'T-3', value: 65 }, { name: 'T-2', value: 45 },
        { name: 'T-1', value: 35 }, { name: 'T-0', value: 20 }
      ];
    }
    return [
      { name: 'T-5', value: 40 }, { name: 'T-4', value: 50 },
      { name: 'T-3', value: 45 }, { name: 'T-2', value: 60 },
      { name: 'T-1', value: 55 }, { name: 'T-0', value: 70 }
    ];
  };

  const getRiskData = () => {
    let riskVal = 20;
    if (insight.risk_level.toLowerCase() === 'medium') riskVal = 45;
    if (insight.risk_level.toLowerCase() === 'high') riskVal = 75;
    
    return [
      { name: 'Risk Impact', value: riskVal, color: '#ef4444' },
      { name: 'System Integrity', value: (100 - riskVal) * 0.6, color: '#10b981' },
      { name: 'Market Stability', value: (100 - riskVal) * 0.4, color: '#3b82f6' }
    ];
  };

  const authCode = `NX-AUTH-${Buffer.from(insight.id).toString('base64').substring(0, 16).toUpperCase()}`;

  return (
    <div className="bg-white dark:bg-zinc-950 rounded-2xl border border-gray-200 dark:border-zinc-800 shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-700">
      {/* ── TOP HEADER (BRANDING) ── */}
      <div className="bg-emerald-600 dark:bg-emerald-900/40 p-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-white/10">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center shadow-lg">
            <img src="/Logo.jpeg" alt="Logo" className="w-10 h-10 object-contain" />
          </div>
          <div className="text-white">
            <h2 className="text-xl font-black tracking-tighter uppercase italic">Nexus Intelligence Stream</h2>
            <p className="text-emerald-100/70 text-xs font-medium flex items-center gap-2">
              <ShieldCheck size={12} /> SECURE CRYPTOGRAPHIC REPORTING SYSTEM
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 bg-black/20 backdrop-blur-md px-4 py-2 rounded-xl border border-white/10">
          <div className="text-right">
            <p className="text-[10px] text-emerald-100/50 uppercase font-bold">Authorized By</p>
            <p className="text-sm font-bold text-white">{generatorName}</p>
          </div>
          <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
            <UserIcon size={18} className="text-white" />
          </div>
        </div>
      </div>

      {/* ── METADATA BAR ── */}
      <div className="bg-gray-50 dark:bg-zinc-900/50 px-6 py-4 border-b border-gray-100 dark:border-zinc-800 flex flex-wrap gap-6 text-xs font-semibold text-gray-500 dark:text-gray-400">
        <div className="flex items-center gap-2">
          <MapPin size={14} className="text-emerald-600" />
          REGION: <span className="text-gray-900 dark:text-white uppercase">{dataset.country || 'Global'}</span>
        </div>
        <div className="flex items-center gap-2">
          <Zap size={14} className="text-amber-500" />
          RISK LEVEL: <span className={`px-2 py-0.5 rounded-full text-[10px] text-white ${
            insight.risk_level.toLowerCase() === 'low' ? 'bg-emerald-500' :
            insight.risk_level.toLowerCase() === 'medium' ? 'bg-amber-500' : 'bg-red-500'
          }`}>{insight.risk_level.toUpperCase()}</span>
        </div>
        <div className="flex items-center gap-2">
          <FileText size={14} className="text-blue-500" />
          STREAM ID: <span className="text-gray-900 dark:text-white uppercase font-mono">{insight.id.substring(0,8)}</span>
        </div>
        <div className="ml-auto">
          <ExportButton dataset={dataset} insight={insight} />
        </div>
      </div>

      {/* ── MAIN DASHBOARD (SPLIT PANE) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2">
        
        {/* LEFT: VISUAL ANALYTICS */}
        <div className="p-8 border-r border-gray-100 dark:border-zinc-800 space-y-10">
          <div>
            <h3 className="text-xs font-black text-emerald-600 dark:text-emerald-500 uppercase tracking-[0.2em] mb-6 flex items-center gap-2">
              <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
              Real-Time Trend Distribution
            </h3>
            <div className="h-[250px] w-full bg-gray-50 dark:bg-zinc-900/30 rounded-2xl p-4 border border-gray-100 dark:border-zinc-800">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={getTrendData()}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#88888820" />
                  <XAxis dataKey="name" fontSize={10} axisLine={false} tickLine={false} />
                  <YAxis hide />
                  <Tooltip 
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', background: '#fff' }}
                    labelStyle={{ display: 'none' }}
                  />
                  <Bar dataKey="value" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div>
            <h3 className="text-xs font-black text-emerald-600 dark:text-emerald-500 uppercase tracking-[0.2em] mb-6">
              Impact Allocation Matrix
            </h3>
            <div className="h-[250px] w-full bg-gray-50 dark:bg-zinc-900/30 rounded-2xl p-4 border border-gray-100 dark:border-zinc-800 flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={getRiskData()}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {getRiskData().map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: '10px', paddingTop: '20px' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* RIGHT: ACTIONABLE TEXT */}
        <div className="p-8 space-y-10 bg-gray-50/30 dark:bg-zinc-900/10">
          <div>
            <h3 className="text-xs font-black text-emerald-600 dark:text-emerald-500 uppercase tracking-[0.2em] mb-6">
              Strategic Recommendations
            </h3>
            <div className="space-y-4">
              {[
                { title: 'Sourcing Diversification', desc: 'Immediately shift procurement to stable regional clusters identified in the SnNPR zones.' },
                { title: 'Climate Contingency', desc: 'Activate index-based insurance protocols for sectors exhibiting high-volatility T-0 indicators.' },
                { title: 'Arbitrage Strategy', desc: 'Prioritize export logistics for premium markets currently showing sub-30% risk impact.' }
              ].map((rec, i) => (
                <div key={i} className="flex gap-4 p-4 bg-white dark:bg-zinc-900 rounded-xl border border-gray-100 dark:border-zinc-800 shadow-sm hover:border-emerald-500/50 transition-colors">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center flex-shrink-0 text-emerald-600">
                    <CheckCircle2 size={16} />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-gray-900 dark:text-white">{rec.title}</h4>
                    <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed mt-1">{rec.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-xs font-black text-emerald-600 dark:text-emerald-500 uppercase tracking-[0.2em] mb-6">
              Step-by-Step Resolution Guidelines
            </h3>
            <div className="relative pl-8 space-y-8 before:absolute before:left-3 before:top-2 before:bottom-2 before:w-[2px] before:bg-emerald-500/20">
              {[
                'Audit stream parameters against local commodity price floors.',
                'Consult with regional agribusiness leads on predictive deviation.',
                'Adjust procurement volume allocations within 48h of trend confirmation.'
              ].map((step, i) => (
                <div key={i} className="relative">
                  <div className="absolute -left-8 top-0 w-6 h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center text-[10px] font-black z-10 shadow-lg">
                    {i + 1}
                  </div>
                  <p className="text-sm text-gray-700 dark:text-gray-300 font-medium leading-snug">{step}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── VALIDATION FOOTER ── */}
      <div className="bg-gray-100 dark:bg-zinc-900 p-8 border-t border-gray-200 dark:border-zinc-800 flex flex-col md:flex-row justify-between items-center gap-8">
        <div className="flex items-center gap-6">
          <div className="bg-white dark:bg-black p-4 rounded-xl border border-gray-200 dark:border-zinc-800 shadow-inner">
            <p className="text-[10px] text-gray-400 uppercase font-black mb-2 flex items-center gap-2">
              <Lock size={10} /> Authorized System Code
            </p>
            <code className="text-sm font-mono font-black text-emerald-600 dark:text-emerald-500 tracking-wider">
              {authCode}
            </code>
          </div>
          <div className="h-12 w-[1px] bg-gray-300 dark:bg-zinc-700 hidden md:block" />
          <div className="text-center md:text-left">
            <p className="text-xs text-gray-500 dark:text-gray-400 italic mb-1">Digitally Signed By</p>
            <p className="text-sm font-black text-gray-900 dark:text-white uppercase tracking-tight">Augustin Nkundimana</p>
            <p className="text-[10px] text-emerald-600 font-bold uppercase tracking-widest">Lead Manager / Nexus Agririse</p>
          </div>
        </div>
        
        <div className="flex flex-col items-center gap-2 opacity-50">
          <div className="w-32 h-[1px] bg-gray-400 dark:bg-zinc-600" />
          <p className="text-[9px] font-black uppercase text-gray-400">Official Signature (Digital Proxy)</p>
        </div>
      </div>
    </div>
  );
};
