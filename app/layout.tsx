import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { brand } from "@/src/config/brand";

const sans = Geist({ subsets: ["latin"], variable: "--font-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });
export const metadata: Metadata = { title: `${brand.name} — Share anything. Instantly.`, description: brand.tagline };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning><body className={`${sans.variable} ${mono.variable}`}>{children}</body></html>;
}
