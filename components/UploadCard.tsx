"use client";

import { useState, useRef } from 'react';
import { Button } from './Button';
import { UploadCloud } from 'lucide-react';
import { parseCSV } from '@/services/csvParser';
import { uploadFile } from '@/services/storage';
import { saveDataset } from '@/services/database';
import { useAuth } from '@/hooks/useAuth';
import { UploadProgress } from './UploadProgress';

interface UploadCardProps {
  onPreviewReady: (data: any[], columns: string[], fileName: string) => void;
  onUploadComplete: () => void;
}

export const UploadCard = ({ onPreviewReady, onUploadComplete }: UploadCardProps) => {
  const { user } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('');
  const [success, setSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

  const handleFileSelect = async (selectedFile: File | null) => {
    setError(null);
    setSuccess(false);
    setProgress(0);
    setFile(null);

    if (!selectedFile) return;

    // Validate type
    if (!selectedFile.name.endsWith('.csv') && selectedFile.type !== 'text/csv') {
      setError('Invalid file type. Please upload a .csv file.');
      return;
    }

    // Validate size
    if (selectedFile.size > MAX_FILE_SIZE) {
      setError('File exceeds allowed size limit (10MB).');
      return;
    }

    if (selectedFile.size === 0) {
      setError('File is empty.');
      return;
    }

    setFile(selectedFile);
    setStatusText('Parsing CSV...');
    setProgress(20);

    // Parse CSV for preview
    const { data, error: parseError, columns } = await parseCSV(selectedFile);
    
    if (parseError || !data) {
      setError(`Parsing failure: ${parseError}`);
      setFile(null);
      return;
    }

    setProgress(50);
    setStatusText('Preview ready. Click Upload Dataset to save.');
    onPreviewReady(data, columns, selectedFile.name);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    handleFileSelect(droppedFile);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleUpload = async () => {
    if (!file || !user) return;

    setLoading(true);
    setError(null);
    setProgress(60);
    setStatusText('Uploading to storage...');

    try {
      // 1. Upload to Storage
      const { url, error: uploadError } = await uploadFile(user.id, file);
      
      if (uploadError || !url) {
        throw new Error(`Storage upload failed: ${uploadError?.message}`);
      }

      // 2. Save Metadata to DB
      const { data: dbData, error: dbError } = await saveDataset({
        userId: user.id,
        name: file.name,
        type: 'csv',
        fileUrl: url,
        country: 'Global'
      });

      if (dbError) {
        throw new Error(`Database save failed: ${dbError}`);
      }

      setProgress(90);
      setStatusText('Analyzing data with AI...');

      // 3. Trigger AI Analysis
      const { data: fullData } = await parseCSV(file);
      
      const aiResponse = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataset: fullData,
          userId: user.id,
          datasetId: dbData?.id || null
        })
      });

      if (!aiResponse.ok) {
        throw new Error('AI analysis failed. Your dataset is uploaded, but insights could not be generated.');
      }

      setProgress(100);
      setStatusText('Upload and analysis complete!');
      setSuccess(true);
      onUploadComplete();
      
      // Reset after 3 seconds
      setTimeout(() => {
        setFile(null);
        setSuccess(false);
        setProgress(0);
      }, 3000);

    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred during upload.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white dark:bg-zinc-900 p-6 rounded-xl border border-gray-100 dark:border-zinc-800 shadow-sm flex flex-col">
      <h3 className="font-semibold text-lg mb-2">Upload Agricultural Dataset</h3>
      <p className="text-sm text-gray-500 mb-6">Upload CSV or structured agricultural data for AI analysis.</p>
      
      <div 
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-lg p-10 flex flex-col items-center justify-center text-center transition-colors cursor-pointer mb-4 flex-1
          ${file ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-900/10' : 'border-gray-200 dark:border-zinc-700 hover:bg-gray-50 dark:hover:bg-zinc-800/50'}`}
      >
        <UploadCloud className={`${file ? 'text-emerald-500' : 'text-gray-400'} mb-3`} size={32} />
        <p className="font-medium text-sm">
          {file ? file.name : "Drag & drop zone or click to select"}
        </p>
        <p className="text-xs text-gray-400 mt-1">
          {file ? `${(file.size / 1024).toFixed(1)} KB` : "Supported formats: CSV only (Max 10MB)"}
        </p>
      </div>

      <input 
        type="file" 
        className="hidden" 
        accept=".csv" 
        ref={fileInputRef}
        onChange={(e) => handleFileSelect(e.target.files?.[0] || null)}
      />

      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400 text-sm rounded-md border border-red-100 dark:border-red-800">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-4 p-3 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400 text-sm rounded-md border border-emerald-100 dark:border-emerald-800">
          Dataset uploaded successfully!
        </div>
      )}

      {(progress > 0 && !success && !error) && (
        <div className="mb-4">
          <UploadProgress progress={progress} statusText={statusText} />
        </div>
      )}

      <div className="flex justify-between items-center mt-auto">
        <label 
          className="text-sm text-blue-600 hover:underline cursor-pointer"
          onClick={() => fileInputRef.current?.click()}
        >
          Choose CSV File
        </label>
        <Button 
          label={loading ? "Uploading..." : "Upload Dataset"} 
          onClick={handleUpload} 
          disabled={!file || loading || success}
          className="bg-emerald-600 hover:bg-emerald-700 focus:ring-emerald-500"
        />
      </div>
    </div>
  );
};
