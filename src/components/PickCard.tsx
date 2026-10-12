"use client";

import { formatPrice } from "@/lib/client/api";
import { toggleSaved, useApp } from "@/lib/client/store";
import type { Pick } from "@/lib/types";
import { ArrowOut } from "./icons";

export function PickCard({ pick, onMore, onRemove }: { pick: Pick; onMore?: () => void; onRemove?: () => void }) {
  const { saved } = useApp();
  const isSaved = saved.some((s) => s.id === pick.id);
  const meta = [pick.source, pick.price != null ? formatPrice(pick.price, pick.currency) : null, pick.sizes.length ? `Size ${pick.sizes.join(" / ")}` : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <article className="pick">
      <a className="pick-photo" href={pick.url} target="_blank" rel="noopener noreferrer" aria-label={`${pick.title} on ${pick.source}`}>
        {/* Listing photos come straight from eBay's and the shops' image servers. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={pick.image} alt={pick.title} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
      </a>
      <p className="pick-meta">{meta}</p>
      <h3 className="pick-title">
        <a href={pick.url} target="_blank" rel="noopener noreferrer">
          {pick.title}
        </a>
      </h3>
      {pick.why && <p className="pick-why">{pick.why}</p>}
      <div className="pick-actions">
        {onRemove ? (
          <button type="button" className="text-btn" onClick={onRemove}>
            Remove
          </button>
        ) : (
          <button type="button" className="text-btn" aria-pressed={isSaved} onClick={() => toggleSaved(pick)}>
            {isSaved ? "Saved" : "Save"}
          </button>
        )}
        {onMore && (
          <button type="button" className="text-btn" onClick={onMore}>
            More like this
          </button>
        )}
        <a className="text-btn" href={pick.url} target="_blank" rel="noopener noreferrer">
          View <ArrowOut size={14} />
        </a>
      </div>
    </article>
  );
}
