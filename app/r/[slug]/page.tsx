import { cookies } from "next/headers";
import { RoomClient } from "@/src/components/room-client";

export default async function RoomPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params; const isOwner = Boolean((await cookies()).get(`blinkroom_owner_${slug}`));
  return <RoomClient slug={slug} isOwner={isOwner} />;
}
