import type { Metadata } from "next";
import "./globals.css";
import { Navbar } from "@/components/Navbar";
import { AuthProvider } from "@/hooks/useAuth";
import { DemoModeProvider } from "@/context/DemoModeContext";
import { Toaster } from "react-hot-toast";
import { ChatAssistant } from "@/components/ChatAssistant";
import { FontPreload } from "@/components/FontPreload";

export const metadata: Metadata = {
  title: "Nexus AgriRise Africa",
  description: "AI-driven agribusiness intelligence system for Africa",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="app-font min-h-screen flex flex-col antialiased" suppressHydrationWarning>
        <FontPreload />
        <DemoModeProvider>
          <Toaster position="top-right" />
          <AuthProvider>
            <Navbar />
            <main className="flex-1">
              {children}
            </main>
            <ChatAssistant />
          </AuthProvider>
        </DemoModeProvider>
      </body>
    </html>
  );
}
