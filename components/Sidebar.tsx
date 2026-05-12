"use client";
import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import {
  LayoutDashboard, Upload, BrainCircuit, BarChart3,
  Settings, Globe2, LogOut, Leaf, ChevronDown, ChevronRight,
  MapPin
} from 'lucide-react';

export const Sidebar = () => {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [insightsExpanded, setInsightsExpanded] = useState(true);

  const menuItems = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
    { name: 'Upload Dataset', href: '/dashboard/upload', icon: Upload },
    { 
      name: 'AI Insights', 
      href: '/dashboard/insights', 
      icon: BrainCircuit,
      subItems: [
        { name: 'Ethiopia', country: 'Ethiopia' },
        { name: 'Rwanda', country: 'Rwanda' },
        { name: 'CAR', country: 'Central African Republic' }
      ]
    },
    { name: 'Cross-Border Intel', href: '/dashboard/comparison', icon: Globe2 },
    { name: 'Analytics', href: '/dashboard/analytics', icon: BarChart3 },
    { name: 'Settings', href: '/dashboard/settings', icon: Settings },
  ];

  return (
    <aside className="w-64 bg-white dark:bg-zinc-950 border-r border-gray-200 dark:border-zinc-800 hidden md:flex flex-col min-h-[calc(100vh-3.5rem)] shrink-0 transition-all duration-300">
      {/* Brand */}
      <div className="p-6 border-b border-gray-100 dark:border-zinc-800">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-7 h-7 bg-emerald-600 rounded-lg flex items-center justify-center">
            <Leaf size={14} className="text-white" />
          </div>
          <h2 className="font-bold text-base text-gray-900 dark:text-white">Nexus AgriRise</h2>
        </div>
        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest ml-9 opacity-70">Intelligence Platform</p>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-4 space-y-1 overflow-y-auto custom-scrollbar">
        <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] px-3 mb-4">Navigation</p>
        
        {menuItems.map((item) => {
          const isActive = pathname === item.href || (item.subItems && pathname.startsWith(item.href));
          const Icon = item.icon;
          const hasSubItems = item.subItems && item.subItems.length > 0;

          return (
            <div key={item.name} className="space-y-1">
              {hasSubItems ? (
                <div>
                  <button
                    onClick={() => setInsightsExpanded(!insightsExpanded)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-200 group ${
                      isActive
                        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400 font-bold'
                        : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-zinc-900 hover:text-gray-800 dark:hover:text-gray-200 font-medium'
                    }`}
                  >
                    <Icon size={17} className={isActive ? 'text-emerald-600 dark:text-emerald-400' : ''} />
                    <span className="flex-1 text-left">{item.name}</span>
                    {insightsExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                  
                  {insightsExpanded && (
                    <div className="mt-1 ml-4 pl-4 border-l border-gray-100 dark:border-zinc-800 space-y-1 animate-in slide-in-from-top-1 duration-200">
                      {item.subItems?.map((sub) => (
                        <Link
                          key={sub.name}
                          href={`${item.href}?country=${encodeURIComponent(sub.country)}`}
                          className="flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] text-gray-500 dark:text-gray-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/10 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors font-medium group"
                        >
                          <MapPin size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                          {sub.name}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <Link
                  href={item.href}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-200 ${
                    isActive
                      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400 font-bold shadow-sm'
                      : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-zinc-900 hover:text-gray-800 dark:hover:text-gray-200 font-medium'
                  }`}
                >
                  <Icon size={17} className={isActive ? 'text-emerald-600 dark:text-emerald-400' : ''} />
                  {item.name}
                  {isActive && (
                    <span className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  )}
                </Link>
              )}
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-gray-100 dark:border-zinc-800">
        {user && (
          <div className="mb-3 px-3 py-2 bg-gray-50 dark:bg-zinc-900/50 rounded-xl border border-gray-100 dark:border-zinc-800">
            <p className="text-xs font-bold text-gray-900 dark:text-white truncate">{user.email}</p>
            <p className="text-[10px] text-gray-400 uppercase font-black tracking-widest mt-0.5">Admin Access</p>
          </div>
        )}
        <button
          onClick={logout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors"
        >
          <LogOut size={17} />
          Sign Out
        </button>
      </div>

      <style jsx>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #e2e8f0;
          border-radius: 10px;
        }
        .dark .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #1f2937;
        }
      `}</style>
    </aside>
  );
};
