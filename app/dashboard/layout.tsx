import { Sidebar } from "@/components/Sidebar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex w-full">
      <Sidebar />
      <div className="flex-1 bg-zinc-50 dark:bg-black p-4 md:p-8 min-h-[calc(100vh-3.5rem)] overflow-auto">
        <div className="max-w-7xl mx-auto">
          {children}
        </div>
      </div>
    </div>
  );
}
