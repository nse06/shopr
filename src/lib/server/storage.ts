// Where public boards live: a public Vercel Blob store. Connect one to the project in
// Vercel → Storage and its settings appear by themselves (BLOB_STORE_ID, signed in
// with the project's own identity, or the older BLOB_READ_WRITE_TOKEN). For local
// development and tests, SHOPR_LOCAL_BLOB_DIR points at a folder instead, served by
// /api/local-blob.

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { BlobNotFoundError, BlobPreconditionFailedError, del, head, list, put, type HeadBlobResult } from "@vercel/blob";

export type StoredJson<T> = { data: T; etag: string | null };

/** A write lost a race with another write (the version it was based on changed). */
export class Conflict extends Error {}

export interface Store {
  readJson<T>(pathname: string): Promise<StoredJson<T> | null>;
  /** With ifMatch, only writes if the stored version is still that one (null: must not exist yet). */
  writeJson(pathname: string, data: unknown, opts?: { ifMatch?: string | null }): Promise<void>;
  /** Saves a public file and returns its URL. */
  writeFile(pathname: string, bytes: Uint8Array, contentType: string): Promise<string>;
  list(prefix: string): Promise<{ url: string; pathname: string }[]>;
  remove(urls: string[]): Promise<void>;
  /** Whether a URL points at a file this store holds under the given folder. */
  owns(url: string, prefix: string): boolean;
}

const LOCAL_ROUTE = "/api/local-blob/";

/** Read a JSON file, change it and write it back, starting over if another write got there first. */
export async function updateJson<T>(s: Store, pathname: string, empty: () => T, change: (data: T) => T): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const current = await s.readJson<T>(pathname);
    const next = change(current?.data ?? empty());
    try {
      await s.writeJson(pathname, next, { ifMatch: current?.etag ?? null });
      return next;
    } catch (e) {
      if (!(e instanceof Conflict)) throw e;
    }
  }
  throw new Error(`Couldn't update ${pathname}: it kept changing. Try again.`);
}

/**
 * A folder for the owner's own records (costs, clicks). The store is public, so the
 * name is a hash of the Claude key: it can't be guessed from shared photos' addresses.
 */
export function privateFolder(name: string): string {
  const secret = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || "local";
  return `${name}/${createHash("sha256").update(`shopr ${name} ${secret}`).digest("hex").slice(0, 24)}`;
}

const blobConnected = () => Boolean(process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN);

export function storageConfigured(): boolean {
  return blobConnected() || Boolean(process.env.SHOPR_LOCAL_BLOB_DIR);
}

