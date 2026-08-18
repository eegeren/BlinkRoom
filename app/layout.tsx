import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/src/components/theme-provider";
import { PwaRegistration } from "@/src/components/pwa-registration";
import { AnalyticsProvider } from "@/src/components/analytics-provider";

const sans = Geist({ subsets: ["latin"], variable: "--font-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });
export const metadata: Metadata = {
  metadataBase: new URL("https://blinkroom.org"),
  title: {
    default: "BlinkRoom — Instant Private File Sharing",
    template: "%s | BlinkRoom",
  },
  description:
    "Share files, images, text and links instantly in a temporary private room. No account or app required.",
  keywords: [
    "file sharing",
    "temporary file sharing",
    "instant file sharing",
    "private file sharing",
    "share files online",
    "send large files",
    "file transfer",
    "share files without account",
    "encrypted file sharing",
  ],
  openGraph: {
    title: "BlinkRoom — Share Anything. Instantly.",
    description:
      "Create a temporary private room and share files, images, text and links instantly. No account required.",
    url: "https://blinkroom.org",
    siteName: "BlinkRoom",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "BlinkRoom — Share Anything. Instantly.",
    description:
      "Create a temporary private room and share files, images, text and links instantly. No account required.",
  },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const themeScript = `(function(){try{var t=localStorage.getItem('blinkroom-theme');if(t!=='light'&&t!=='dark')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.classList.toggle('dark',t==='dark');document.documentElement.style.colorScheme=t}catch(e){}})()`;
  const measurementId = process.env.NODE_ENV === "production" ? process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID : undefined;
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className={`${sans.variable} ${mono.variable}`}>
        <ThemeProvider>
          {children}
          <PwaRegistration />
          <AnalyticsProvider measurementId={measurementId} />
        </ThemeProvider>
      </body>
    </html>
  );
}
