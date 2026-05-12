"use client";
import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageCircle, X, Send, Bot, User, Sparkles } from 'lucide-react';

interface Message {
  id: string;
  text: string;
  sender: 'bot' | 'user';
  timestamp: Date;
}

export const ChatAssistant = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      text: "Hello! I am NEXUS ASSISTANT. How can I help you with African Agribusiness intelligence today?",
      sender: 'bot',
      timestamp: new Date(),
    }
  ]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Show on scroll
  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 400) {
        setIsVisible(true);
      } else if (!isOpen) {
        setIsVisible(false);
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [isOpen]);

  // Auto scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isOpen]);

  const handleSend = () => {
    if (!input.trim()) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      text: input,
      sender: 'user',
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');

    // Mock Bot Response
    setTimeout(() => {
      const botMsg: Message = {
        id: (Date.now() + 1).toString(),
        text: getBotResponse(input),
        sender: 'bot',
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, botMsg]);
    }, 1000);
  };

  const getBotResponse = (query: string) => {
    const q = query.toLowerCase();
    
    // SPECIFIC PEOPLE (High Priority)
    if (q.includes('newaz')) {
      return "Newaz Nezif Abagero is our Co-Founder & Lead AI Architect. Based in Addis Ababa, he is a Cybersecurity Analyst at FDRE INSA and a Full-Stack Developer (10 Academy Mastery Graduate). He builds our secure API integrations and AI foundations using Python, PyTorch, and TensorFlow.";
    }
    if (q.includes('augustin')) {
      return "Augustin Nkundimana is our Founder & CEO. He is a Kigali-based Agritech Engineer, AI Entrepreneur, and 2025 Mandela Washington Fellow. He specializes in precision agriculture and has developed solutions like offline crop disease detection and tractor-sharing marketplaces.";
    }

    // HOW TO USE / STARTING / STEPS
    if (q.includes('how to use') || q.includes('how can i use') || q.includes('how can i sue') || q.includes('get started') || q.includes('start') || q.includes('steps')) {
      return "You can use Nexus AgriRise in 4 easy steps: 1. COLLECT (we aggregate real-time data), 2. ANALYZE (our Gemini AI processes the data), 3. VISUALIZE (you view interactive maps and charts), and 4. ACT (you make strategic decisions). Click 'Get Start here' to begin!";
    }

    // WHAT IS IN IT / FEATURES / CAPABILITIES
    if (q.includes('what is in it') || q.includes('features') || q.includes('what do you do') || q.includes('capabilities') || q.includes('engine')) {
      return "The platform features: 📊 Real-time commodity tracking, 🛡️ Climate risk scoring, 🧠 Gemini AI Engine, 📉 Arbitrage alerts, and 📄 Exportable reports. We are YALI affiliated and Supabase secured, providing open-source intelligence for African growth.";
    }

    // STATS / NUMBERS
    if (q.includes('markets') || q.includes('countries') || q.includes('covered') || q.includes('stats') || q.includes('numbers')) {
      return "Current Stats: 🌍 14+ African Markets Covered, 💡 4 AI Insight Categories, ⚡ < 30s Average Analysis Time, and 🔒 100% Data Privacy Guaranteed.";
    }

    // SPECIFIC MARKET INSIGHTS
    if (q.includes('ethiopia') || q.includes('coffee')) {
      return "In Ethiopia, we track Yirgacheffe Grade 1 Coffee, which commands 40–65% premiums. We help improve farmer income retention through direct-trade route insights.";
    }
    if (q.includes('rwanda') || q.includes('beans')) {
      return "In Rwanda, we track Bean prices, which are stable at USD 920/MT. We highlight opportunities for EU organic certification in the Northern Province.";
    }
    if (q.includes('car') || q.includes('maize')) {
      return "In the Central African Republic (CAR), we track Maize supply gaps (~180K MT) and identify cross-border arbitrage opportunities to stabilize local prices.";
    }

    // MOTTO / VISION / MISSION
    if (q.includes('motto') || q.includes('quote') || q.includes('vision') || q.includes('mission')) {
      return "Our motto is: 'Africa does not lack food, it lacks intelligence in its food systems.' Our mission is to build the digital infrastructure for African agriculture through visionary AI.";
    }

    // PRICING
    if (q.includes('price') || q.includes('cost') || q.includes('pricing') || q.includes('free')) {
      return "We have 3 plans: 1. Starter (Free) for individuals, 2. Professional ($49/mo) for mid-sized agribusinesses, and 3. Enterprise (Custom) for large-scale operations. See the Pricing page for features!";
    }

    // CONTACT / REACH OUT
    if (q.includes('contact') || q.includes('support') || q.includes('email') || q.includes('phone') || q.includes('address')) {
      return "Reach us at arusha@agririse.africa, call +251 900 000 000, or visit our headquarters in Addis Ababa, Ethiopia. You can also use the Contact form on our website.";
    }

    return "I'm NEXUS ASSISTANT! I have full knowledge of our platform's market data (Ethiopia, Rwanda, CAR), our AI engine (Gemini), our leadership (Augustin & Newaz), and how to get started. What can I help you with?";
  };

  return (
    <>
      {/* Floating Toggle Button */}
      <AnimatePresence>
        {isVisible && (
          <motion.button
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={() => setIsOpen(!isOpen)}
            className="fixed bottom-8 right-8 z-[60] w-16 h-16 bg-emerald-600 text-white rounded-full shadow-2xl flex items-center justify-center border-4 border-white dark:border-zinc-900 overflow-hidden group"
          >
            <div className="absolute inset-0 bg-gradient-to-tr from-emerald-600 to-teal-400 group-hover:rotate-12 transition-transform duration-500" />
            {isOpen ? <X className="relative z-10 w-8 h-8" /> : <MessageCircle className="relative z-10 w-8 h-8" />}
          </motion.button>
        )}
      </AnimatePresence>

      {/* Chat Window */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ y: 100, opacity: 0, scale: 0.9 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 100, opacity: 0, scale: 0.9 }}
            className="fixed bottom-28 right-8 z-[60] w-[90vw] md:w-[400px] h-[500px] bg-white dark:bg-zinc-900 rounded-[2rem] shadow-[0_20px_50px_rgba(0,0,0,0.3)] border border-gray-100 dark:border-zinc-800 flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="bg-emerald-600 p-6 flex items-center justify-between">
              <div className="flex items-center gap-3 text-white">
                <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center backdrop-blur-md">
                  <Sparkles size={20} className="text-emerald-100" />
                </div>
                <div>
                  <h3 className="font-black text-sm uppercase tracking-widest">NEXUS ASSISTANT</h3>
                  <p className="text-[10px] text-emerald-100 opacity-80 uppercase font-bold">Online | AI Powered</p>
                </div>
              </div>
              <button onClick={() => setIsOpen(false)} className="text-white/80 hover:text-white transition-colors">
                <X size={20} />
              </button>
            </div>

            {/* Messages Area */}
            <div 
              ref={scrollRef}
              className="flex-1 overflow-y-auto p-6 space-y-4 bg-gray-50/50 dark:bg-black/20"
            >
              {messages.map((msg) => (
                <div 
                  key={msg.id} 
                  className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div className={`max-w-[80%] p-4 rounded-2xl text-sm ${
                    msg.sender === 'user' 
                      ? 'bg-emerald-600 text-white rounded-tr-none shadow-lg' 
                      : 'bg-white dark:bg-zinc-800 text-gray-800 dark:text-gray-200 rounded-tl-none border border-gray-100 dark:border-zinc-700 shadow-sm'
                  }`}>
                    {msg.text}
                  </div>
                </div>
              ))}
            </div>

            {/* Input Area */}
            <div className="p-4 bg-white dark:bg-zinc-900 border-t border-gray-100 dark:border-zinc-800">
              <div className="relative flex items-center">
                <input 
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                  placeholder="Ask NEXUS anything..."
                  className="w-full bg-gray-100 dark:bg-zinc-800 rounded-xl px-4 py-3 pr-12 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 text-sm"
                />
                <button 
                  onClick={handleSend}
                  className="absolute right-2 p-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors shadow-lg"
                >
                  <Send size={16} />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
