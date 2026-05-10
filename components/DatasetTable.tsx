"use client";

interface DatasetTableProps {
  datasets: any[];
}

export const DatasetTable = ({ datasets }: DatasetTableProps) => {

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-100 dark:border-zinc-800 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 dark:border-zinc-800">
        <h3 className="font-semibold text-lg">Recent Datasets</h3>
      </div>
      
      {datasets.length === 0 ? (
        <div className="p-8 text-center text-sm text-gray-500">
          No datasets uploaded yet
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-gray-600 dark:text-gray-300">
            <thead className="bg-gray-50 dark:bg-zinc-950 text-gray-500 dark:text-gray-400 text-xs uppercase">
              <tr>
                <th className="px-6 py-3 font-medium">Dataset Name</th>
                <th className="px-6 py-3 font-medium">Country</th>
                <th className="px-6 py-3 font-medium">Type</th>
                <th className="px-6 py-3 font-medium">Upload Date</th>
                <th className="px-6 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
              {datasets.map((ds) => {
                const date = ds.created_at ? new Date(ds.created_at).toLocaleDateString() : 'Unknown';
                const status = 'Processed'; // Defaulting to processed once it's in the DB for MVP
                
                return (
                <tr key={ds.id} className="hover:bg-gray-50 dark:hover:bg-zinc-800/50 transition-colors">
                  <td className="px-6 py-4 font-medium text-gray-900 dark:text-white">{ds.name}</td>
                  <td className="px-6 py-4">{ds.country || 'Global'}</td>
                  <td className="px-6 py-4">{ds.type || 'CSV'}</td>
                  <td className="px-6 py-4">{date}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400`}>
                      {status}
                    </span>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
