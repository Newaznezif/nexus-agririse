"use client";
import React from 'react';
import { Mail, Phone, MapPin, Send } from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from '@/components/Button';
import { Footer } from '@/components/Footer';

export default function ContactPage() {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Logic for form submission would go here
    alert("Message sent! Our team will get back to you shortly.");
  };

  return (
    <main className="min-h-screen bg-zinc-950 text-white selection:bg-emerald-500/30">
      {/* ── HERO / INFO SECTION ── */}
      <section className="relative pt-32 pb-20 overflow-hidden">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-emerald-500/10 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-[120px] pointer-events-none" />
        
        <div className="container mx-auto px-6 relative z-10">
          <div className="max-w-3xl mx-auto text-center mb-16">
            <motion.h1 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-5xl md:text-7xl font-black mb-6 tracking-tight"
            >
              Get in <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-500 to-blue-500">Touch</span>
            </motion.h1>
            <motion.p 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="text-xl text-gray-400 leading-relaxed"
            >
              Ready to scale your agribusiness operations? Our team is here to help you unlock the power of data-driven intelligence.
            </motion.p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto mb-24">
            {[
              { icon: <Mail size={32} />, title: "Email Us", detail: "arusha@agririse.africa" },
              { icon: <Phone size={32} />, title: "Call Us", detail: "+251 900 000 000" },
              { icon: <MapPin size={32} />, title: "Headquarters", detail: "Addis Ababa, Ethiopia", sub: "Global reach" },
            ].map((card, index) => (
              <motion.div
                key={card.title}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 + index * 0.1 }}
                whileHover={{ y: -10 }}
                className="flex flex-col items-center justify-center p-10 bg-zinc-900/50 backdrop-blur-sm rounded-[2.5rem] border border-zinc-800 hover:border-emerald-500/30 transition-colors shadow-2xl relative overflow-hidden group"
              >
                <div className="absolute inset-0 bg-gradient-to-b from-emerald-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="w-16 h-16 bg-zinc-800 rounded-2xl flex items-center justify-center text-emerald-400 mb-6 shadow-inner relative z-10">
                  {card.icon}
                </div>
                <h3 className="text-xl font-bold mb-2 relative z-10">{card.title}</h3>
                <p className="text-gray-400 font-medium text-center relative z-10">
                  {card.detail}
                  {card.sub && <><br /><span className="text-sm text-zinc-500">{card.sub}</span></>}
                </p>
              </motion.div>
            ))}
          </div>

          {/* ── CONTACT FORM ── */}
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.5 }}
            className="max-w-4xl mx-auto bg-zinc-900/30 backdrop-blur-xl border border-zinc-800 rounded-[3rem] p-8 md:p-16 shadow-2xl relative"
          >
            <div className="absolute top-0 right-0 p-8 opacity-10">
              <Send size={120} className="text-emerald-500 -rotate-12" />
            </div>

            <form onSubmit={handleSubmit} className="relative z-10 space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-emerald-500 uppercase tracking-wider ml-1">Full Name</label>
                  <input 
                    required
                    type="text" 
                    placeholder="Enter your name" 
                    className="w-full bg-zinc-950/50 border border-zinc-800 rounded-2xl px-6 py-4 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500/50 transition-all text-white placeholder:text-zinc-600"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-emerald-500 uppercase tracking-wider ml-1">Email Address</label>
                  <input 
                    required
                    type="email" 
                    placeholder="name@company.com" 
                    className="w-full bg-zinc-950/50 border border-zinc-800 rounded-2xl px-6 py-4 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500/50 transition-all text-white placeholder:text-zinc-600"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold text-emerald-500 uppercase tracking-wider ml-1">Subject</label>
                <select className="w-full bg-zinc-950/50 border border-zinc-800 rounded-2xl px-6 py-4 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500/50 transition-all text-white appearance-none cursor-pointer">
                  <option>General Inquiry</option>
                  <option>Partnership Request</option>
                  <option>Technical Support</option>
                  <option>Sales Consultation</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold text-emerald-500 uppercase tracking-wider ml-1">Your Message</label>
                <textarea 
                  required
                  rows={5}
                  placeholder="Tell us about your agribusiness needs..." 
                  className="w-full bg-zinc-950/50 border border-zinc-800 rounded-2xl px-6 py-4 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500/50 transition-all text-white placeholder:text-zinc-600 resize-none"
                ></textarea>
              </div>

              <div className="pt-4">
                <Button 
                  label="Send Message" 
                  className="w-full md:w-auto px-12 py-5 text-lg font-bold rounded-2xl shadow-xl shadow-emerald-500/20"
                />
              </div>
            </form>
          </motion.div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
