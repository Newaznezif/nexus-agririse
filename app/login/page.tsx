"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/Button';
import { DemoToggle } from '@/components/DemoToggle';
import { useDemoMode } from '@/context/DemoModeContext';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Leaf, Eye, EyeOff, ArrowRight, CheckCircle2 } from 'lucide-react';

export default function LoginPage() {
  const { isDemoMode } = useDemoMode();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    if (isDemoMode) {
      router.push('/dashboard');
      return;
    }
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        router.replace('/dashboard');
      } else {
        setPageLoading(false);
      }
    };
    checkSession();
  }, [router, isDemoMode]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (!email || !password) {
      setError('Email and password are required');
      setLoading(false);
      return;
    }

    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });

    if (authError) {
      setError(authError.message);
      setLoading(false);
    } else {
      router.push('/dashboard');
    }
  };

  if (pageLoading) {
    return (
      <div className="flex justify-center items-center h-screen bg-zinc-50 dark:bg-black">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-3.5rem)] grid grid-cols-1 lg:grid-cols-2">

      {/* Left Panel — Branding */}
      <div className="hidden lg:flex flex-col bg-gradient-to-br from-emerald-600 via-teal-700 to-blue-800 text-white p-16 relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(255,255,255,0.08),transparent)] pointer-events-none" />
        <div className="absolute bottom-0 right-0 w-96 h-96 bg-white/5 rounded-full blur-[80px] pointer-events-none" />

        <div className="relative z-10 flex flex-col h-full">
          <div className="flex items-center gap-2 mb-auto">
            <Leaf size={24} className="text-emerald-200" />
            <span className="text-xl font-bold tracking-tight">Nexus AgriRise</span>
          </div>

          <div className="mb-auto">
            <h1 className="text-4xl font-black leading-tight mb-6">
              African agriculture<br />intelligence at your<br />fingertips.
            </h1>
            <p className="text-emerald-100 text-lg leading-relaxed mb-10">
              Sign in to access AI-powered market insights, cross-border trade analysis, and real-time agribusiness intelligence across Africa.
            </p>

            <div className="space-y-4">
              {[
                "Gemini AI market analysis in under 30 seconds",
                "Cross-border comparison across 14+ markets",
                "Investor-grade PDF report export",
                "Full demo mode — no data required",
              ].map((point) => (
                <div key={point} className="flex items-center gap-3">
                  <CheckCircle2 size={16} className="text-emerald-300 shrink-0" />
                  <p className="text-sm text-emerald-100">{point}</p>
                </div>
              ))}
            </div>
          </div>

          <p className="text-xs text-emerald-300/70 mt-8">
            &copy; 2026 Nexus AgriRise Africa · YALI-affiliated platform
          </p>
        </div>
      </div>

      {/* Right Panel — Form */}
      <div className="flex items-center justify-center bg-zinc-50 dark:bg-black px-6 py-12">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="w-full max-w-md"
        >
          {/* Mobile logo */}
          <div className="flex items-center gap-2 mb-10 lg:hidden">
            <Leaf size={20} className="text-emerald-600" />
            <span className="text-lg font-bold text-emerald-700 dark:text-emerald-500">Nexus AgriRise</span>
          </div>

          <div className="mb-8">
            <h2 className="text-3xl font-black text-gray-900 dark:text-white mb-2">Welcome back</h2>
            <p className="text-gray-500 dark:text-gray-400">Sign in to your account to continue.</p>
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-xl text-sm mb-6 border border-red-100 dark:border-red-800">
              {error}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                Email address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 border border-gray-200 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-900 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                placeholder="you@example.com"
                autoComplete="email"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 pr-12 border border-gray-200 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-900 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                  placeholder="••••••••"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-all shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2 mt-2"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Signing in...
                </>
              ) : (
                <>Sign In <ArrowRight size={16} /></>
              )}
            </button>
          </form>

          {/* Demo Mode */}
          <div className="mt-8 pt-6 border-t border-gray-100 dark:border-zinc-800">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3 text-center">No account? Try Demo Mode</p>
            <div className="flex flex-col items-center gap-2">
              <DemoToggle />
              <p className="text-xs text-gray-400 text-center max-w-xs">
                Enable Demo Mode to explore the full platform with pre-loaded African agribusiness data — no sign-in required.
              </p>
            </div>
          </div>

          <p className="mt-6 text-center text-sm text-gray-500">
            Don&apos;t have an account?{' '}
            <Link href="/signup" className="text-emerald-600 dark:text-emerald-400 font-semibold hover:underline">
              Create one free
            </Link>
          </p>
        </motion.div>
      </div>
    </div>
  );
}
