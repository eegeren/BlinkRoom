import type { Metadata } from "next";
import { PreparingRoom } from "@/src/components/preparing-room";

export const metadata: Metadata = { title: "Preparing your room", robots: { index: false, follow: false } };
export default function Page() { return <PreparingRoom />; }
