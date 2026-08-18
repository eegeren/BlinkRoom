import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });
export const metadata: Metadata = {
  metadataBase: new URL("https://blinkroom.org"),
  title: { default: "BlinkRoom — Instant Private File Sharing", template: "%s | BlinkRoom" },
  description: "Share files, images, text and links instantly in a temporary private room. No account or app required.",
  keywords: ["file sharing", "temporary file sharing", "instant file sharing", "private file sharing", "share files online", "send large files", "file transfer", "share files without account", "encrypted file sharing"],
  openGraph: { title: "BlinkRoom — Share Anything. Instantly.", description: "Create a temporary private room and share files, images, text and links instantly. No account required.", url: "https://blinkroom.org", siteName: "BlinkRoom", type: "website" },
  twitter: { card: "summary_large_image", title: "BlinkRoom — Share Anything. Instantly.", description: "Create a temporary private room and share files, images, text and links instantly. No account required." },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning><body className={`${sans.variable} ${mono.variable}`}>{children}</body></html>;
}
