"use client";
import { ShieldCheck, Globe, Zap, BrainCircuit, UploadCloud, BarChart3, FileDown, Layers, CheckCircle2, ArrowRight } from "lucide-react";
import { motion } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";

const fadeUp = {
  hidden: { opacity: 0, y: 32 },
  show: (i: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, delay: i * 0.1 },
  }),
};

const services = [
  {
    icon: <BrainCircuit size={32} />,
    title: "AI Market Intelligence",
    tag: "Core",
    tagColor: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    color: "from-emerald-500/10 to-teal-500/5 dark:from-emerald-900/20 dark:to-teal-900/10",
    border: "border-emerald-100 dark:border-emerald-900/40",
    iconColor: "text-emerald-600 dark:text-emerald-400",
    desc: "Our Gemini 1.5-powered engine reads any agricultural CSV and returns structured market intelligence — price trend direction, risk rating, opportunity summary — in under 30 seconds.",
    bullets: [
      "Automatic field detection — no template required",
      "Low / Medium / High risk classification",
      "Trend narrative in plain language",
      "Supports Ethiopian, Rwandan, and CAR market patterns",
    ],
  },
  {
    icon: <Globe size={32} />,
    title: "Cross-Border Trade Optimization",
    tag: "Growth",
    tagColor: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    color: "from-blue-500/10 to-indigo-500/5 dark:from-blue-900/20 dark:to-indigo-900/10",
    border: "border-blue-100 dark:border-blue-900/40",
    iconColor: "text-blue-600 dark:text-blue-400",
    desc: "The Comparison Intelligence module aggregates datasets from multiple countries into a unified regional analysis — surfacing arbitrage windows, export corridors, and import substitution opportunities.",
    bullets: [
      "Side-by-side country comparisons",
      "Opportunity gap analysis across 14+ African markets",
      "Dataset coverage scoring per region",
      "Exportable comparison reports",
    ],
  },
  {
    icon: <ShieldCheck size={32} />,
    title: "Agribusiness Risk Assessment",
    tag: "Protection",
    tagColor: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400",
    color: "from-rose-500/10 to-orange-500/5 dark:from-rose-900/20 dark:to-orange-900/10",
    border: "border-rose-100 dark:border-rose-900/40",
    iconColor: "text-rose-600 dark:text-rose-400",
    desc: "Every AI insight is accompanied by a risk score calibrated to African market volatility — factoring supply chain fragility, seasonal demand shifts, climate disruption signals, and infrastructure constraints.",
    bullets: [
      "Commodity-level risk scoring",
      "Seasonal and climate risk signals",
      "Infrastructure and logistics risk flagging",
      "Historical trend volatility analysis",
    ],
  },
  {
    icon: <BarChart3 size={32} />,
    title: "Performance Analytics Dashboard",
    tag: "Analytics",
    tagColor: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
    color: "from-purple-500/10 to-violet-500/5 dark:from-purple-900/20 dark:to-violet-900/10",
    border: "border-purple-100 dark:border-purple-900/40",
    iconColor: "text-purple-600 dark:text-purple-400",
    desc: "Interactive charts and KPI tiles give agribusiness managers a live view of dataset performance, insight generation velocity, and regional portfolio balance — all updated in real time.",
    bullets: [
      "Dataset volume and insight count KPIs",
      "Country coverage bar charts",
      "Risk distribution breakdowns",
      "Low-risk ratio tracking over time",
    ],
  },
  {
    icon: <FileDown size={32} />,
    title: "Investor-Grade PDF Reports",
    tag: "Export",
    tagColor: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    color: "from-amber-500/10 to-yellow-500/5 dark:from-amber-900/20 dark:to-yellow-900/10",
    border: "border-amber-100 dark:border-amber-900/40",
    iconColor: "text-amber-600 dark:text-amber-400",
    desc: "Every insight can be exported as a formatted PDF — ready for board presentations, investor decks, and NGO grant applications. Includes AI summary, risk rating, trend data, and timestamps.",
    bullets: [
      "One-click PDF export from any insight",
      "Branded with Nexus AgriRise letterhead",
      "Timestamped for audit trails",
      "Print-ready A4 format",
    ],
  },
  {
    icon: <UploadCloud size={32} />,
    title: "Flexible Data Ingestion",
    tag: "Infrastructure",
    tagColor: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400",
    color: "from-teal-500/10 to-cyan-500/5 dark:from-teal-900/20 dark:to-cyan-900/10",
    border: "border-teal-100 dark:border-teal-900/40",
    iconColor: "text-teal-600 dark:text-teal-400",
    desc: "Upload any CSV from any source — farm management systems, market price surveys, NGO data exports, or government agricultural bulletins. Our parser handles heterogeneous schemas automatically.",
    bullets: [
      "Drag-and-drop CSV upload",
      "Auto-preview with column detection",
      "Supabase file storage with row-level security",
      "Demo mode requires zero real data",
    ],
  },
];

