import type { Metadata } from "next";
import { Inter, Noto_Sans_Ethiopic } from "next/font/google";
import "./globals.css";
import { Navbar } from "@/components/Navbar";
import { AuthProvider } from "@/hooks/useAuth";
import { DemoModeProvider } from "@/context/DemoModeContext";
import { Toaster } from "react-hot-toast";
import { ChatAssistant } from "@/components/ChatAssistant";

const inter = Inter({
  subsets: ["latin"],
});

const notoEthiopic = Noto_Sans_Ethiopic({
  subsets: ["ethiopic"],
  weight: ["400", "700"],
  variable: "--font-noto-ethiopic",
});

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
      <body className={`${inter.className} ${notoEthiopic.variable} min-h-screen flex flex-col antialiased`} suppressHydrationWarning>
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
