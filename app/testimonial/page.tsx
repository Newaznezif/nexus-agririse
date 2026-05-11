"use client";
import { motion } from "framer-motion";

export default function TestimonialPage() {
  return (
    <div className="flex flex-col bg-gray-50 dark:bg-black min-h-screen pt-20">
      <section className="py-24 container mx-auto px-6 flex-grow">
        <div className="text-center max-w-3xl mx-auto mb-20">
          <h1 className="text-5xl font-black mb-6 tracking-tight">Featured <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-600 to-blue-600">Spotlight</span></h1>
          <p className="text-xl text-gray-500 leading-relaxed">
            Stories from the visionaries and educators driving innovation across Africa.
          </p>
        </div>

        <motion.div 
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="bg-white dark:bg-zinc-900 rounded-[3rem] p-8 md:p-16 shadow-xl border border-gray-100 dark:border-zinc-800 flex flex-col lg:flex-row gap-16 items-center max-w-6xl mx-auto"
        >
          {/* Image Column */}
          <div className="w-full lg:w-1/3 flex-shrink-0 relative">
            <div className="aspect-[4/5] rounded-3xl overflow-hidden shadow-2xl relative border-4 border-white dark:border-zinc-800">
              {/* 
                NOTE: Please place the attached image in the 'public' folder 
                and name it 'jumanne.jpeg' to display it here.
              */}
              <img 
                src="/jumanne.jpeg" 
                alt="Jumanne Bakari Tungu"
                className="w-full h-full object-cover"
                onError={(e) => {
                  e.currentTarget.src = 'https://images.unsplash.com/photo-1506277886164-e25aa3f4ef7f?q=80&w=800&auto=format&fit=crop';
                }}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent flex items-end p-8">
                <div>
                  <p className="text-white font-bold text-2xl mb-1">Jumanne Bakari Tungu</p>
                  <p className="text-emerald-400 font-semibold text-sm tracking-wide uppercase">Educator & Fulbright Alumnus</p>
                </div>
              </div>
            </div>
            {/* Decorative elements */}
            <div className="absolute -top-8 -left-8 w-32 h-32 bg-emerald-100 dark:bg-emerald-900/20 rounded-full -z-10 blur-2xl"></div>
            <div className="absolute -bottom-8 -right-8 w-40 h-40 bg-blue-100 dark:bg-blue-900/20 rounded-full -z-10 blur-2xl"></div>
          </div>

          {/* Content Column */}
          <div className="w-full lg:w-2/3">
            <div className="mb-10">
              <span className="inline-block px-5 py-2 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 text-sm font-bold mb-6 uppercase tracking-widest border border-blue-100 dark:border-blue-900/30">
                Mwanza, Tanzania
              </span>
              <h2 className="text-4xl lg:text-5xl font-black text-gray-900 dark:text-white mb-8 leading-tight">
                Driving Educational Innovation and Youth Empowerment
              </h2>
            </div>
            
            <div className="prose prose-lg dark:prose-invert text-gray-600 dark:text-gray-400 max-w-none text-lg leading-relaxed space-y-6">
              <p>
                As a Tanzanian educator and Fulbright Alumnus, I've witnessed firsthand how technology transforms communities. Nexus AgriRise takes this to the next level by turning complex agricultural data into actionable intelligence.
              </p>
              <p>
                Their predictive insights do more than optimize agribusiness—they empower local farmers and foster an inclusive digital economy where our youth can truly thrive.
              </p>
              
              <blockquote className="relative p-8 mt-10 bg-emerald-50 dark:bg-emerald-900/10 rounded-2xl border-l-4 border-emerald-500 shadow-sm">
                <p className="text-xl italic text-gray-900 dark:text-gray-200 font-medium leading-relaxed relative z-10">
                  "Nexus AgriRise is a testament to the power of technology to transform lives. Their commitment to data-driven empowerment aligns perfectly with my passion for youth development and educational innovation. This platform is truly driving the future of Africa."
                </p>
              </blockquote>
            </div>
          </div>
        </motion.div>
      </section>

      <footer className="py-10 border-t border-gray-200 dark:border-zinc-900 text-center text-sm text-gray-500">
        <p>&copy; 2026 Nexus AgriRise Africa. All rights reserved.</p>
      </footer>
    </div>
  );
}