const useCases = [
  { role: "Agribusiness Investors", desc: "Screen commodity markets across multiple African countries before capital deployment. Use risk scores to build diversified agri-portfolios." },
  { role: "Export-Import Traders", desc: "Identify cross-border arbitrage windows. See which markets have supply gaps and where export premiums are highest." },
  { role: "NGOs & Development Organizations", desc: "Monitor food security signals across regions. Generate grant-ready market reports from field survey data." },
  { role: "Agricultural Cooperatives", desc: "Benchmark cooperative pricing against regional market averages. Identify optimal market channels for surplus production." },
  { role: "Government Policy Teams", desc: "Track commodity price trends and supply disruptions. Generate evidence-based briefs for agricultural policy decisions." },
  { role: "Agritech Startups", desc: "Integrate AI market intelligence into your own products via our API. Enrich your datasets with cross-border comparison signals." },
];

export default function ServicesPage() {
  const router = useRouter();

  return (
    <div className="flex flex-col bg-white dark:bg-black min-h-screen pt-20 overflow-x-hidden">

      {/* HERO */}
      <section className="py-24 container mx-auto px-6 text-center">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7 }}
          className="max-w-3xl mx-auto"
        >
          <span className="inline-block px-4 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 text-sm font-semibold mb-6 uppercase tracking-widest">
            What We Offer
          </span>
          <h1 className="text-5xl lg:text-6xl font-black mb-6 tracking-tight text-gray-900 dark:text-white">
            Intelligence services built for{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-600 to-blue-600">
              African agribusiness
            </span>
          </h1>
          <p className="text-xl text-gray-500 dark:text-gray-400 leading-relaxed max-w-2xl mx-auto mb-10">
            Six integrated capability modules that turn raw agricultural data into strategic market intelligence — from commodity price analysis to cross-border trade optimization.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button
              label="Try the Platform Free"
              onClick={() => router.push('/dashboard')}
              className="px-10 py-4 rounded-full shadow-xl shadow-emerald-500/20 text-base"
            />
            <Link href="/about">
              <button className="px-10 py-4 rounded-full border border-gray-200 dark:border-zinc-800 font-semibold hover:bg-gray-50 dark:hover:bg-zinc-900 transition-colors text-base w-full sm:w-auto">
                Meet the Team
              </button>
            </Link>
          </div>
        </motion.div>
      </section>

      {/* SERVICE CARDS */}
      <section className="py-8 pb-28 container mx-auto px-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {services.map((s, i) => (
            <motion.div
              key={s.title}
              variants={fadeUp}
              initial="hidden"
              whileInView="show"
              custom={i}
              viewport={{ once: true }}
              className={`bg-gradient-to-br ${s.color} border ${s.border} rounded-3xl p-8 hover:shadow-xl hover:-translate-y-1 transition-all duration-300`}
            >
              <div className="flex items-start justify-between mb-6">
                <div className={`p-3 bg-white dark:bg-zinc-900 rounded-2xl shadow-sm ${s.iconColor}`}>
                  {s.icon}
                </div>
                <span className={`text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-full ${s.tagColor}`}>
                  {s.tag}
                </span>
              </div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">{s.title}</h2>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed mb-6">{s.desc}</p>
              <ul className="space-y-2.5">
                {s.bullets.map((b) => (
                  <li key={b} className="flex items-start gap-2.5 text-sm text-gray-600 dark:text-gray-400">
                    <CheckCircle2 size={15} className="text-emerald-500 mt-0.5 shrink-0" />
                    {b}
                  </li>
                ))}
              </ul>
            </motion.div>
          ))}
        </div>
      </section>

      {/* USE CASES */}
      <section className="py-28 bg-gray-50 dark:bg-zinc-950">
        <div className="container mx-auto px-6">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <span className="inline-block px-4 py-1.5 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 text-sm font-semibold mb-4 uppercase tracking-widest">
              Use Cases
            </span>
            <h2 className="text-4xl font-black tracking-tight text-gray-900 dark:text-white">
              Who uses Nexus AgriRise?
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
            {useCases.map((u, i) => (
              <motion.div
                key={u.role}
                variants={fadeUp}
                initial="hidden"
                whileInView="show"
                custom={i}
                viewport={{ once: true }}
                className="bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-2xl p-7 hover:shadow-md transition-shadow"
              >
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 rounded-full bg-emerald-500" />
                  <h3 className="font-bold text-gray-900 dark:text-white text-base">{u.role}</h3>
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">{u.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* DEMO MODE HIGHLIGHT */}
      <section className="py-28 container mx-auto px-6">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              whileInView={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.8 }}
              viewport={{ once: true }}
            >
              <span className="inline-block px-4 py-1.5 rounded-full bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-400 text-sm font-semibold mb-6 uppercase tracking-widest">
                Zero-Barrier Access
              </span>
              <h2 className="text-4xl font-black tracking-tight text-gray-900 dark:text-white mb-6">
                Explore everything with{" "}
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-violet-600 to-purple-600">
                  Demo Mode
                </span>
              </h2>
              <p className="text-lg text-gray-500 dark:text-gray-400 leading-relaxed mb-8">
                Not ready to upload real data? Enable Demo Mode in the dashboard with a single toggle. You'll instantly get access to pre-loaded, investor-grade African agribusiness intelligence data — no API keys, no sign-in, no uploads required.
              </p>
              <div className="space-y-3 mb-8">
                {[
                  "4 pre-loaded country datasets (Ethiopia, Rwanda, CAR)",
                  "Full cross-border comparison intelligence",
                  "AI-generated market insights with risk scores",
                  "All analytics features enabled immediately",
                ].map((point) => (
                  <div key={point} className="flex items-start gap-2.5 text-sm text-gray-600 dark:text-gray-400">
                    <CheckCircle2 size={15} className="text-violet-500 mt-0.5 shrink-0" />
                    {point}
                  </div>
                ))}
              </div>
              <Button
                label="Launch Demo Mode"
                onClick={() => router.push('/dashboard')}
                className="px-8 py-3.5 rounded-full shadow-lg shadow-violet-500/20 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-sm"
              />
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 30 }}
              whileInView={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.8, delay: 0.1 }}
              viewport={{ once: true }}
              className="bg-gradient-to-br from-violet-50 to-purple-50 dark:from-violet-900/10 dark:to-purple-900/10 border border-violet-100 dark:border-violet-900/30 rounded-3xl p-8 space-y-4"
            >
              <div className="flex items-center gap-2 mb-4">
                <div className="w-2 h-2 rounded-full bg-violet-500 animate-pulse" />
                <span className="text-xs font-bold text-violet-600 dark:text-violet-400 uppercase tracking-widest">Demo Mode Preview</span>
              </div>
              {[
                { country: "Ethiopia · Maize", risk: "Medium", riskColor: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300", summary: "14% farmgate price rise QoQ. Supply gap ~180K MT. Export arbitrage to South Sudan recommended." },
                { country: "Rwanda · Beans", risk: "Low", riskColor: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300", summary: "USD 920/MT FOB. EU organic certification unlocking USD 4.2M premium export lane." },
                { country: "CAR · Cassava", risk: "High", riskColor: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300", summary: "88% of harvest unprocessed. First-mover cassava flour processing opportunity. 35%+ post-harvest losses." },
              ].map((item) => (
                <div key={item.country} className="bg-white dark:bg-zinc-900 rounded-2xl p-5 border border-gray-100 dark:border-zinc-800">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">{item.country}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${item.riskColor}`}>{item.risk} Risk</span>
                  </div>
                  <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">{item.summary}</p>
                </div>
              ))}
            </motion.div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-zinc-950 text-white relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(16,185,129,0.08),transparent)] pointer-events-none" />
        <div className="container mx-auto px-6 text-center relative z-10">
          <h2 className="text-4xl font-black mb-4">Ready to get started?</h2>
          <p className="text-gray-400 text-lg mb-10 max-w-xl mx-auto">
            Create a free account and upload your first dataset — or jump straight into Demo Mode.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button
              onClick={() => router.push('/signup')}
              className="px-10 py-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-full transition-colors shadow-lg shadow-emerald-600/30"
            >
              Create Free Account
            </button>
            <button
              onClick={() => router.push('/dashboard')}
              className="px-10 py-4 bg-white/10 border border-white/20 font-semibold rounded-full hover:bg-white/20 transition-colors flex items-center justify-center gap-2"
            >
              Explore Demo Mode <ArrowRight size={16} />
            </button>
          </div>
        </div>
      </section>

      <footer className="py-10 border-t border-gray-100 dark:border-zinc-900 text-center text-sm text-gray-500 bg-white dark:bg-black">
        <p>&copy; 2026 Nexus AgriRise Africa. All rights reserved.</p>
      </footer>
    </div>
  );
}
