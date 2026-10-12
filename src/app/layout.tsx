import type { Metadata, Viewport } from "next";
import { Figtree, Fraunces } from "next/font/google";
import { Shell } from "@/components/Shell";
import "./globals.css";

// A soft, slightly wonky serif for headings and a friendly sans for everything else.
const display = Fraunces({ subsets: ["latin"], axes: ["SOFT", "WONK", "opsz"], variable: "--font-display", display: "swap" });
const sans = Figtree({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = {
  title: { default: "shopr · your personal AI stylist", template: "%s · shopr" },
  description: "Pin what you love. Your AI stylist searches Depop, eBay and independent vintage shops for pieces that fit your taste.",
  applicationName: "shopr",
  appleWebApp: { capable: true, title: "shopr", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable}`}>
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
