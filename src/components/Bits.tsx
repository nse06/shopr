"use client";

import { useEffect, useState } from "react";
import type { Department } from "@/lib/types";

/** The progress line while the stylist works: what it's doing and for how long. */
export function Thinking({ status, notices, startedAt }: { status: string; notices: string[]; startedAt: number }) {
  const [now, setNow] = useState(startedAt);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const seconds = Math.max(0, Math.round((now - startedAt) / 1000));
  return (
    <div className="thinking-block">
      <p className="thinking" aria-live="polite">
        <span>{status}</span>
        <span className="elapsed">{seconds}s</span>
      </p>
      {notices.map((n) => (
        <p key={n} className="notice-line">
          {n}
        </p>
      ))}
    </div>
  );
}

const SITES: { name: string; url: (q: string, d: Department) => string }[] = [
  { name: "Grailed", url: (q) => `https://www.grailed.com/shop?query=${encodeURIComponent(q)}` },
  { name: "Depop", url: (q) => `https://www.depop.com/search/?q=${encodeURIComponent(q)}` },
  {
    name: "Poshmark",
    url: (q, d) => `https://poshmark.com/search?query=${encodeURIComponent(q)}${d === "men" ? "&department=Men" : d === "women" ? "&department=Women" : ""}`,
  },
  { name: "Vinted", url: (q) => `https://www.vinted.com/catalog?search_text=${encodeURIComponent(q)}` },
  { name: "eBay", url: (q) => `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}` },
];

/** Links to the same search on sites shopr can't search itself. */
export function Elsewhere({ query, department }: { query: string; department: Department }) {
  return (
    <p className="elsewhere">
      Try “{query}” on{" "}
      {SITES.map((site, i) => (
        <span key={site.name}>
          <a href={site.url(query, department)} target="_blank" rel="noopener noreferrer">
            {site.name}
          </a>
          {i < SITES.length - 2 ? ", " : i === SITES.length - 2 ? " or " : ""}
        </span>
      ))}
      .
    </p>
  );
}

export function ago(at: number, now = Date.now()): string {
  const minutes = Math.round((now - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  if (hours < 48) return "yesterday";
  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** What the current picks are for, in a few words. */
export function requestLabel(request: string | null): string {
  if (!request) return "From your board";
  const short = (t: string) => (t.length > 44 ? `${t.slice(0, 42).trimEnd()}…` : t);
  const like = request.match(/^More like this: (.+)$/);
  return like ? `More like “${short(like[1])}”` : `For “${short(request)}”`;
}
