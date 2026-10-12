import type { Metadata } from "next";
import { MorePicks } from "@/components/MorePicks";

export const metadata: Metadata = { title: "More picks" };

export default function Page() {
  return <MorePicks />;
}
