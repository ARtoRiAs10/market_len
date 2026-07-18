import type { Metadata } from "next";
import { Fraunces, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Toaster } from "@/components/ui/toaster";
import { ThemeScript } from "@/components/theme-script";

const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", weight: ["400","500","600","700"], style: ["normal","italic"] });
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const jbMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jbmono" });

export const metadata: Metadata = {
  title: "MarketLens — Quarterly Financial Analysis & Strategy Backtesting",
  description: "Track company financials quarter over quarter and run institutional-grade fundamental analysis strategies.",
  metadataBase: new URL(process.env.NEXTAUTH_URL ?? "http://localhost:3000"),
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><ThemeScript /></head>
      <body className={`${fraunces.variable} ${inter.variable} ${jbMono.variable} font-sans antialiased`}>
        <Providers>{children}<Toaster /></Providers>
      </body>
    </html>
  );
}
