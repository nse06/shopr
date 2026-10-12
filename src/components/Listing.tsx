"use client";

import { formatPrice } from "@/lib/client/api";
import { useGo } from "@/lib/client/links";
import { toggleSaved, useApp } from "@/lib/client/store";
import type { ClickWhere, Listing } from "@/lib/types";
import { ArrowOut, Close, Heart } from "./icons";

function priceOf(l: Listing): string {
  return l.price != null ? formatPrice(l.price, l.currency) : "Price on site";
}

function SaveButton({ listing }: { listing: Listing }) {
  const { saved } = useApp();
  const on = saved.some((s) => s.id === listing.id);
  return (
    <button
      type="button"
      className={on ? "heart is-on" : "heart"}
      aria-pressed={on}
      aria-label={on ? `Saved: ${listing.title}` : `Save ${listing.title}`}
      onClick={() => toggleSaved(listing)}
    >
      <span>
        <Heart filled={on} size={16} />
      </span>
    </button>
  );
}

/** A small square on the home screen: photo, price and shop. */
export function ListingTile({ listing, onPass }: { listing: Listing; onPass?: () => void }) {
  const go = useGo();
  return (
    <div className="tile">
      <a className="tile-link" href={go(listing, "home")} target="_blank" rel="noopener" aria-label={`${listing.title}, ${priceOf(listing)} at ${listing.source}`}>
        {/* Listing photos come straight from eBay's and the shops' image servers. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={listing.thumb} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
        <span className="tile-meta">
          <b>{priceOf(listing)}</b>
          <span>{listing.source}</span>
        </span>
      </a>
      {onPass && (
        <button type="button" className="pass" aria-label={`Not for me: ${listing.title}`} title="Not for me" onClick={onPass}>
          <span>
            <Close size={14} />
          </span>
        </button>
      )}
      <SaveButton listing={listing} />
    </div>
  );
}

/** A bigger card for the More picks and Saved pages, with the listing's title. */
export function ListingCard({ listing, where, onMore, onPass }: { listing: Listing; where: ClickWhere; onMore?: () => void; onPass?: () => void }) {
  const go = useGo();
  const href = go(listing, where);
  const meta = [priceOf(listing), listing.source, listing.sizes.length ? `Size ${listing.sizes.join(" / ")}` : null].filter(Boolean);
  return (
    <article className="card">
      <div className="card-photo">
        <a href={href} target="_blank" rel="noopener" aria-label={`${listing.title} on ${listing.source}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={listing.image} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
        </a>
        <SaveButton listing={listing} />
      </div>
      <p className="card-meta">
        <b>{meta[0]}</b>
        {meta.slice(1).map((m) => (
          <span key={m}> · {m}</span>
        ))}
      </p>
      <h3 className="card-title">
        <a href={href} target="_blank" rel="noopener">
          {listing.title}
        </a>
      </h3>
      <div className="card-actions">
        {onMore && (
          <button type="button" className="text-btn" onClick={onMore}>
            More like this
          </button>
        )}
        {onPass && (
          <button type="button" className="text-btn" onClick={onPass}>
            Not for me
          </button>
        )}
        <a className="text-btn" href={href} target="_blank" rel="noopener">
          View <ArrowOut size={14} />
        </a>
      </div>
    </article>
  );
}

/** The commission note, shown wherever there are listing links once referral links are on. */
export function Disclosure() {
  const { status } = useApp();
  if (!status?.referrals) return null;
  return <p className="disclosure">When you buy through these links, shopr may earn a small commission. It doesn&apos;t change your price.</p>;
}
