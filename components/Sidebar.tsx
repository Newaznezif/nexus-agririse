"use client";
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Upload, BrainCircuit, BarChart3, Settings, Globe2 } from 'lucide-react';

export const Sidebar = () => {
  const pathname = usePathname();

  const menuItems = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
    { name: 'Upload Dataset', href: '/dashboard/upload', icon: Upload },
    { name: 'AI Insights', href: '/dashboard/insights', icon: BrainCircuit },
    { name: 'Cross-Border Intel', href: '/dashboard/comparison', icon: Globe2 },
    { name: 'Analytics', href: '/dashboard/analytics', icon: BarChart3 },
    { name: 'Settings', href: '/dashboard/settings', icon: Settings },
  ];

  return (
    <aside className="w-64 bg-white dark:bg-zinc-950 border-r border-gray-200 dark:border-zinc-800 hidden md:flex flex-col min-h-[calc(100vh-3.5rem)]">
      <div className="p-6 border-b border-gray-200 dark:border-zinc-800">
        <h2 className="font-bold text-lg text-emerald-700 dark:text-emerald-500">Nexus AgriRise</h2>
        <p className="text-xs text-gray-500 mt-1">Agribusiness Intelligence</p>
      </div>
      <nav className="flex-1 p-4 space-y-2">
        {menuItems.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.name}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${
                isActive 
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400 font-medium' 
                  : 'text-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-zinc-900'
              }`}
            >
              <Icon size={18} />
              {item.name}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
};
