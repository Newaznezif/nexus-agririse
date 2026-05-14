"use client";
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export const AfricaMap = () => {
  const [hovered, setHovered] = useState<string | null>(null);

  // High-fidelity country data with flags and calibration
  const highlights = [
    {
      id: 'ethiopia',
      name: 'Ethiopia',
      color: '#10b981',
      flag: 'https://flagcdn.com/w80/et.png',
      x: '80%', y: '40%'
    },
    {
      id: 'rwanda',
      name: 'Rwanda',
      color: '#3b82f6',
      flag: 'https://flagcdn.com/w80/rw.png',
      x: '64%', y: '62%'
    },
    {
      id: 'car',
      name: 'Central African Republic',
      color: '#f59e0b',
      flag: 'https://flagcdn.com/w80/cf.png',
      x: '53%', y: '42%'


    }
  ];

  return (
    <div className="relative w-full max-w-lg mx-auto aspect-square flex items-center justify-center overflow-visible">
      {/* 1. TECHNICAL GRID BACKGROUND */}
      <div className="absolute inset-0 opacity-10 pointer-events-none -z-10">
        <svg width="100%" height="100%">
          <pattern id="dotGrid" width="40" height="40" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="2" r="1" fill="currentColor" className="text-emerald-500" />
          </pattern>
          <rect width="100%" height="100%" fill="url(#dotGrid)" />
        </svg>
      </div>

      {/* 2. DETAILED AFRICA MAP WITH BORDERS (Using a high-fidelity image or styled SVG) */}
      {/* For the hackathon "WOW" factor, we use a beautifully styled background map */}
      <div className="relative w-full h-full flex items-center justify-center select-none">
        <img
          src="https://upload.wikimedia.org/wikipedia/commons/6/66/Blank_Map-Africa.svg"
          alt="Africa Borders"
          className="w-full h-full object-contain opacity-30 dark:opacity-20 invert dark:invert-0 transition-opacity duration-700"
          style={{ filter: 'drop-shadow(0 0 20px rgba(16, 185, 129, 0.2))' }}
        />

        {/* Scanning Line */}
        <motion.div
          animate={{ y: ['0%', '100%', '0%'] }}
          transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
          className="absolute left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-emerald-500/40 to-transparent z-10 pointer-events-none"
        />
      </div>

      {/* 3. INTERACTIVE FLAG NODES */}
      <div className="absolute inset-0 z-20 pointer-events-none">
        {highlights.map((country) => (
          <div
            key={country.id}
            className="absolute transform -translate-x-1/2 -translate-y-1/2 pointer-events-auto group/node"
            style={{ left: country.x, top: country.y }}
            onMouseEnter={() => setHovered(country.name)}
            onMouseLeave={() => setHovered(null)}
          >
            {/* Animated Pulsing Ring */}
            <motion.div
              animate={{ scale: [1, 1.8, 1], opacity: [0.6, 0, 0.6] }}
              transition={{ duration: 2.5, repeat: Infinity }}
              className="absolute inset-0 w-16 h-16 -ml-8 -mt-8 rounded-full border-2 border-dashed"
              style={{ borderColor: country.color }}
            />

            {/* Circled Flag */}
            <motion.div
              whileHover={{ scale: 1.2, rotate: 5 }}
              className="relative w-12 h-12 rounded-full border-4 shadow-2xl overflow-hidden bg-white dark:bg-zinc-900 transition-all duration-300"
              style={{ borderColor: country.color }}
            >
              <img
                src={country.flag}
                alt={country.name}
                className="w-full h-full object-cover scale-110"
              />
              {/* Overlay for premium look */}
              <div className="absolute inset-0 bg-gradient-to-tr from-black/20 to-transparent" />
            </motion.div>

            {/* Country Tooltip Label */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="absolute top-14 left-1/2 -translate-x-1/2 whitespace-nowrap"
            >
              <span className="text-[11px] font-black tracking-tighter px-3 py-1 rounded-full bg-white dark:bg-zinc-900 text-gray-900 dark:text-white border border-gray-200 dark:border-zinc-800 shadow-lg shadow-black/5">
                {country.name}
              </span>
            </motion.div>
          </div>
        ))}
      </div>

      {/* 4. PREMIUM INFO PANEL */}
      <AnimatePresence>
        {hovered && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 30 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="absolute -bottom-16 left-0 right-0 mx-auto w-max z-30 px-8 py-4 rounded-3xl bg-white/95 dark:bg-zinc-950/95 backdrop-blur-2xl border-2 border-emerald-500/20 shadow-[0_20px_50px_rgba(0,0,0,0.3)] flex items-center gap-6"
          >
            <div className="relative">
              <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
                <div className="w-3 h-3 rounded-full bg-emerald-500 animate-ping" />
              </div>
            </div>
            <div>
              <p className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-[0.2em] mb-1">Nexus Intelligence Node</p>
              <p className="text-xl font-black text-gray-900 dark:text-white">{hovered}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Background Atmosphere */}
      <div className="absolute inset-0 -z-20">
        <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/10 rounded-full blur-[120px] animate-pulse" />
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-blue-500/10 rounded-full blur-[120px] animate-pulse delay-1000" />
      </div>
    </div>
  );
};
