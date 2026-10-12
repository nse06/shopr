import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

export type Listing = {
  id: string;
  source: 'shopify' | 'ebay' | 'etsy';
  store: string;
  title: string;
  price: number | null;
  currency: string | null;
  url: string;
  image: string | null;
  sizes: string[];
  brand?: string | null;
  condition?: string | null;
  era?: string | null;
  score?: number | null;
  cluster?: number | null;
};

export type BoardItem = { id: number; kind: string; image: string; origin: string | null; group: string | null };

export type Cluster = {
  index: number;
  member_ids: number[];
  tags: Record<string, string[]>;
  queries: string[];
  summary: string;
  images: string[];
};

export type Run = {
  id: number;
  status: 'running' | 'done' | 'error';
  started: number;
  finished: number | null;
  detail: { log?: string[]; errors?: string[]; queries?: string[] };
};

export type Status = {
  embedder: string;
  sources: { shopify: boolean; ebay: boolean; etsy: boolean; claude: boolean };
  counts: { board: number; listings: number; analyzed: number; feed: number; stores: number };
  latest_run: Run | null;
  auth_required: boolean;
};

export type Prefs = {
  min_price: number | null;
  max_price: number | null;
  size_terms: string[];
  exclude_terms: string[];
  blind_test: boolean;
  max_age_days: number;
};

export type Store = { domain: string; name: string | null; enabled: boolean; last_fetched: number | null; listings: number };

type ArmStats = { like: number; nope: number; rated: number; like_rate: number | null };
export type Stats = { ours: ArmStats; baseline: ArmStats; ours_first_50: { rated: number; liked: number } };

export type Connection = { serverUrl: string; token: string };

const STORAGE_KEY = 'shopr.connection';


export async function loadConnection(): Promise<Connection> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) return { serverUrl: '', token: '', ...JSON.parse(raw) };
  } catch {
    // Storage can be unavailable (private browsing); fall through to defaults.
  }
  // On the web the app is served by the backend itself, so '' means same-origin.
  return { serverUrl: '', token: '' };
}

export async function saveConnection(c: Connection): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(c));
  } catch {
    // Non-fatal: the connection just won't be remembered.
  }
}

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export function normalizeServer(url: string): string {
  let u = url.trim().replace(/\/+$/, '');
  if (u && !/^https?:\/\//i.test(u)) u = `http://${u}`;
  return u;
}

export class Api {
  constructor(private conn: Connection) {}

  get configured(): boolean {
    return Platform.OS === 'web' || !!this.conn.serverUrl;
  }

  /** Absolute URL for a server path (e.g. /media/x.jpg), with the token for <Image>. */
  url(path: string): string {
    if (/^https?:\/\//i.test(path)) return path;
    const base = normalizeServer(this.conn.serverUrl);
    const sep = path.includes('?') ? '&' : '?';
    return `${base}${path}${this.conn.token ? `${sep}token=${encodeURIComponent(this.conn.token)}` : ''}`;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
    if (this.conn.token) headers['x-shopr-token'] = this.conn.token;
    if (init.body && typeof init.body === 'string') headers['Content-Type'] = 'application/json';
    let res: Response;
    try {
      res = await fetch(`${normalizeServer(this.conn.serverUrl)}${path}`, { ...init, headers });
    } catch {
      throw new ApiError("Can't reach the shopr server. Check the server address in Setup.", 0);
    }
    if (!res.ok) {
      let msg = `Server error ${res.status}`;
      try {
        const body = await res.json();
        if (body?.detail) msg = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail);
      } catch {
        // Body wasn't JSON; keep the generic message.
      }
      throw new ApiError(msg, res.status);
    }
    return res.json() as Promise<T>;
  }

  status = () => this.request<Status>('/api/status');
  board = () => this.request<BoardItem[]>('/api/board');
  profile = () => this.request<{ clusters: Cluster[] }>('/api/profile');
  deleteBoardItem = (id: number) => this.request<{ board: BoardItem[] }>(`/api/board/${id}`, { method: 'DELETE' });
  addUrl = (url: string) =>
    this.request<{ added: number[]; board: BoardItem[] }>('/api/board/url', { method: 'POST', body: JSON.stringify({ url }) });

  upload(form: FormData) {
    return this.request<{ added: number[]; errors: string[]; board: BoardItem[] }>('/api/board/upload', {
      method: 'POST',
      body: form,
    });
  }

  refresh = (force = false) =>
    this.request<{ started: boolean; run: Run | null }>(`/api/refresh${force ? '?force=true' : ''}`, { method: 'POST' });
  latestRun = () => this.request<Run | null>('/api/runs/latest');

  feed = (offset = 0, limit = 30) =>
    this.request<{ items: Listing[]; remaining: number }>(`/api/feed?offset=${offset}&limit=${limit}`);
  feedback = (listing_id: string, action: 'like' | 'nope') =>
    this.request<{ ok: boolean; rated: number; reranked: boolean }>('/api/feedback', {
      method: 'POST',
      body: JSON.stringify({ listing_id, action }),
    });
  undoFeedback = (listing_id: string) =>
    this.request<{ ok: boolean }>(`/api/feedback/${encodeURIComponent(listing_id)}`, { method: 'DELETE' });
  likes = () => this.request<Listing[]>('/api/likes');
  stats = () => this.request<Stats>('/api/stats');

  prefs = () => this.request<Prefs>('/api/prefs');
  setPrefs = (p: Partial<Prefs>) => this.request<Prefs>('/api/prefs', { method: 'PUT', body: JSON.stringify(p) });

  stores = () => this.request<Store[]>('/api/stores');
  addStore = (domain: string) => this.request<{ ok: boolean }>('/api/stores', { method: 'POST', body: JSON.stringify({ domain }) });
  setStoreEnabled = (domain: string, enabled: boolean) =>
    this.request<{ ok: boolean }>(`/api/stores/${encodeURIComponent(domain)}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    });
  deleteStore = (domain: string) =>
    this.request<{ ok: boolean }>(`/api/stores/${encodeURIComponent(domain)}`, { method: 'DELETE' });
}

export function formatPrice(price: number | null, currency: string | null): string {
  if (price == null) return '';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: currency === 'JPY' ? 0 : price % 1 === 0 ? 0 : 2,
    }).format(price);
  } catch {
    return `${price} ${currency ?? ''}`.trim();
  }
}
