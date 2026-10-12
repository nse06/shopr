import type { Metadata } from "next";
import { Moodboard } from "@/components/Moodboard";

export const metadata: Metadata = { title: "Moodboard" };

export default function Page() {
  return <Moodboard />;
}
