"use client";
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  LayoutDashboard, Upload, BrainCircuit, BarChart3,
  Settings, Globe2, LogOut, Leaf, CloudRain, 
  TrendingUp, Map, History, ShieldAlert
} from 'lucide-react';

export const Sidebar = () => {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  
  // RESIZABLE LOGIC
  const [width, setWidth] = useState(256); // 64 * 4 = 256px
  const isResizing = useRef(false);

  const startResizing = useCallback(() => {
    isResizing.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const stopResizing = useCallback(() => {
    isResizing.current = false;
    document.body.style.cursor = 'default';
    document.body.style.userSelect = 'auto';
  }, []);

  const resize = useCallback((e: MouseEvent) => {
    if (!isResizing.current) return;
    const newWidth = e.clientX;
    if (newWidth > 200 && newWidth < 450) {
      setWidth(newWidth);
    }
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', resize);
    window.addEventListener('mouseup', stopResizing);
    return () => {
      window.removeEventListener('mousemove', resize);
      window.removeEventListener('mouseup', stopResizing);
    };
  }, [resize, stopResizing]);

  const menuItems = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, category: 'Main' },
    { name: 'Upload Dataset', href: '/dashboard/upload', icon: Upload, category: 'Main' },
    { name: 'AI Insights', href: '/dashboard/insights', icon: BrainCircuit, category: 'Main' },
    { name: 'Cross-Border Intel', href: '/dashboard/comparison', icon: Globe2, category: 'Main' },
    { name: 'Analytics', href: '/dashboard/analytics', icon: BarChart3, category: 'Main' },
    
    { name: 'Climate Monitor', href: '/dashboard/climate', icon: CloudRain, category: 'Intelligence' },
    { name: 'Market Forecasts', href: '/dashboard/forecasts', icon: TrendingUp, category: 'Intelligence' },
    { name: 'Supply Chain Map', href: '/dashboard/map', icon: Map, category: 'Intelligence' },
    
    { name: 'Audit History', href: '/dashboard/audit', icon: History, category: 'System' },
    { name: 'Security Alerts', href: '/dashboard/security', icon: ShieldAlert, category: 'System' },
    { name: 'Settings', href: '/dashboard/settings', icon: Settings, category: 'System' },
  ];

  return (
    <aside 
      style={{ width: `${width}px` }}
      className="bg-white dark:bg-zinc-950 border-r border-gray-200 dark:border-zinc-800 hidden md:flex flex-col min-h-[calc(100vh-3.5rem)] shrink-0 relative transition-none group/sidebar"
    >
      {/* Brand */}
      <div className="p-6 border-b border-gray-100 dark:border-zinc-800 flex-shrink-0">
        <div className="flex items-center gap-2 mb-1 overflow-hidden">
          <div className="w-8 h-8 bg-emerald-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-lg shadow-emerald-600/20">
            <Leaf size={16} className="text-white" />
          </div>
          <h2 className="font-black text-lg text-gray-900 dark:text-white truncate tracking-tighter">Nexus AgriRise</h2>
        </div>
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-10 truncate">AI Intelligence Platform</p>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-4 space-y-8 overflow-y-auto custom-scrollbar">
        {['Main', 'Intelligence', 'System'].map(category => (
          <div key={category} className="space-y-1">
            <p className="text-[10px] font-black text-gray-400 dark:text-zinc-600 uppercase tracking-[0.2em] px-3 mb-4">
              {category}
            </p>
            {menuItems.filter(item => item.category === category).map((item) => {
              const isActive = pathname === item.href;
              const Icon = item.icon;
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-200 group/item ${
                    isActive
                      ? 'bg-emerald-600 text-white font-bold shadow-lg shadow-emerald-600/30 scale-[1.02]'
                      : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-zinc-900 hover:text-gray-900 dark:hover:text-white font-semibold'
                  }`}
                >
                  <Icon size={18} className={`${isActive ? 'text-white' : 'text-gray-400 dark:text-zinc-600 group-hover/item:text-emerald-500'} transition-colors flex-shrink-0`} />
                  <span className="truncate">{item.name}</span>
                  {isActive && (
                    <div className="ml-auto w-1 h-4 rounded-full bg-white/40" />
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* User Info & Footer */}
      <div className="p-4 bg-gray-50 dark:bg-zinc-900/50 border-t border-gray-100 dark:border-zinc-800 flex-shrink-0">
        {user && (
          <div className="mb-4 px-3 py-3 bg-white dark:bg-zinc-900 rounded-2xl border border-gray-200 dark:border-zinc-800 shadow-sm overflow-hidden">
            <div className="flex items-center gap-3 mb-1">
              <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center text-emerald-600 font-black text-xs">
                {user.email?.[0].toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-black text-gray-900 dark:text-white truncate">{user.email?.split('@')[0]}</p>
                <p className="text-[10px] text-emerald-600 dark:text-emerald-500 font-bold uppercase tracking-wider">Authorized</p>
              </div>
            </div>
          </div>
        )}
        <button
          onClick={logout}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-black uppercase tracking-widest text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/10 transition-all border border-transparent hover:border-red-200 dark:hover:border-red-900/30"
        >
          <LogOut size={16} />
          Sign Out
        </button>
      </div>

      {/* ── RESIZE HANDLE ── */}
      <div
        onMouseDown={startResizing}
        className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-emerald-500/50 active:bg-emerald-500 transition-colors z-50 group-hover/sidebar:opacity-100 opacity-0"
      />
    </aside>
  );
};
