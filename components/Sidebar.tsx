"use client";
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import {
  LayoutDashboard, Upload, BrainCircuit, BarChart3,
  Settings, Globe2, LogOut, Leaf
} from 'lucide-react';

export const Sidebar = () => {
  const pathname = usePathname();
  const { user, logout } = useAuth();

  const menuItems = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
    { name: 'Upload Dataset', href: '/dashboard/upload', icon: Upload },
    { name: 'AI Insights', href: '/dashboard/insights', icon: BrainCircuit },
    { name: 'Cross-Border Intel', href: '/dashboard/comparison', icon: Globe2 },
    { name: 'Analytics', href: '/dashboard/analytics', icon: BarChart3 },
    { name: 'Settings', href: '/dashboard/settings', icon: Settings },
  ];

  return (
    <aside className="w-64 bg-white dark:bg-zinc-950 border-r border-gray-200 dark:border-zinc-800 hidden md:flex flex-col min-h-[calc(100vh-3.5rem)] shrink-0">
      {/* Brand */}
      <div className="p-6 border-b border-gray-100 dark:border-zinc-800">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-7 h-7 bg-emerald-600 rounded-lg flex items-center justify-center">
            <Leaf size={14} className="text-white" />
          </div>
          <h2 className="font-bold text-base text-gray-900 dark:text-white">Nexus AgriRise</h2>
        </div>
        <p className="text-xs text-gray-400 ml-9">AI Intelligence Platform</p>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest px-3 mb-3">Navigation</p>
        {menuItems.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.name}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-150 ${
                isActive
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400 font-semibold shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-zinc-900 hover:text-gray-800 dark:hover:text-gray-200 font-medium'
              }`}
            >
              <Icon size={17} className={isActive ? 'text-emerald-600 dark:text-emerald-400' : ''} />
              {item.name}
              {isActive && (
                <span className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-500" />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-gray-100 dark:border-zinc-800">
        {user && (
          <div className="mb-3 px-3 py-2">
            <p className="text-xs font-medium text-gray-900 dark:text-white truncate">{user.email}</p>
            <p className="text-xs text-gray-400">Authenticated user</p>
          </div>
        )}
        <button
          onClick={logout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors"
        >
          <LogOut size={17} />
          Sign Out
        </button>
      </div>
    </aside>
  );
};
