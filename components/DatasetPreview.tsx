"use client";

interface DatasetPreviewProps {
  data: any[] | null;
  columns: string[];
  fileName: string;
}

export const DatasetPreview = ({ data, columns, fileName }: DatasetPreviewProps) => {
  if (!data || data.length === 0) {
    return (
      <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-100 dark:border-zinc-800 shadow-sm p-8 text-center text-gray-500 text-sm">
        No dataset uploaded yet
      </div>
    );
  }

  // Preview only first 5 rows
  const previewData = data.slice(0, 5);

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-100 dark:border-zinc-800 shadow-sm overflow-hidden flex flex-col h-full">
      <div className="px-6 py-4 border-b border-gray-100 dark:border-zinc-800 flex justify-between items-center">
        <h3 className="font-semibold text-lg">Dataset Preview</h3>
        <span className="text-xs text-gray-500 bg-gray-100 dark:bg-zinc-800 px-2 py-1 rounded">
          {fileName} ({data.length} rows)
        </span>
      </div>
      
      <div className="overflow-x-auto flex-1 p-0 m-0">
        <table className="w-full text-left text-sm text-gray-600 dark:text-gray-300">
          <thead className="bg-gray-50 dark:bg-zinc-950 text-gray-500 dark:text-gray-400 text-xs uppercase">
            <tr>
              {columns.map((col, index) => (
                <th key={index} className="px-6 py-3 font-medium whitespace-nowrap">{col}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
            {previewData.map((row, rowIndex) => (
              <tr key={rowIndex} className="hover:bg-gray-50 dark:hover:bg-zinc-800/50 transition-colors">
                {columns.map((col, colIndex) => (
                  <td key={colIndex} className="px-6 py-4 whitespace-nowrap max-w-[200px] truncate text-gray-900 dark:text-white">
                    {row[col] !== undefined ? String(row[col]) : ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {data.length > 5 && (
          <div className="text-center py-3 text-xs text-gray-500 bg-gray-50 dark:bg-zinc-950 border-t border-gray-100 dark:border-zinc-800">
            Showing first 5 rows of {data.length}
          </div>
        )}
      </div>
    </div>
  );
};
