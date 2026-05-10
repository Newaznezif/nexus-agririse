"use client";

interface UploadProgressProps {
  progress: number;
  statusText: string;
}

export const UploadProgress = ({ progress, statusText }: UploadProgressProps) => {
  return (
    <div className="w-full mt-4">
      <div className="flex justify-between text-xs text-gray-500 mb-1">
        <span>{statusText}</span>
        <span>{progress}%</span>
      </div>
      <div className="w-full bg-gray-200 dark:bg-zinc-800 rounded-full h-2 overflow-hidden">
        <div 
          className="bg-emerald-600 h-2 rounded-full transition-all duration-300 ease-out" 
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
};
