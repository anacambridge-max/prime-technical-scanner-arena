import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Prime Technical Live Scanner — PDH/PDL Intraday",
  description:
    "Real-time 5-minute intraday scanner for the NIFTY 500 universe. PDH/PDL breakouts with volume, 20 EMA and follow-through confirmation.",
};

export const viewport: Viewport = {
  themeColor: "#04070d",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="terminal-bg min-h-screen antialiased">{children}</body>
    </html>
  );
}
