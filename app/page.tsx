"use client";
import { Button } from "@/components/Button";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-3.5rem)] bg-zinc-50 dark:bg-black px-4">
      <div className="text-center max-w-4xl mx-auto py-20">
        <h1 className="text-5xl font-extrabold tracking-tight sm:text-6xl text-gray-900 dark:text-white mb-6">
          Nexus AgriRise Africa
        </h1>
        <p className="text-xl text-blue-600 dark:text-blue-400 mb-8 font-medium">
          "AI-driven agribusiness intelligence system for Africa"
        </p>
        <p className="text-lg text-gray-500 dark:text-gray-400 mb-10 max-w-2xl mx-auto">
          We transform complex agricultural data into actionable business intelligence using cutting-edge AI. Make informed decisions, mitigate risks, and scale your operations with confidence.
        </p>
        
        <div className="flex justify-center mb-20">
          <Button 
            label="Go to Dashboard" 
            onClick={() => router.push('/dashboard')}
            className="text-lg px-8 py-3"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-left mt-10">
          <div className="bg-white dark:bg-zinc-900 p-8 rounded-xl shadow-sm border border-gray-100 dark:border-zinc-800">
            <h3 className="font-semibold text-lg mb-3">AI Market Intelligence</h3>
            <p className="text-gray-600 dark:text-gray-400 text-sm leading-relaxed">Predictive pricing and supply chain optimization using real-time local data.</p>
          </div>
          <div className="bg-white dark:bg-zinc-900 p-8 rounded-xl shadow-sm border border-gray-100 dark:border-zinc-800">
            <h3 className="font-semibold text-lg mb-3">Cross-border Trade</h3>
            <p className="text-gray-600 dark:text-gray-400 text-sm leading-relaxed">Seamless insights for cross-border logistics, tariffs, and regulatory compliance.</p>
          </div>
          <div className="bg-white dark:bg-zinc-900 p-8 rounded-xl shadow-sm border border-gray-100 dark:border-zinc-800">
            <h3 className="font-semibold text-lg mb-3">Data Analytics</h3>
            <p className="text-gray-600 dark:text-gray-400 text-sm leading-relaxed">Comprehensive dashboard for yield predictions and weather impact assessments.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
