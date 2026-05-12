import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/Button';
import Link from 'next/link';
import { Footer } from '@/components/Footer';

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
      buttonHref: "/signup",
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
      buttonHref: "/signup",
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
      buttonHref: "/contact",
      popular: false
    }
  ];

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-zinc-950">
      <div className="container mx-auto px-6 py-32">
        <div className="text-center max-w-4xl mx-auto mb-20">
          <h1 className="text-5xl md:text-7xl font-black text-gray-900 dark:text-white mb-8 tracking-tight">
            Transparent Pricing for <span className="text-emerald-600 dark:text-emerald-500">Every Scale</span>
          </h1>
          <p className="text-xl text-gray-600 dark:text-gray-400 leading-relaxed">
            Choose the perfect plan to accelerate your agricultural intelligence and supply chain operations.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-10 max-w-[90rem] mx-auto">
          {tiers.map((tier) => (
            <div 
              key={tier.name}
              className={`relative flex flex-col p-10 md:p-14 bg-white dark:bg-zinc-900 rounded-[3rem] border ${
                tier.popular 
                  ? 'border-emerald-500 shadow-2xl shadow-emerald-500/20 scale-105 z-10 ring-4 ring-emerald-500/5' 
                  : 'border-gray-200 dark:border-zinc-800 shadow-xl'
              } transition-all duration-500 hover:-translate-y-2`}
            >
              {tier.popular && (
                <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gradient-to-r from-emerald-500 to-teal-500 text-white px-6 py-2 rounded-full text-sm font-bold shadow-xl">
                  Most Popular
                </div>
              )}
              
              <div className="mb-10">
                <h3 className="text-3xl font-black text-gray-900 dark:text-white mb-3 tracking-tight">{tier.name}</h3>
                <p className="text-gray-500 dark:text-gray-400 text-base leading-relaxed h-12">{tier.description}</p>
              </div>
              
              <div className="mb-12 flex items-baseline text-gray-900 dark:text-white">
                <span className="text-6xl font-black tracking-tighter">{tier.price}</span>
                {tier.price.includes('/') && <span className="text-xl text-gray-400 ml-2 font-medium">/month</span>}
              </div>
              
              <ul className="flex-1 space-y-6 mb-12">
                {tier.features.map((feature) => (
                  <li key={feature} className="flex items-start">
                    <div className="bg-emerald-500/10 rounded-full p-1 mr-4 mt-0.5">
                      <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
                    </div>
                    <span className="text-gray-700 dark:text-gray-300 font-medium">{feature}</span>
                  </li>
                ))}
              </ul>
              
              <Link href={tier.buttonHref} className="w-full">
                <Button 
                  label={tier.buttonText}
                  variant={tier.popular ? 'primary' : 'outline'}
                  className="w-full justify-center py-6 rounded-2xl text-xl font-bold shadow-xl transition-all"
                />
              </Link>
            </div>
          ))}
        </div>
      </div>

      <Footer />
    </main>
  );
}
