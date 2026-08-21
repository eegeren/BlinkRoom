import type { Metadata } from "next";
import { AnalyticsDashboard } from "@/src/components/analytics-dashboard";
export const metadata: Metadata = { title: "Analytics", robots: { index: false, follow: false } };
export default function AnalyticsPage() { return <AnalyticsDashboard />; }
