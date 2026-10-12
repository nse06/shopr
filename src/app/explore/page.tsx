import type { Metadata } from "next";
import { Explore } from "@/components/Explore";

export const metadata: Metadata = { title: "Explore boards" };

export default function Page() {
  return <Explore />;
}
