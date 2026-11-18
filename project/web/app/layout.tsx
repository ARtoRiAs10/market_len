import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Toaster } from "@/components/ui/toaster";
import { ThemeScript } from "@/components/theme-script";
import { getAppUrl } from "@/lib/env";

export const metadata: Metadata = {
  title: "MarketLens — Quarterly Financial Analysis & Strategy Backtesting",
  description: "Track company financials quarter over quarter and run institutional-grade fundamental analysis strategies.",
  metadataBase: new URL(getAppUrl()),
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><ThemeScript /></head>
      <body className="font-sans antialiased">
        <Providers>{children}<Toaster /></Providers>
      </body>
    </html>
  );
}
