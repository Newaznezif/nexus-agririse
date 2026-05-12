"use client";
import React from 'react';
import { LucideIcon, Timer, ShieldCheck, Database, Zap } from 'lucide-react';
import { motion } from 'framer-motion';

interface ComingSoonProps {
  title: string;
  icon: LucideIcon;
  description: string;
}

export const ComingSoonModule = ({ title, icon: Icon, description }: ComingSoonProps) => {
  return (
    <div className="h-[calc(100vh-12rem)] flex items-center justify-center">
      <div className="max-w-2xl w-full p-12 bg-white dark:bg-zinc-950 rounded-[2.5rem] border border-gray-100 dark:border-zinc-800 shadow-2xl text-center relative overflow-hidden">
        {/* Background Decor */}
        <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 blur-3xl rounded-full -mr-16 -mt-16" />
        <div className="absolute bottom-0 left-0 w-32 h-32 bg-blue-500/5 blur-3xl rounded-full -ml-16 -mb-16" />

        <motion.div 
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="w-24 h-24 bg-emerald-50 dark:bg-emerald-950/30 rounded-3xl flex items-center justify-center mx-auto mb-8 text-emerald-600 shadow-inner"
        >
          <Icon size={48} />
        </motion.div>

        <h1 className="text-4xl font-black tracking-tight text-gray-900 dark:text-white uppercase mb-4">
          {title}
        </h1>
        <p className="text-gray-500 dark:text-gray-400 font-medium mb-10 leading-relaxed">
          {description}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-10">
          {[
            { label: 'Data Sync', val: 'Initializing', icon: Database, color: 'text-blue-500' },
            { label: 'AI Core', val: 'Ready', icon: Zap, color: 'text-amber-500' },
            { label: 'Security', val: 'Encrypted', icon: ShieldCheck, color: 'text-emerald-500' }
          ].map((stat, i) => (
            <div key={i} className="p-4 bg-gray-50 dark:bg-zinc-900 rounded-2xl border border-gray-100 dark:border-zinc-800">
              <stat.icon size={18} className={`${stat.color} mx-auto mb-2`} />
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{stat.label}</p>
              <p className="text-sm font-bold text-gray-900 dark:text-white">{stat.val}</p>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-center gap-3 px-6 py-3 bg-zinc-900 text-white rounded-2xl font-black uppercase text-xs tracking-widest shadow-xl">
          <Timer size={16} className="animate-pulse" />
          Module Deployment in Progress
        </div>
      </div>
    </div>
  );
};
