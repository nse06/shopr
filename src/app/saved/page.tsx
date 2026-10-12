import type { Metadata } from "next";
import { Saved } from "@/components/Saved";

export const metadata: Metadata = { title: "Saved" };

export default function Page() {
  return <Saved />;
}
