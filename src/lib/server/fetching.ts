// Fetching photos and pages from other sites, carefully.

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

export type ImageType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

/** The real format, from the file's first bytes (Claude rejects a mislabelled photo). */
export function sniffImage(bytes: Uint8Array): ImageType | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  const riff = String.fromCharCode(...bytes.slice(0, 4));
  const webp = String.fromCharCode(...bytes.slice(8, 12));
  if (riff === "RIFF" && webp === "WEBP") return "image/webp";
  return null;
}

/** Only public web addresses: no local machines or private networks. */
export function isPublicUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host.includes(".") && !host.includes(":")) return null; // "localhost", intranet names
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localhost")) return null;
  const v4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10 || a === 127 || a === 0 || a >= 224) return null;
    if (a === 169 && b === 254) return null;
    if (a === 172 && b >= 16 && b <= 31) return null;
    if (a === 192 && b === 168) return null;
    if (a === 100 && b >= 64 && b <= 127) return null;
  }
  if (host.includes(":")) {
    // IPv6 literal: allow only global unicast (2000::/3).
    if (!/^[23][0-9a-f]{0,3}:/.test(host)) return null;
  }
  return url;
}

type Fetched = { bytes: Uint8Array; contentType: string; url: string };

/** GET a public URL, following up to 4 redirects (each checked), with size and time limits. */
export async function fetchPublic(
  raw: string,
  opts: { maxBytes: number; timeoutMs: number; accept?: string; signal?: AbortSignal },
): Promise<Fetched> {
  let current = raw;
  const signal = opts.signal
    ? AbortSignal.any([opts.signal, AbortSignal.timeout(opts.timeoutMs)])
    : AbortSignal.timeout(opts.timeoutMs);
  for (let hop = 0; hop < 5; hop++) {
    const url = isPublicUrl(current);
    if (!url) throw new Error("That link isn't a public web address.");
    const r = await fetch(url, {
      redirect: "manual",
      signal,
      headers: { "User-Agent": BROWSER_UA, Accept: opts.accept ?? "*/*", "Accept-Language": "en-US,en;q=0.8" },
    });
    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) {
      current = new URL(r.headers.get("location")!, url).toString();
      continue;
    }
    if (!r.ok) throw new Error(`The site answered with HTTP ${r.status}.`);
    const declared = Number(r.headers.get("content-length") || 0);
    if (declared > opts.maxBytes) throw new Error("That file is too big.");
    const bytes = await readCapped(r, opts.maxBytes);
    return { bytes, contentType: r.headers.get("content-type") || "", url: url.toString() };
  }
  throw new Error("That link redirects too many times.");
}

async function readCapped(r: Response, maxBytes: number): Promise<Uint8Array> {
  if (!r.body) return new Uint8Array(await r.arrayBuffer());
  const reader = r.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("That file is too big.");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

export type Photo = { data: string; mediaType: ImageType };

const PHOTO_SIDE = 512;

/**
 * Shrink a photo to at most 512px on its long side, as JPEG. Claude bills a photo by
 * its size, and some marketplaces (Depop) serve full-size photos. Null if it can't.
 */
export async function shrinkPhoto(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    const sharp = (await import("sharp")).default;
    const out = await sharp(bytes, { failOn: "none" })
      .rotate()
      .resize({ width: PHOTO_SIDE, height: PHOTO_SIDE, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 80 })
      .toBuffer();
    return new Uint8Array(out);
  } catch {
    return null;
  }
}

/** A listing photo as base64 for Claude, or null if it can't be fetched or isn't a usable image. */
export async function fetchPhoto(
  url: string,
  signal?: AbortSignal,
  accept = "image/webp,image/jpeg,image/png,image/gif;q=0.8",
): Promise<Photo | null> {
  try {
    const { bytes } = await fetchPublic(url, { maxBytes: 8_000_000, timeoutMs: 8000, accept, signal });
    const small = await shrinkPhoto(bytes);
    if (small) return { data: Buffer.from(small).toString("base64"), mediaType: "image/jpeg" };
    const mediaType = sniffImage(bytes);
    return mediaType && bytes.byteLength <= 1_500_000 ? { data: Buffer.from(bytes).toString("base64"), mediaType } : null;
  } catch {
    return null;
  }
}

/** The preview photo a page shares (og:image and friends), as an absolute URL. */
export function previewImageFromHtml(html: string, pageUrl: string): string | null {
  const metas = html.match(/<meta\b[^>]*>/gi) ?? [];
  const wanted = ["og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src"];
  for (const name of wanted) {
    for (const tag of metas) {
      const key = attr(tag, "property") ?? attr(tag, "name");
      if (key?.toLowerCase() !== name) continue;
      const content = attr(tag, "content");
      if (content) {
        try {
          return new URL(decodeEntities(content), pageUrl).toString();
        } catch {
          // keep looking
        }
      }
    }
  }
  const link = html.match(/<link\b[^>]*rel=["']image_src["'][^>]*>/i)?.[0];
  const href = link ? attr(link, "href") : null;
  if (href) {
    try {
      return new URL(decodeEntities(href), pageUrl).toString();
    } catch {
      return null;
    }
  }
  return null;
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? (m[2] ?? m[3] ?? m[4] ?? null) : null;
}

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&#x2F;/gi, "/").replace(/&#47;/g, "/").replace(/&quot;/g, '"');
}
