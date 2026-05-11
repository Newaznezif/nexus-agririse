"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  Leaf, Eye, EyeOff, ArrowRight, CheckCircle2,
  ShieldCheck, Globe, BrainCircuit
} from 'lucide-react';

export default function SignupPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        router.replace('/dashboard');
      } else {
        setPageLoading(false);
      }
    };
    checkSession();
  }, [router]);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (!email || !password || !confirmPassword) {
      setError('All fields are required');
      setLoading(false);
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      setLoading(false);
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      setLoading(false);
      return;
    }

    const { error: authError } = await supabase.auth.signUp({ email, password });

    if (authError) {
      setError(authError.message);
      setLoading(false);
    } else {
      setSuccess(true);
      setTimeout(() => router.push('/dashboard'), 2000);
    }
  };

  const passwordStrength = (() => {
    if (password.length === 0) return null;
    if (password.length < 6) return { label: 'Too short', color: 'bg-red-400', width: 'w-1/4' };
    if (password.length < 10) return { label: 'Weak', color: 'bg-amber-400', width: 'w-1/2' };
    if (password.length < 14) return { label: 'Good', color: 'bg-blue-500', width: 'w-3/4' };
    return { label: 'Strong', color: 'bg-emerald-500', width: 'w-full' };
  })();

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
      <div className="hidden lg:flex flex-col bg-gradient-to-br from-blue-700 via-indigo-700 to-emerald-700 text-white p-16 relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,rgba(255,255,255,0.08),transparent)] pointer-events-none" />
        <div className="absolute top-0 left-0 w-96 h-96 bg-white/5 rounded-full blur-[80px] pointer-events-none" />

        <div className="relative z-10 flex flex-col h-full">
          <div className="flex items-center gap-2 mb-auto">
            <Leaf size={24} className="text-emerald-300" />
            <span className="text-xl font-bold tracking-tight">Nexus AgriRise</span>
          </div>

          <div className="mb-auto">
            <h1 className="text-4xl font-black leading-tight mb-6">
              Join the future of<br />African agribusiness<br />intelligence.
            </h1>
            <p className="text-blue-100 text-lg leading-relaxed mb-10">
              Create your free account and start generating AI-powered market insights from your agricultural datasets in minutes.
            </p>

            <div className="grid grid-cols-1 gap-5 mb-8">
              {[
                {
                  icon: <BrainCircuit size={20} className="text-emerald-300" />,
                  title: "AI Analysis in 30 seconds",
                  desc: "Upload any CSV and get structured market intelligence instantly.",
                },
                {
                  icon: <Globe size={20} className="text-blue-300" />,
                  title: "Cross-Border Intelligence",
                  desc: "Compare markets across 14+ African countries simultaneously.",
                },
                {
                  icon: <ShieldCheck size={20} className="text-purple-300" />,
                  title: "Enterprise-Grade Security",
                  desc: "Row-level data isolation — your datasets are only ever yours.",
                },
              ].map((item) => (
                <div key={item.title} className="flex items-start gap-4">
                  <div className="p-2 bg-white/10 rounded-xl shrink-0">{item.icon}</div>
                  <div>
                    <p className="font-semibold text-sm mb-0.5">{item.title}</p>
                    <p className="text-xs text-blue-200/70 leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="bg-white/10 border border-white/20 rounded-2xl p-5">
              <p className="text-sm font-semibold mb-2 text-white">Free forever plan includes:</p>
              <div className="space-y-1.5">
                {["Unlimited dataset uploads", "AI insight generation", "PDF report export", "Full demo mode access"].map((f) => (
                  <div key={f} className="flex items-center gap-2">
                    <CheckCircle2 size={14} className="text-emerald-300 shrink-0" />
                    <p className="text-xs text-blue-100">{f}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <p className="text-xs text-blue-300/70 mt-8">
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
            <h2 className="text-3xl font-black text-gray-900 dark:text-white mb-2">Create your account</h2>
            <p className="text-gray-500 dark:text-gray-400">Free forever. No credit card required.</p>
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-xl text-sm mb-6 border border-red-100 dark:border-red-800">
              {error}
            </div>
          )}

          {success && (
            <div className="bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 p-4 rounded-xl text-sm mb-6 border border-emerald-100 dark:border-emerald-800 flex items-center gap-2">
              <CheckCircle2 size={16} className="shrink-0" />
              Account created! Redirecting to your dashboard…
            </div>
          )}

          <form onSubmit={handleSignup} className="space-y-5">
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
                  placeholder="Min. 6 characters"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {/* Strength bar */}
              {passwordStrength && (
                <div className="mt-2">
                  <div className="w-full bg-gray-100 dark:bg-zinc-800 rounded-full h-1.5">
                    <div className={`h-1.5 rounded-full transition-all duration-300 ${passwordStrength.color} ${passwordStrength.width}`} />
                  </div>
                  <p className="text-xs text-gray-400 mt-1">{passwordStrength.label}</p>
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                Confirm password
              </label>
              <div className="relative">
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className={`w-full px-4 py-3 pr-12 border rounded-xl bg-white dark:bg-zinc-900 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:border-transparent transition-all ${
                    confirmPassword && password !== confirmPassword
                      ? 'border-red-300 dark:border-red-700 focus:ring-red-400'
                      : confirmPassword && password === confirmPassword
                      ? 'border-emerald-300 dark:border-emerald-700 focus:ring-emerald-500'
                      : 'border-gray-200 dark:border-zinc-700 focus:ring-emerald-500'
                  }`}
                  placeholder="••••••••"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                >
                  {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {confirmPassword && password === confirmPassword && (
                <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1 flex items-center gap-1">
                  <CheckCircle2 size={12} /> Passwords match
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={loading || success}
              className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-all shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2 mt-2"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Creating account…
                </>
              ) : (
                <>Create Free Account <ArrowRight size={16} /></>
              )}
            </button>

            <p className="text-xs text-gray-400 text-center">
              By creating an account you agree to our{' '}
              <span className="text-emerald-600 dark:text-emerald-400 cursor-pointer hover:underline">Terms of Service</span>.
            </p>
          </form>

          <p className="mt-8 text-center text-sm text-gray-500">
            Already have an account?{' '}
            <Link href="/login" className="text-emerald-600 dark:text-emerald-400 font-semibold hover:underline">
              Sign in
            </Link>
          </p>
        </motion.div>
      </div>
    </div>
  );
}
