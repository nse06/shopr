import type { Metadata } from "next";
import { DropTest } from "@/components/DropTest";

export const metadata: Metadata = { title: "Drop test" };

export default function Page() {
  return <DropTest />;
}
