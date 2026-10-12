import Link from "next/link";

export default function NotFound() {
  return (
    <main className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">Moodboard</p>
          <h1 className="display display--page">No board here</h1>
          <p className="lede">It may have been taken down, or the handle is spelled a little differently.</p>
        </div>
      </header>
      <Link href="/explore" className="btn btn--ghost">
        Explore other boards
      </Link>
    </main>
  );
}
