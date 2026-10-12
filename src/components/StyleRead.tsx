"use client";

import { readBoard } from "@/lib/client/api";
import { boardKey, useApp } from "@/lib/client/store";

/** What the stylist sees in the moodboard. */
export function StyleRead() {
  const { board, profile, reading, readError, status } = useApp();
  const stale = profile && profile.boardKey !== boardKey(board);

  if (!profile) {
    return (
      <section className="read" aria-live="polite">
        <p className="eyebrow">What your stylist sees</p>
        {reading ? (
          <p className="thinking">
            <span>Reading your board</span>
          </p>
        ) : readError ? (
          <>
            <p className="error">{readError}</p>
            <button type="button" className="text-btn" onClick={readBoard}>
              Try again
            </button>
          </>
        ) : board.length < 3 ? (
          <p className="muted">Pin at least three photos and your stylist will describe your style here.</p>
        ) : status && !status.claude ? (
          <p className="muted">Connect Claude (see Settings) and your stylist will describe your style here.</p>
        ) : (
          <button type="button" className="text-btn" onClick={readBoard}>
            Read my board
          </button>
        )}
      </section>
    );
  }

  const p = profile.profile;
  // Photo numbers refer to the board as it was when it was read.
  const readIds = profile.boardKey.split(",");
  const byId = new Map(board.map((b) => [b.id, b]));
  const photo = (n: number) => byId.get(readIds[n - 1]);

  return (
    <section className="read" aria-live="polite">
      <p className="eyebrow">What your stylist sees</p>
      <h2 className="read-headline">{p.headline}</h2>
      <p className="read-summary">{p.summary}</p>

      {p.directions.length > 0 && (
        <ol className="directions">
          {p.directions.map((d) => (
            <li key={d.name}>
              <h3 className="direction-name">{d.name}</h3>
              <p>{d.description}</p>
              <div className="thumbs">
                {d.photos
                  .map(photo)
                  .filter((b) => b !== undefined)
                  .slice(0, 5)
                  .map((b) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={b.id} src={b.image} alt="" />
                  ))}
              </div>
            </li>
          ))}
        </ol>
      )}

      <dl className="facts">
        {p.key_pieces.length > 0 && (
          <>
            <dt>Key pieces</dt>
            <dd>{p.key_pieces.join(", ")}</dd>
          </>
        )}
        {p.palette.length > 0 && (
          <>
            <dt>Palette</dt>
            <dd>{p.palette.join(", ")}</dd>
          </>
        )}
        {p.fit && (
          <>
            <dt>Fit</dt>
            <dd>{p.fit}</dd>
          </>
        )}
        {p.look_for.length > 0 && (
          <>
            <dt>Look for</dt>
            <dd>{p.look_for.join(", ")}</dd>
          </>
        )}
        {p.avoid.length > 0 && (
          <>
            <dt>Avoid</dt>
            <dd>{p.avoid.join(", ")}</dd>
          </>
        )}
      </dl>

      <p className="read-foot">
        {reading ? (
          <span className="thinking">
            <span>Reading your board again</span>
          </span>
        ) : (
          <>
            {stale && <span>Your board has changed since this read. </span>}
            <button type="button" className="text-btn" onClick={readBoard}>
              Read it again
            </button>
          </>
        )}
      </p>
      {readError && <p className="error">{readError}</p>}
    </section>
  );
}