const bareEtag = (etag: string) => etag.replace(/^W\//, "").replace(/"/g, "");

export class BlobStore implements Store {
  /**
   * Public files are served through a CDN that can lag up to a minute behind a change,
   * so ask the Blob API (always current) which version is the latest, then fetch
   * exactly that version.
   */
  async readJson<T>(pathname: string): Promise<StoredJson<T> | null> {
    let meta: HeadBlobResult;
    try {
      meta = await head(pathname);
    } catch (e) {
      if (e instanceof BlobNotFoundError) return null;
      throw e;
    }
    for (let attempt = 0; attempt < 4; attempt++) {
      const url = new URL(meta.url);
      url.searchParams.set("v", `${bareEtag(meta.etag)}${attempt ? `.${attempt}` : ""}`);
      const r = await fetch(url, { cache: "no-store" });
      const etag = r.headers.get("etag");
      if (r.ok && (!etag || bareEtag(etag) === bareEtag(meta.etag))) return { data: (await r.json()) as T, etag: meta.etag };
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
    throw new Error(`The shared boards are still catching up (${pathname}). Try again in a minute.`);
  }

  async writeJson(pathname: string, data: unknown, opts: { ifMatch?: string | null } = {}) {
    try {
      await put(pathname, JSON.stringify(data), {
        access: "public",
        contentType: "application/json",
        addRandomSuffix: false,
        cacheControlMaxAge: 60,
        ...(opts.ifMatch === undefined ? { allowOverwrite: true } : opts.ifMatch === null ? { allowOverwrite: false } : { ifMatch: opts.ifMatch }),
      });
    } catch (e) {
      if (e instanceof BlobPreconditionFailedError) throw new Conflict("Someone else changed this at the same time.");
      if (opts.ifMatch === null && e instanceof Error && /already exists/i.test(e.message)) throw new Conflict("That already exists.");
      throw e;
    }
  }

  async writeFile(pathname: string, bytes: Uint8Array, contentType: string) {
    const r = await put(pathname, Buffer.from(bytes), { access: "public", contentType, addRandomSuffix: false, allowOverwrite: true });
    return r.url;
  }

  async list(prefix: string) {
    const out: { url: string; pathname: string }[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix, cursor, limit: 1000 });
      out.push(...page.blobs.map((b) => ({ url: b.url, pathname: b.pathname })));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return out;
  }

  async remove(urls: string[]) {
    if (urls.length) await del(urls);
  }

  owns(url: string, prefix: string) {
    try {
      const u = new URL(url);
      return u.protocol === "https:" && u.hostname.endsWith(".blob.vercel-storage.com") && u.pathname.startsWith(`/${prefix}`);
    } catch {
      return false;
    }
  }
}

/**
 * Files in a local folder, for development and tests. Like Blob, a conditional write
 * checks and writes in one step: writes to a file wait their turn, and ETags are
 * hashes of the contents.
 */
class FolderStore implements Store {
  private queue = new Map<string, Promise<void>>();

  constructor(private root: string) {}

  private file(pathname: string): string {
    const full = path.resolve(this.root, pathname);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error("Bad path");
    return full;
  }

  private async exclusive<T>(full: string, work: () => Promise<T>): Promise<T> {
    const result = (this.queue.get(full) ?? Promise.resolve()).then(work);
    this.queue.set(
      full,
      result.then(
        () => undefined,
        () => undefined,
      ),
    );
    return result;
  }

  private async contents(full: string): Promise<{ text: string; etag: string } | null> {
    try {
      const text = await fs.readFile(full, "utf8");
      return { text, etag: createHash("sha1").update(text).digest("hex") };
    } catch {
      return null;
    }
  }

  async readJson<T>(pathname: string) {
    const found = await this.contents(this.file(pathname));
    try {
      return found ? { data: JSON.parse(found.text) as T, etag: found.etag } : null;
    } catch {
      return null;
    }
  }

  async writeJson(pathname: string, data: unknown, opts: { ifMatch?: string | null } = {}) {
    const full = this.file(pathname);
    await this.exclusive(full, async () => {
      if (opts.ifMatch !== undefined && ((await this.contents(full))?.etag ?? null) !== opts.ifMatch) throw new Conflict("Changed meanwhile.");
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, JSON.stringify(data));
    });
  }

  async writeFile(pathname: string, bytes: Uint8Array) {
    const full = this.file(pathname);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, bytes);
    return LOCAL_ROUTE + pathname;
  }

  async list(prefix: string) {
    const out: { url: string; pathname: string }[] = [];
    const walk = async (dir: string) => {
      let entries: import("node:fs").Dirent[] = [];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) await walk(full);
        else {
          const pathname = path.relative(this.root, full).split(path.sep).join("/");
          if (pathname.startsWith(prefix)) out.push({ url: LOCAL_ROUTE + pathname, pathname });
        }
      }
    };
    await walk(this.root);
    return out;
  }

  async remove(urls: string[]) {
    for (const url of urls) {
      if (url.startsWith(LOCAL_ROUTE)) await fs.rm(this.file(url.slice(LOCAL_ROUTE.length)), { force: true });
    }
  }

  owns(url: string, prefix: string) {
    return url.startsWith(LOCAL_ROUTE + prefix) && !url.includes("..");
  }

  async readFile(pathname: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await fs.readFile(this.file(pathname)));
    } catch {
      return null;
    }
  }
}

let cached: Store | null = null;

export function store(): Store {
  if (cached) return cached;
  const local = process.env.SHOPR_LOCAL_BLOB_DIR;
  cached = !blobConnected() && local ? new FolderStore(local) : new BlobStore();
  return cached;
}

/** The local folder store, when that's what's in use (for /api/local-blob). */
export function folderStore(): FolderStore | null {
  const s = store();
  return s instanceof FolderStore ? s : null;
}
