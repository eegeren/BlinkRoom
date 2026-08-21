import { HowToUsePage } from "@/src/components/how-to-use-page";
import { seoMetadata } from "@/src/lib/seo";

export const metadata = seoMetadata(
  "/how-to-use",
  "How to Use BlinkRoom",
  "Learn how to create temporary rooms, upload files, choose room settings and share files with BlinkRoom.",
);

export default function Page() {
  return <HowToUsePage />;
}
