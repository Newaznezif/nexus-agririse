"use client";

import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { UploadCard } from '@/components/UploadCard';
import { DatasetPreview } from '@/components/DatasetPreview';
import { Upload, FileText, CheckCircle2 } from 'lucide-react';
import toast from 'react-hot-toast';

export default function UploadPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [previewData, setPreviewData] = useState<any[] | null>(null);
  const [previewColumns, setPreviewColumns] = useState<string[]>([]);
  const [previewFileName, setPreviewFileName] = useState<string>('');

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  const handlePreviewReady = (data: any[], columns: string[], fileName: string) => {
    setPreviewData(data);
    setPreviewColumns(columns);
    setPreviewFileName(fileName);
  };

  const handleUploadComplete = () => {
    toast.success("Dataset uploaded and analyzed successfully!");
    setTimeout(() => {
      router.push('/dashboard');
    }, 2000);
  };

  if (loading) return <div className="p-8 animate-pulse bg-gray-100 dark:bg-zinc-800 rounded-xl h-64"></div>;
  if (!user) return null;

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      <header>
        <div className="flex items-center gap-2 mb-2">
          <Upload size={24} className="text-emerald-600" />
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">
            Upload Agricultural Intelligence
          </h1>
        </div>
        <p className="text-gray-500 dark:text-gray-400">
          Transform raw data into actionable agribusiness insights using our AI engine.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <UploadCard 
            onPreviewReady={handlePreviewReady} 
            onUploadComplete={handleUploadComplete} 
          />
        </div>

        <div className="space-y-6">
          <div className="bg-white dark:bg-zinc-900 p-6 rounded-xl border border-gray-100 dark:border-zinc-800 shadow-sm">
            <h3 className="font-semibold text-sm uppercase tracking-wider text-gray-500 mb-4">Upload Instructions</h3>
            <ul className="space-y-4">
              <li className="flex gap-3 text-sm">
                <div className="bg-emerald-50 dark:bg-emerald-900/20 p-1 rounded h-fit mt-0.5">
                  <FileText size={14} className="text-emerald-600" />
                </div>
                <span>Ensure your CSV has headers (e.g., Crop, Price, Yield, Market).</span>
              </li>
              <li className="flex gap-3 text-sm">
                <div className="bg-emerald-50 dark:bg-emerald-900/20 p-1 rounded h-fit mt-0.5">
                  <CheckCircle2 size={14} className="text-emerald-600" />
                </div>
                <span>Data should be related to African agribusiness markets for best AI results.</span>
              </li>
              <li className="flex gap-3 text-sm">
                <div className="bg-emerald-50 dark:bg-emerald-900/20 p-1 rounded h-fit mt-0.5">
                  <Upload size={14} className="text-emerald-600" />
                </div>
                <span>Maximum file size is 10MB. AI analysis processes up to 50 rows.</span>
              </li>
            </ul>
          </div>
        </div>
      </div>

      {previewData && (
        <section className="animate-in fade-in slide-in-from-bottom-4 duration-500">
          <DatasetPreview 
            data={previewData} 
            columns={previewColumns} 
            fileName={previewFileName} 
          />
        </section>
      )}
    </div>
  );
}
