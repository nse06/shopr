"use client";

import Link from "next/link";
import { useState } from "react";
import { publishBoard, shareSignature, unpublishBoard } from "@/lib/client/sharing";
import { setState, useApp } from "@/lib/client/store";

function withScheme(link: string): string {
  const l = link.trim();
  return !l || /^https?:\/\//i.test(l) ? l : `https://${l}`;
}

/** Whether your board is shared, and if so whether the shared copy is behind it. */
export function useShareState(): "none" | "current" | "behind" {
  const { publish, board, profile } = useApp();
  if (!publish?.handle || !publish.publishedAt) return "none";
  return publish.signature === shareSignature(publish, board, profile?.at ?? null) ? "current" : "behind";
}

/** Put your board on Explore, keep it up to date, or take it down. */
export function SharePanel({ onClose }: { onClose: () => void }) {
  const { publish, publishing, publishError, board, status } = useApp();
  const state = useShareState();
  const [handle, setHandle] = useState(publish?.handle ?? "");
  const [name, setName] = useState(publish?.name ?? "");
  const [bio, setBio] = useState(publish?.bio ?? "");
  const [link, setLink] = useState(publish?.link ?? "");
  const [editing, setEditing] = useState(false);
  const [confirmDown, setConfirmDown] = useState(false);
  const [copied, setCopied] = useState(false);

  if (status && !status.sharing) {
    return (
      <section className="share" aria-label="Share your board">
        <h2 className="section-title">Share your board</h2>
        <p className="muted">
          Sharing isn&apos;t set up on this shopr yet. In Vercel, open your project, then Storage, create a Blob store and connect it to the
          project. Redeploy, and this will work.
        </p>
        <button type="button" className="text-btn" onClick={onClose}>
          Close
        </button>
      </section>
    );
  }

  const live = state !== "none" ? (publish?.handle ?? null) : null;
  const url = live ? `${window.location.origin}/u/${live}` : "";
  const claimed = publish?.handle ?? null;
  const cleanHandle = (claimed ?? handle).trim().replace(/^@/, "");
  const ready = Boolean(cleanHandle) && board.length > 0 && !publishing;

  async function submit() {
    const ok = await publishBoard({ handle: cleanHandle, name: name.trim() || cleanHandle, bio, link: withScheme(link) });
    if (ok) setEditing(false);
  }

  async function copyLink() {
    try {
      if (navigator.share && window.matchMedia("(max-width: 640px)").matches) {
        await navigator.share({ title: "My moodboard on shopr", url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // cancelled, or no clipboard: the link is on screen to copy by hand
    }
  }

  const form = (
    <form
      className="share-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) submit();
      }}
    >
      {!claimed && (
        <label className="field">
          <span className="label">Handle</span>
          <span className="handle-input">
            <span aria-hidden>@</span>
            <input
              value={handle}
              onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9_.]/g, ""))}
              placeholder="yourname"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={25}
              aria-label="Handle"
              required
            />
          </span>
        </label>
      )}
      <label className="field">
        <span className="label">Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={cleanHandle || "How you'd like to be shown"} maxLength={60} />
      </label>
      <label className="field">
        <span className="label">A line about your style (optional)</span>
        <input value={bio} onChange={(e) => setBio(e.target.value)} placeholder="e.g. 70s suede, workwear, too many loafers" maxLength={200} />
      </label>
      <label className="field">
        <span className="label">Link (optional)</span>
        <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="instagram.com/yourname" inputMode="url" autoCapitalize="none" maxLength={200} />
      </label>
      <div className="share-actions">
        <button className="btn" disabled={!ready}>
          {live ? "Save and update" : "Publish my board"}
        </button>
        {live && (
          <button type="button" className="text-btn" onClick={() => setEditing(false)}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );

  return (
    <section className="share" aria-label="Share your board">
      <div className="share-head">
        <h2 className="section-title">{live ? "Your board is shared" : "Share your board"}</h2>
        <button type="button" className="text-btn" onClick={onClose}>
          Close
        </button>
      </div>

      {!live ? (
        <>
          <p className="muted">
            Put your board on Explore. Anyone can look through it and copy photos onto their own board, and you can take it down any time.
          </p>
          {form}
          <p className="fine">Only this device can change your shared board. Up to 60 photos are shared, from the top of your board.</p>
        </>
      ) : (
        <>
          <p className="share-link">
            <Link href={`/u/${live}`}>{url.replace(/^https?:\/\//, "")}</Link>
            <button type="button" className="text-btn" onClick={copyLink}>
              {copied ? "Copied" : "Copy link"}
            </button>
          </p>
          {state === "behind" ? (
            <div className="share-actions">
              <p className="muted">Your board has changed since you shared it.</p>
              <button
                type="button"
                className="btn"
                disabled={Boolean(publishing)}
                onClick={() => publishBoard({ handle: live, name: publish?.name || live, bio: publish?.bio ?? "", link: publish?.link ?? "" })}
              >
                Update it
              </button>
            </div>
          ) : (
            <p className="muted">Up to date. Change your board and you can update it here.</p>
          )}
          {editing ? (
            form
          ) : (
            <div className="share-actions">
              <button type="button" className="text-btn" onClick={() => setEditing(true)}>
                Edit name and link
              </button>
              <button
                type="button"
                className="text-btn text-btn--danger"
                disabled={Boolean(publishing)}
                onClick={async () => {
                  if (!confirmDown) return setConfirmDown(true);
                  setConfirmDown(false);
                  await unpublishBoard();
                }}
              >
                {confirmDown ? "Tap again to take it down" : "Take it down"}
              </button>
            </div>
          )}
        </>
      )}

      {publishing && (
        <p className="thinking" aria-live="polite">
          <span>{publishing}</span>
        </p>
      )}
      {publishError && (
        <p className="error" role="alert">
          {publishError}{" "}
          <button type="button" className="text-btn" onClick={() => setState({ publishError: null })}>
            Dismiss
          </button>
        </p>
      )}
    </section>
  );
}
