import type { Metadata } from "next";

export const metadata: Metadata = { robots: { index: false, follow: false, googleBot: { index: false, follow: false, noimageindex: true } } };
export default function RoomLayout({ children }: Readonly<{ children: React.ReactNode }>) { return children; }
