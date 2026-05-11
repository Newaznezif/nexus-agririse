"use client";

import { useAuth } from '@/hooks/useAuth';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Settings, User, Bell, Shield, Database, Loader2 } from 'lucide-react';
import { toast } from 'react-hot-toast';

export default function SettingsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [notifications, setNotifications] = useState(true);
  const [isClearing, setIsClearing] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  const handleEditProfile = () => {
    toast.success('Profile editing enabled. Update your details below.');
    // In a real app, this would open a modal or navigate to an edit form
  };

  const handleToggleNotifications = () => {
    setNotifications(!notifications);
    toast.success(`Notifications ${!notifications ? 'enabled' : 'disabled'}`);
  };

  const handleManageSecurity = () => {
    toast.error('2FA Configuration is currently under maintenance. Please try again later.');
  };

  const handleClearCache = async () => {
    setIsClearing(true);
    // Simulate cache clearing
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Clear local data
    localStorage.removeItem('cached_insights');
    localStorage.removeItem('dashboard_state');
    
    setIsClearing(false);
    toast.success('System cache cleared successfully!');
  };

  if (loading) return <div className="p-8 animate-pulse bg-gray-100 dark:bg-zinc-800 rounded-xl h-64"></div>;
  if (!user) return null;

  return (
    <div className="space-y-8 max-w-4xl pb-20">
      <header>
        <div className="flex items-center gap-2 mb-2">
          <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg text-emerald-600 dark:text-emerald-400">
            <Settings size={24} />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">
            System Settings
          </h1>
        </div>
        <p className="text-gray-500 dark:text-gray-400">
          Manage your account preferences, notifications, and security protocols.
        </p>
      </header>

      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-100 dark:border-zinc-800 shadow-sm overflow-hidden divide-y divide-gray-100 dark:divide-zinc-800">
        {/* Profile Information */}
        <div className="p-8 flex items-center justify-between hover:bg-gray-50/50 dark:hover:bg-zinc-800/30 transition-colors">
          <div className="flex items-center gap-5">
            <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-xl text-blue-600 dark:text-blue-400">
              <User size={24} />
            </div>
            <div>
              <p className="font-bold text-lg">Profile Information</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">{user.email}</p>
            </div>
          </div>
          <button 
            onClick={handleEditProfile}
            className="px-4 py-2 text-sm text-emerald-600 dark:text-emerald-400 font-bold border border-emerald-100 dark:border-emerald-900/30 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-all"
          >
            Edit
          </button>
        </div>

        {/* Notifications */}
        <div className="p-8 flex items-center justify-between hover:bg-gray-50/50 dark:hover:bg-zinc-800/30 transition-colors">
          <div className="flex items-center gap-5">
            <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-xl text-amber-600 dark:text-amber-400">
              <Bell size={24} />
            </div>
            <div>
              <p className="font-bold text-lg">Notifications</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Email alerts for market changes</p>
            </div>
          </div>
          <button 
            onClick={handleToggleNotifications}
            className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus:outline-none ${notifications ? 'bg-emerald-600' : 'bg-gray-200 dark:bg-zinc-700'}`}
          >
            <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${notifications ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>

        {/* Privacy & Security */}
        <div className="p-8 flex items-center justify-between hover:bg-gray-50/50 dark:hover:bg-zinc-800/30 transition-colors">
          <div className="flex items-center gap-5">
            <div className="p-3 bg-purple-50 dark:bg-purple-900/20 rounded-xl text-purple-600 dark:text-purple-400">
              <Shield size={24} />
            </div>
            <div>
              <p className="font-bold text-lg">Privacy & Security</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Manage password and 2FA</p>
            </div>
          </div>
          <button 
            onClick={handleManageSecurity}
            className="px-4 py-2 text-sm text-emerald-600 dark:text-emerald-400 font-bold border border-emerald-100 dark:border-emerald-900/30 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-all"
          >
            Manage
          </button>
        </div>

        {/* Data Management */}
        <div className="p-8 flex items-center justify-between hover:bg-gray-50/50 dark:hover:bg-zinc-800/30 transition-colors">
          <div className="flex items-center gap-5">
            <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-xl text-red-600 dark:text-red-400">
              <Database size={24} />
            </div>
            <div>
              <p className="font-bold text-lg">Data Management</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Export or delete your datasets</p>
            </div>
          </div>
          <button 
            onClick={handleClearCache}
            disabled={isClearing}
            className="px-4 py-2 text-sm text-red-600 dark:text-red-400 font-bold border border-red-100 dark:border-red-900/30 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-all flex items-center gap-2"
          >
            {isClearing && <Loader2 size={16} className="animate-spin" />}
            Clear Cache
          </button>
        </div>
      </div>
    </div>
  );
}
