"use client";
import { Button } from "@/components/Button";
import { useRouter } from "next/navigation";
import { AfricaMap } from "@/components/AfricaMap";
import { motion } from "framer-motion";
import Link from "next/link";
import {
  ChevronRight,
  ShieldCheck,
  Globe,
  Zap,
  Mail,
  Phone,
  MapPin,
  BrainCircuit,
  UploadCloud,
  BarChart3,
  TrendingUp,
  Users,
  Database,
  ArrowRight,
  CheckCircle2,
  Sprout,
} from "lucide-react";

const fadeUp = {
  hidden: { opacity: 0, y: 32 },
  show: (i: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, delay: i * 0.12 },
  }),
};

export default function Home() {
  const router = useRouter();

  const features = [
    {
      icon: <UploadCloud size={28} className="text-emerald-600 dark:text-emerald-400" />,
      color: "bg-emerald-50 dark:bg-emerald-900/20",
      title: "Upload Agricultural Data",
      desc: "Ingest CSV datasets from farms, markets, and cooperatives across any African country in seconds.",
    },
    {
      icon: <BrainCircuit size={28} className="text-blue-600 dark:text-blue-400" />,
      color: "bg-blue-50 dark:bg-blue-900/20",
      title: "AI-Powered Analysis",
      desc: "Our Gemini-powered engine automatically extracts market trends, risk signals, and price forecasts from raw data.",
    },
    {
      icon: <Globe size={28} className="text-purple-600 dark:text-purple-400" />,
      color: "bg-purple-50 dark:bg-purple-900/20",
      title: "Cross-Border Intelligence",
      desc: "Compare markets across Ethiopia, Rwanda, CAR, and beyond — identify arbitrage and export opportunities in real time.",
    },
    {
      icon: <ShieldCheck size={28} className="text-rose-600 dark:text-rose-400" />,
      color: "bg-rose-50 dark:bg-rose-900/20",
      title: "Risk Assessment",
      desc: "Every insight carries a Low / Medium / High risk score, so decision-makers can act with full situational awareness.",
    },
    {
      icon: <BarChart3 size={28} className="text-amber-600 dark:text-amber-400" />,
      color: "bg-amber-50 dark:bg-amber-900/20",
      title: "Interactive Analytics",
      desc: "Dynamic dashboards surface commodity trends, country comparisons, and opportunity gap analysis visually.",
    },
    {
      icon: <Zap size={28} className="text-teal-600 dark:text-teal-400" />,
      color: "bg-teal-50 dark:bg-teal-900/20",
      title: "Export-Ready Reports",
      desc: "Download investor-grade PDF reports from any insight card to share intelligence with stakeholders instantly.",
    },
  ];

  const steps = [
    { num: "01", title: "Create an Account", desc: "Sign up in under 60 seconds. No credit card required.", icon: <Users size={20} /> },
    { num: "02", title: "Upload Your Dataset", desc: "Drag-and-drop a CSV from any agribusiness source.", icon: <UploadCloud size={20} /> },
    { num: "03", title: "Generate AI Insights", desc: "Click Analyze — our AI returns structured market intelligence in moments.", icon: <BrainCircuit size={20} /> },
    { num: "04", title: "Act on Intelligence", desc: "Download reports, compare countries, and discover trade opportunities.", icon: <TrendingUp size={20} /> },
  ];

  const stats = [
    { value: "14+", label: "African Markets Covered" },
    { value: "4", label: "AI Insight Categories" },
    { value: "< 30s", label: "Average Analysis Time" },
    { value: "100%", label: "Data Privacy Guaranteed" },
  ];

  const sampleInsights = [
    {
      country: "Ethiopia",
      crop: "Maize",
      risk: "Medium",
      riskColor: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
      summary: "Farmgate prices rose 14% QoQ due to rainfall deficits in Oromia. Export arbitrage to South Sudan presents near-term opportunity.",
      trend: "Prices trending upward · Supply gap ~180K MT",
    },
    {
      country: "Rwanda",
      crop: "Beans",
      risk: "Low",
      riskColor: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
      summary: "FOB prices stable at USD 920/MT. Northern Province cooperatives achieving EU organic certification — USD 4.2M premium export lane opening.",
      trend: "Export volumes +22% YoY · Strongly bullish",
    },
    {
      country: "Ethiopia",
      crop: "Coffee",
      risk: "Low",
      riskColor: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
      summary: "Yirgacheffe Grade 1 commanding 40–65% premium over commodity futures. Direct-trade routes improving farmer income retention to 38%.",
      trend: "Specialty premiums expanding · Record ECX volumes in Q1",
    },
  ];

  return (
    <div className="flex flex-col bg-white dark:bg-black overflow-x-hidden">

      {/* ── HERO ── */}
      <section className="relative min-h-[85vh] flex flex-col justify-start pt-16 pb-10 px-4 lg:px-6 xl:px-10 overflow-hidden">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-emerald-500/5 rounded-full blur-[120px] animate-pulse" />
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-500/5 rounded-full blur-[120px] animate-pulse delay-1000" />
        </div>

        <div className="w-full max-w-[120rem] mx-auto grid grid-cols-1 lg:grid-cols-2 gap-8 items-center relative z-10 flex-1 lg:-mt-12">
          <motion.div
            initial={{ opacity: 0, x: -50 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8 }}
            className="text-left lg:-ml-4 xl:-ml-10"
          >
            <span className="inline-block px-4 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 text-sm font-semibold mb-6">
              A Nexus Partnership with AGRIC AI
            </span>
            <h1 className="text-5xl lg:text-7xl font-black tracking-tight text-gray-900 dark:text-white mb-8 leading-tight">
              Empowering Agriculture <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-600 to-blue-600">Growth</span> through <br />
              Intelligence.
            </h1>
            <p className="text-xl text-gray-600 dark:text-gray-400 mb-10 max-w-xl leading-relaxed">
              Nexus AgriRise transforms complex agricultural data into actionable insights for Ethiopia, Rwanda, Central African Republic, and beyond.
            </p>

            <div className="flex flex-col sm:flex-row gap-4">
              <Button
                label="Get Started Free"
                onClick={() => router.push('/dashboard')}
                className="text-lg px-10 py-4 rounded-full shadow-2xl shadow-emerald-500/30 group"
              >
                <ChevronRight className="ml-2 group-hover:translate-x-1 transition-transform" />
              </Button>
              <Link href="#how-it-works">
                <button className="px-10 py-4 rounded-full border border-gray-200 dark:border-zinc-800 font-semibold hover:bg-gray-50 dark:hover:bg-zinc-900 transition-colors w-full sm:w-auto">
                  See How It Works
                </button>
              </Link>
            </div>

            {/* Trust chips */}
            <div className="flex flex-wrap gap-3 mt-10">
              {["Gemini AI Engine", "Supabase Secured", "YALI Affiliated", "Open Source"].map((tag) => (
                <span key={tag} className="flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-full px-3 py-1.5">
                  <CheckCircle2 size={12} className="text-emerald-500" /> {tag}
                </span>
              ))}
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 1, delay: 0.2 }}
            className="relative flex justify-end lg:translate-x-12 xl:translate-x-20"
          >
            <div className="w-full max-w-[120%] lg:max-w-3xl xl:max-w-4xl scale-110 lg:scale-125 transform-gpu origin-center lg:origin-right">
              <AfricaMap />
            </div>
          </motion.div>
        </div>

        {/* Motto / Footer of Hero */}
        <div className="w-full text-center relative z-10 mt-12 lg:mt-16 xl:mt-24">
          <p className="text-2xl md:text-4xl font-extrabold italic tracking-wide text-transparent bg-clip-text bg-gradient-to-r from-emerald-600 via-teal-500 to-blue-600 drop-shadow-sm">
            “Africa does not lack food, it lacks intelligence in its food systems.”
          </p>
        </div>
      </section>

      {/* ── STATS BAR ── */}
      <section className="py-12 bg-emerald-600 dark:bg-emerald-800">
        <div className="container mx-auto px-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 text-white text-center">
            {stats.map((s, i) => (
              <motion.div
                key={s.label}
                variants={fadeUp}
                initial="hidden"
                whileInView="show"
                custom={i}
                viewport={{ once: true }}
              >
                <p className="text-4xl font-black mb-1">{s.value}</p>
                <p className="text-emerald-100 text-sm font-medium">{s.label}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section className="py-28 container mx-auto px-6">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <span className="inline-block px-4 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 text-sm font-semibold mb-4 uppercase tracking-widest">
            Platform Capabilities
          </span>
          <h2 className="text-4xl lg:text-5xl font-black tracking-tight text-gray-900 dark:text-white">
            Everything you need to <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-600 to-blue-600">scale African agribusiness</span>
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {features.map((f, i) => (
            <motion.div
              key={f.title}
              variants={fadeUp}
              initial="hidden"
              whileInView="show"
              custom={i}
              viewport={{ once: true }}
              className="bg-gray-50 dark:bg-zinc-900/60 border border-gray-100 dark:border-zinc-800 rounded-3xl p-8 hover:shadow-lg hover:-translate-y-1 transition-all duration-300"
            >
              <div className={`w-14 h-14 rounded-2xl ${f.color} flex items-center justify-center mb-6`}>
                {f.icon}
              </div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-3">{f.title}</h3>
              <p className="text-gray-500 dark:text-gray-400 leading-relaxed">{f.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section id="how-it-works" className="py-28 bg-gray-50 dark:bg-zinc-950">
        <div className="container mx-auto px-6">
          <div className="text-center max-w-2xl mx-auto mb-20">
            <span className="inline-block px-4 py-1.5 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 text-sm font-semibold mb-4 uppercase tracking-widest">
              Getting Started
            </span>
            <h2 className="text-4xl lg:text-5xl font-black tracking-tight text-gray-900 dark:text-white">
              From raw data to <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-emerald-600">market intelligence</span> in 4 steps
            </h2>
          </div>

          <div className="relative max-w-4xl mx-auto">
            {/* connector line */}
            <div className="absolute top-10 left-10 right-10 h-0.5 bg-gradient-to-r from-emerald-200 via-blue-200 to-emerald-200 dark:from-emerald-900 dark:via-blue-900 dark:to-emerald-900 hidden lg:block" />

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-10 relative z-10">
              {steps.map((step, i) => (
                <motion.div
                  key={step.num}
                  variants={fadeUp}
                  initial="hidden"
                  whileInView="show"
                  custom={i}
                  viewport={{ once: true }}
                  className="flex flex-col items-center text-center"
                >
                  <div className="w-20 h-20 rounded-full bg-white dark:bg-zinc-900 border-2 border-emerald-200 dark:border-emerald-800 flex items-center justify-center mb-6 shadow-sm text-emerald-600 dark:text-emerald-400">
                    {step.icon}
                  </div>
                  <p className="text-xs font-black text-emerald-500 uppercase tracking-widest mb-2">{step.num}</p>
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">{step.title}</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">{step.desc}</p>
                </motion.div>
              ))}
            </div>
          </div>

          <div className="flex justify-center mt-16">
            <Button
              label="Launch the Platform"
              onClick={() => router.push('/dashboard')}
              className="text-base px-10 py-4 rounded-full shadow-xl shadow-emerald-500/20 group"
            >
              <ArrowRight className="ml-2 group-hover:translate-x-1 transition-transform" />
            </Button>
          </div>
        </div>
      </section>

      {/* ── AI INSIGHTS PREVIEW ── */}
      <section id="insights" className="py-28 container mx-auto px-6">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 mb-14">
          <div>
            <span className="inline-block px-4 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 text-sm font-semibold mb-4 uppercase tracking-widest">
              Live Sample Insights
            </span>
            <h2 className="text-4xl lg:text-5xl font-black tracking-tight text-gray-900 dark:text-white">
              Real intelligence, <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-600 to-blue-600">real markets</span>
            </h2>
          </div>
          <Link
            href="/dashboard"
            className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-semibold text-sm hover:gap-3 transition-all shrink-0"
          >
            View all intelligence <ArrowRight size={16} />
          </Link>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {sampleInsights.map((ins, i) => (
            <motion.div
              key={ins.crop + ins.country}
              variants={fadeUp}
              initial="hidden"
              whileInView="show"
              custom={i}
              viewport={{ once: true }}
              className="bg-white dark:bg-zinc-900 rounded-3xl border border-gray-100 dark:border-zinc-800 shadow-sm p-7 flex flex-col gap-4 hover:shadow-lg hover:-translate-y-1 transition-all duration-300"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sprout size={16} className="text-emerald-500" />
                  <span className="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                    {ins.country} · {ins.crop}
                  </span>
                </div>
                <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${ins.riskColor}`}>
                  {ins.risk} Risk
                </span>
              </div>
              <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed flex-1">{ins.summary}</p>
              <div className="text-xs text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-zinc-800 rounded-xl px-4 py-3 italic">
                {ins.trend}
              </div>
            </motion.div>
          ))}
        </div>

        <div className="mt-10 text-center">
          <p className="text-sm text-gray-400 mb-4">These are sample insights. Upload your own data to generate tailored intelligence.</p>
          <Button
            label="Try Demo Mode Free"
            onClick={() => router.push('/dashboard')}
            className="text-sm px-8 py-3 rounded-full shadow-lg shadow-emerald-500/20"
          />
        </div>
      </section>

      {/* ── CTA BANNER ── */}
      <section className="py-20 container mx-auto px-6">
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          whileInView={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.7 }}
          viewport={{ once: true }}
          className="bg-gradient-to-r from-emerald-600 via-teal-600 to-blue-700 rounded-[2.5rem] p-12 md:p-16 text-white text-center relative overflow-hidden shadow-2xl shadow-emerald-500/20"
        >
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(255,255,255,0.08),transparent)] pointer-events-none" />
          <h2 className="text-4xl lg:text-5xl font-black mb-4 relative z-10">
            Start generating intelligence today.
          </h2>
          <p className="text-emerald-100 text-lg mb-10 max-w-xl mx-auto relative z-10">
            No credit card. No setup. Enable Demo Mode and explore investor-grade African agribusiness insights in under 60 seconds.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center relative z-10">
            <button
              onClick={() => router.push('/dashboard')}
              className="px-10 py-4 bg-white text-emerald-700 font-bold rounded-full hover:bg-emerald-50 transition-colors shadow-lg"
            >
              Launch Platform →
            </button>
            <Link href="/about">
              <button className="px-10 py-4 bg-white/10 border border-white/20 font-semibold rounded-full hover:bg-white/20 transition-colors w-full sm:w-auto">
                Meet the Team
              </button>
            </Link>
          </div>
        </motion.div>
      </section>

      {/* ── PLATFORM OVERVIEW SPLIT ── */}
      <section className="py-28 bg-zinc-950 text-white relative overflow-hidden">
        <div className="absolute top-0 left-0 w-[600px] h-[600px] bg-emerald-600/5 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute bottom-0 right-0 w-[600px] h-[600px] bg-blue-600/5 rounded-full blur-[120px] pointer-events-none" />

        <div className="container mx-auto px-6 relative z-10">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <motion.div
              initial={{ opacity: 0, x: -40 }}
              whileInView={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.8 }}
              viewport={{ once: true }}
            >
              <span className="inline-block px-4 py-1.5 rounded-full bg-white/5 border border-white/10 text-emerald-400 text-sm font-semibold mb-6 uppercase tracking-widest">
                Why Nexus AgriRise?
              </span>
              <h2 className="text-4xl lg:text-5xl font-black mb-8 leading-tight">
                Built for the <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-blue-400">complexity of African agriculture</span>
              </h2>
              <p className="text-lg text-gray-400 leading-relaxed mb-10">
                African agribusiness operates across fragmented markets, multiple languages, unreliable connectivity, and complex cross-border regulations. We built Nexus AgriRise specifically for this reality — not as a Western platform adapted for Africa, but as a system designed from the ground up for the continent's unique challenges.
              </p>

              <div className="space-y-4">
                {[
                  "AI engine trained on African commodity data patterns",
                  "Works with any CSV — no template required",
                  "Demo mode requires zero API keys or sign-in",
                  "Multilingual dataset support across regional markets",
                ].map((point) => (
                  <div key={point} className="flex items-start gap-3">
                    <CheckCircle2 size={18} className="text-emerald-400 mt-0.5 shrink-0" />
                    <p className="text-gray-300 text-sm">{point}</p>
                  </div>
                ))}
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 40 }}
              whileInView={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.8, delay: 0.1 }}
              viewport={{ once: true }}
              className="grid grid-cols-2 gap-4"
            >
              {[
                { icon: <Database size={24} />, title: "Supabase Backend", desc: "Row-level security, real-time sync, and managed Postgres for every user.", color: "text-blue-400" },
                { icon: <BrainCircuit size={24} />, title: "Gemini 1.5 Flash", desc: "Google's fastest AI model for sub-30-second dataset analysis.", color: "text-emerald-400" },
                { icon: <ShieldCheck size={24} />, title: "Enterprise Security", desc: "Your data never leaves your Supabase tenant. Zero data sharing.", color: "text-purple-400" },
                { icon: <Globe size={24} />, title: "Pan-African Scope", desc: "14+ countries supported. New markets added every quarter.", color: "text-rose-400" },
              ].map((card, i) => (
                <motion.div
                  key={card.title}
                  variants={fadeUp}
                  initial="hidden"
                  whileInView="show"
                  custom={i}
                  viewport={{ once: true }}
                  className="bg-white/5 border border-white/10 rounded-2xl p-6 hover:bg-white/8 transition-colors"
                >
                  <div className={`mb-4 ${card.color}`}>{card.icon}</div>
                  <h3 className="font-bold text-white mb-2 text-sm">{card.title}</h3>
                  <p className="text-xs text-gray-400 leading-relaxed">{card.desc}</p>
                </motion.div>
              ))}
            </motion.div>
          </div>
        </div>
      </section>


      <footer className="py-10 border-t border-gray-100 dark:border-zinc-900 text-center text-sm text-gray-500">
        <p>&copy; 2026 Nexus AgriRise Africa. All rights reserved.</p>
      </footer>
    </div>
  );
}
