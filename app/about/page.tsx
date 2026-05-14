"use client";
import { motion } from "framer-motion";
import { Mail, ExternalLink, Shield, Code, Server } from "lucide-react";

const EmailIcon = () => (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>);
const LinkedInIcon = () => (<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>);
const XIcon = () => (<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 22.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>);
const GitHubIcon = () => (<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>);

export default function AboutPage() {
  return (
    <div className="flex flex-col bg-white dark:bg-black min-h-screen pt-20">
      <section className="py-24 container mx-auto px-6">
        <div className="text-center max-w-3xl mx-auto mb-20">
          <h1 className="text-5xl font-black mb-6 tracking-tight">About <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-600 to-blue-600">Nexus AgriRise</span></h1>
          <p className="text-xl text-gray-500 leading-relaxed">
            We are building the digital future of African Agriculture through visionary AI and data engineering.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-20 items-center mb-32">
          <motion.div initial={{ opacity: 0, x: -50 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.8 }}>
            <h2 className="text-4xl font-bold mb-8">Visionary AI for African Agriculture</h2>
            <p className="text-lg text-gray-600 dark:text-gray-400 mb-6 leading-relaxed">
              Nexus AgriRise is an advanced AI-powered platform designed to transform complex agricultural data into actionable intelligence. By bridging the gap between raw data and strategic decision-making, our system empowers agribusinesses, farmers, and policymakers across Africa to optimize operations and mitigate cross-border risks.
            </p>
            <p className="text-lg text-gray-600 dark:text-gray-400 leading-relaxed">
              Our mission is to build the digital infrastructure for African agriculture. Through real-time data analysis, predictive modeling, and intelligent reporting, Nexus AgriRise delivers the exact insights needed to solve the continent's most pressing food security and supply chain challenges.
            </p>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 1 }}
            className="bg-emerald-600 h-[500px] rounded-[3rem] relative overflow-hidden group shadow-2xl"
          >
            <img
              src="/Afri.png"
              className="absolute inset-0 w-full h-full object-cover opacity-80 group-hover:scale-105 transition-transform duration-1000"
              alt="African agriculture"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-emerald-900 via-emerald-900/40 to-transparent" />
            <div className="absolute bottom-12 left-12 right-12 text-white">
              <p className="text-3xl font-bold italic leading-tight mb-4">&ldquo;We are building the digital future of African Agriculture.&rdquo;</p>
              <div className="w-12 h-1 bg-emerald-400 mb-4 rounded-full" />
              <p className="text-lg font-semibold tracking-wide">— Augustin Nkundimana</p>
            </div>
          </motion.div>
        </div>

        {/* LEADERSHIP SECTION */}
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <span className="inline-block px-4 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 text-sm font-semibold mb-4 uppercase tracking-widest">
              Executive Team
            </span>
            <h2 className="text-4xl font-bold text-gray-900 dark:text-white">Our Leadership</h2>
          </div>

          <div className="space-y-12">

            {/* Augustin */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="bg-gray-50 dark:bg-zinc-900/50 rounded-[2.5rem] p-8 md:p-12 border border-gray-100 dark:border-zinc-800 flex flex-col md:flex-row gap-10 relative overflow-hidden"
            >
              <div className="absolute top-0 left-0 w-64 h-64 bg-emerald-500/5 rounded-full blur-[80px] pointer-events-none" />

              {/* Profile image — large, fills card height */}
              <div className="w-full md:w-64 flex-shrink-0 relative z-10">
                <div className="w-full h-64 md:h-full min-h-[280px] rounded-3xl overflow-hidden border-2 border-emerald-500/20 shadow-lg">
                  <img
                    src="/Augestin.jpeg"
                    alt="Augustin Nkundimana"
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).src =
                        'https://images.unsplash.com/photo-1506277886164-e25aa3f4ef7f?q=80&w=400&auto=format&fit=crop';
                    }}
                  />
                </div>
              </div>

              <div className="relative z-10 flex-1">
                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4 mb-5">
                  <div>
                    <h3 className="text-3xl font-bold text-gray-900 dark:text-white mb-1">Augustin Nkundimana</h3>
                    <p className="text-emerald-600 dark:text-emerald-400 font-medium text-lg">Founder &amp; CEO of AGRIC AI | Mandela Washington Fellow</p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <a href="mailto:augunkundimana@gmail.com" className="p-2 bg-white dark:bg-zinc-800 rounded-lg text-gray-500 hover:text-emerald-600 transition-colors shadow-sm border border-gray-100 dark:border-zinc-700 flex items-center justify-center"><EmailIcon /></a>
                    <a href="https://www.linkedin.com/in/augustin-nkundimana-162349257" target="_blank" rel="noreferrer" className="p-2 bg-white dark:bg-zinc-800 rounded-lg text-gray-500 hover:text-blue-600 transition-colors shadow-sm border border-gray-100 dark:border-zinc-700 flex items-center justify-center"><LinkedInIcon /></a>
                    <a href="https://x.com/aunkundimana?s=21" target="_blank" rel="noreferrer" className="p-2 bg-white dark:bg-zinc-800 rounded-lg text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors shadow-sm border border-gray-100 dark:border-zinc-700 flex items-center justify-center"><XIcon /></a>
                    <a href="https://github.com/nkundiman" target="_blank" rel="noreferrer" className="p-2 bg-white dark:bg-zinc-800 rounded-lg text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors shadow-sm border border-gray-100 dark:border-zinc-700 flex items-center justify-center"><GitHubIcon /></a>
                  </div>
                </div>
                <p className="text-lg text-gray-600 dark:text-gray-400 leading-relaxed mb-4">
                  Augustin Nkundimana is a Kigali-based Agritech Engineer, AI Entrepreneur, and Founder &amp; CEO of AGRIC AI. A 2025 Mandela Washington Fellow specializing in precision agriculture, he develops AI-driven solutions like offline crop disease detection and tractor-sharing marketplaces to drive climate-smart agriculture, youth leadership, and pan-African food security.
                </p>
                <p className="text-emerald-600 dark:text-emerald-400 font-semibold text-sm">Contact: +250783692429</p>
              </div>
            </motion.div>

            {/* Newaz */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="bg-gray-50 dark:bg-zinc-900/50 rounded-[2.5rem] p-8 md:p-12 border border-gray-100 dark:border-zinc-800 flex flex-col md:flex-row gap-10 relative overflow-hidden"
            >
              <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/5 rounded-full blur-[80px] pointer-events-none" />

              {/* Profile image — large, fills card height */}
              <div className="w-full md:w-64 flex-shrink-0 relative z-10">
                <div className="w-full h-64 md:h-full min-h-[280px] rounded-3xl overflow-hidden border-2 border-blue-500/20 shadow-lg">
                  <img
                    src="/Newaz.png"
                    alt="Newaz Nezif Abagero"
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).src =
                        'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?q=80&w=400&auto=format&fit=crop';
                    }}
                  />
                </div>
              </div>

              <div className="relative z-10 flex-1">
                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4 mb-5">
                  <div>
                    <h3 className="text-3xl font-bold text-gray-900 dark:text-white mb-1">Newaz Nezif Abagero</h3>
                    <p className="text-blue-600 dark:text-blue-400 font-medium text-lg">Co-Founder &amp; Lead AI Architect | Cybersecurity Analyst</p>
                  </div>
                  <div className="flex gap-3">
                    <a href="https://linkedin.com/in/newaz-nezif-285439262" target="_blank" rel="noreferrer" className="p-2 bg-white dark:bg-zinc-800 rounded-lg text-gray-500 hover:text-blue-600 transition-colors shadow-sm border border-gray-100 dark:border-zinc-700 flex items-center justify-center"><LinkedInIcon /></a>
                    <a href="https://github.com/NewazNezif" target="_blank" rel="noreferrer" className="p-2 bg-white dark:bg-zinc-800 rounded-lg text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors shadow-sm border border-gray-100 dark:border-zinc-700 flex items-center justify-center"><GitHubIcon /></a>
                    <a href="https://newaznezif.netlify.app/" target="_blank" rel="noreferrer" className="p-2 bg-white dark:bg-zinc-800 rounded-lg text-gray-500 hover:text-emerald-600 transition-colors shadow-sm border border-gray-100 dark:border-zinc-700"><ExternalLink size={20} /></a>
                  </div>
                </div>

                <p className="text-lg text-gray-600 dark:text-gray-400 leading-relaxed mb-6">
                  Newaz Nezif Abagero is an Addis Ababa-based Cybersecurity Analyst at FDRE INSA and Full-Stack Developer. With expertise in threat monitoring and secure API integration, he builds scalable systems in Python, Java, and modern web frameworks. As a 10 Academy Mastery Graduate, he also brings deep experience in Generative AI, PyTorch, and TensorFlow.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-white dark:bg-zinc-800/50 p-5 rounded-2xl border border-gray-100 dark:border-zinc-700/50">
                    <Shield className="text-blue-500 mb-3" size={22} />
                    <h4 className="font-bold text-gray-900 dark:text-white mb-1 text-sm">Cybersecurity</h4>
                    <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">ISC2 CC · CEH · SOC Analysis · Penetration Testing · FDRE INSA</p>
                  </div>
                  <div className="bg-white dark:bg-zinc-800/50 p-5 rounded-2xl border border-gray-100 dark:border-zinc-700/50">
                    <Code className="text-emerald-500 mb-3" size={22} />
                    <h4 className="font-bold text-gray-900 dark:text-white mb-1 text-sm">Development</h4>
                    <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">Python · Java · React · Next.js · Secure API Architecture</p>
                  </div>
                  <div className="bg-white dark:bg-zinc-800/50 p-5 rounded-2xl border border-gray-100 dark:border-zinc-700/50">
                    <Server className="text-purple-500 mb-3" size={22} />
                    <h4 className="font-bold text-gray-900 dark:text-white mb-1 text-sm">AI &amp; Data</h4>
                    <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">PyTorch · TensorFlow · Gen AI · 10 Academy Mastery Graduate</p>
                  </div>
                </div>
              </div>
            </motion.div>

            {/* Adonis */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="bg-gray-50 dark:bg-zinc-900/50 rounded-[2.5rem] p-8 md:p-12 border border-gray-100 dark:border-zinc-800 flex flex-col md:flex-row gap-10 relative overflow-hidden"
            >
              <div className="absolute top-0 right-0 w-64 h-64 bg-orange-500/5 rounded-full blur-[80px] pointer-events-none" />

              {/* Profile image — large, fills card height */}
              <div className="w-full md:w-64 flex-shrink-0 relative z-10">
                <div className="w-full h-64 md:h-full min-h-[280px] rounded-3xl overflow-hidden border-2 border-orange-500/20 shadow-lg">
                  <img
                    src="/Adonis.jpeg"
                    alt="Adonis Wesley NGOY"
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).src =
                        'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?q=80&w=400&auto=format&fit=crop';
                    }}
                  />
                </div>
              </div>

              <div className="relative z-10 flex-1">
                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4 mb-5">
                  <div>
                    <h3 className="text-3xl font-bold text-gray-900 dark:text-white mb-1">Adonis Wesley NGOY</h3>
                    <p className="text-orange-600 dark:text-orange-400 font-medium text-lg">Founder &amp; Executive Director, Les Cocotiers De Bangui</p>
                  </div>
                </div>
                <p className="text-lg text-gray-600 dark:text-gray-400 leading-relaxed">
                  Adonis Wesley NGOY is the Founder and Executive Director of Les Cocotiers De Bangui, driving youth empowerment and social innovation in the Central African Republic. A YALI Regional Leadership Center East Africa alumnus, he leverages his expertise in land governance and community mobilization to champion inclusive development and sustainable opportunities for African youth.
                </p>
              </div>
            </motion.div>

          </div>
        </div>
      </section>

      <footer className="py-10 border-t border-gray-100 dark:border-zinc-900 text-center text-sm text-gray-500 mt-auto">
        <p>&copy; 2026 Nexus AgriRise Africa. All rights reserved.</p>
      </footer>
    </div>
  );
}
