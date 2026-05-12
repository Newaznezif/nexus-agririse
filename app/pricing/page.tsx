import React from 'react';
import { Navbar } from '@/components/Navbar';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/Button';
import Link from 'next/link';

export default function PricingPage() {
  const tiers = [
    {
      name: "Starter",
      description: "For individual traders and small cooperatives.",
      price: "Free",
      features: [
        "Access to daily market prices",
        "Basic crop health data",
        "Weekly newsletter",
        "Community forum access"
      ],
      buttonText: "Get Started",
      popular: false
    },
    {
      name: "Professional",
      description: "For mid-sized agribusinesses and exporters.",
      price: "$49/mo",
      features: [
        "Real-time arbitrage alerts",
        "Advanced climate risk scoring",
        "Exportable PDF reports",
        "Email & chat support",
        "Access to AI insights"
      ],
      buttonText: "Start Free Trial",
      popular: true
    },
    {
      name: "Enterprise",
      description: "For large scale operations and policymakers.",
      price: "Custom",
      features: [
        "Full API access",
        "Dedicated account manager",
        "Custom data integrations",
        "SLA guarantee",
        "On-premise deployment options"
      ],
      buttonText: "Contact Sales",
      popular: false
    }
  ];

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-zinc-950">
      <Navbar />
      
      <div className="container mx-auto px-6 py-24">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 dark:text-white mb-6">
            Transparent Pricing for <span className="text-emerald-600 dark:text-emerald-500">Every Scale</span>
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            Choose the perfect plan to accelerate your agricultural intelligence and supply chain operations.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8 max-w-7xl mx-auto">
          {tiers.map((tier) => (
            <div 
              key={tier.name}
              className={`relative flex flex-col p-8 bg-white dark:bg-zinc-900 rounded-3xl border ${
                tier.popular 
                  ? 'border-emerald-500 shadow-2xl shadow-emerald-500/10 scale-105 z-10' 
                  : 'border-gray-200 dark:border-zinc-800 shadow-lg'
              }`}
            >
              {tier.popular && (
                <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gradient-to-r from-emerald-500 to-teal-500 text-white px-4 py-1 rounded-full text-sm font-semibold shadow-lg">
                  Most Popular
                </div>
              )}
              
              <div className="mb-8">
                <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">{tier.name}</h3>
                <p className="text-gray-500 dark:text-gray-400 text-sm h-10">{tier.description}</p>
              </div>
              
              <div className="mb-8 flex items-baseline text-gray-900 dark:text-white">
                <span className="text-5xl font-extrabold tracking-tight">{tier.price}</span>
              </div>
              
              <ul className="flex-1 space-y-4 mb-8">
                {tier.features.map((feature) => (
                  <li key={feature} className="flex items-start">
                    <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0 mr-3 mt-0.5" />
                    <span className="text-gray-600 dark:text-gray-300">{feature}</span>
                  </li>
                ))}
              </ul>
              
              <Link href={tier.name === "Enterprise" ? "/#contact" : "/signup"} className="w-full">
                <Button 
                  label={tier.buttonText}
                  variant={tier.popular ? 'primary' : 'outline'}
                  className="w-full justify-center py-4 rounded-xl text-lg"
                />
              </Link>
            </div>
          ))}
        </div>
      </div>

      <footer className="py-10 border-t border-gray-100 dark:border-zinc-900 text-center text-sm text-gray-500">
        <p>&copy; 2026 Nexus AgriRise Africa. All rights reserved.</p>
      </footer>
    </main>
  );
}
