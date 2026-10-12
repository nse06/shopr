import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { PublicBoardView } from "@/components/PublicBoard";
import { readBoard, summarize } from "@/lib/server/boards";
import { handleFrom } from "@/lib/server/sharing";
import { storageConfigured, store } from "@/lib/server/storage";

type Props = { params: Promise<{ handle: string }> };

// Read once per request, for both the page and its link preview.
const load = cache(async (raw: string) => {
  const handle = handleFrom(raw);
  if (!handle || !storageConfigured()) return { handle, board: null };
  try {
    return { handle, board: await readBoard(store(), handle) };
  } catch (e) {
    console.error("couldn't read board", handle, e);
    return { handle, board: null };
  }
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle, board } = await load((await params).handle);
  if (!board) return { title: handle ? `@${handle}` : "No board here" };
  const description = board.bio || board.profile?.headline || `${board.photos.length} photos on ${board.name}'s moodboard.`;
  const cover = summarize(board).cover.find((url) => url.startsWith("https://"));
  return {
    title: `${board.name} (@${board.handle})`,
    description,
    openGraph: { title: `${board.name}'s moodboard on shopr`, description, images: cover ? [cover] : undefined },
  };
}

export default async function Page({ params }: Props) {
  await connection();
  const { board } = await load((await params).handle);
  if (!board) notFound();
  return <PublicBoardView board={board} />;
}
