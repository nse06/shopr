// What a request costs to answer: Claude tokens, priced by the model that actually
// answered, and Depop listings from Apify. Estimates from list prices; the Anthropic
// and Apify bills are the final word.

import type Anthropic from "@anthropic-ai/sdk";
import { MODEL } from "./claude";

type Price = { input: number; output: number; cacheRead: number; cacheWrite: number }; // USD per million tokens

// Anthropic list prices. Writing to the (5-minute) prompt cache costs 1.25x input.
export const CLAUDE_PRICES: Record<string, Price> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
};

/** The price list for a model id (the longest known prefix); unknown models are priced like the stylist's. */
export function priceFor(model: string): Price {
  const known = Object.keys(CLAUDE_PRICES)
    .filter((id) => model.startsWith(id))
    .sort((a, b) => b.length - a.length)[0];
  return CLAUDE_PRICES[known ?? MODEL];
}

// Apify bills the Depop scraper per listing returned (about $5 per 1,000) plus a tiny
// fee each time it starts. APIFY_DEPOP_LISTING_USD overrides the per-listing price.
const DEPOP_RUN_USD = 0.0002;
const depopListingUsd = () => Number(process.env.APIFY_DEPOP_LISTING_USD) || 0.005;

export type ClaudeTally = { calls: number; input: number; output: number; cacheRead: number; cacheWrite: number; usd: number };
export type DepopTally = { runs: number; listings: number; usd: number };

/** Adds up what one request spends. */
export class Meter {
  readonly startedAt = Date.now();
  claude: ClaudeTally = { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, usd: 0 };
  depop: DepopTally = { runs: 0, listings: 0, usd: 0 };
  ok = false; // set once the request has answered

  /** Count one Claude response. */
  claudeUsed(message: Pick<Anthropic.Beta.BetaMessage, "model" | "usage">): void {
    const u = message.usage;
    const input = u?.input_tokens ?? 0;
    const output = u?.output_tokens ?? 0;
    const cacheRead = u?.cache_read_input_tokens ?? 0;
    const cacheWrite = u?.cache_creation_input_tokens ?? 0;
    const p = priceFor(message.model ?? MODEL);
    const c = this.claude;
    c.calls++;
    c.input += input;
    c.output += output;
    c.cacheRead += cacheRead;
    c.cacheWrite += cacheWrite;
    c.usd += (input * p.input + output * p.output + cacheRead * p.cacheRead + cacheWrite * p.cacheWrite) / 1e6;
  }

  /** Count one Depop actor run and the listings it returned. */
  depopRun(listings: number): void {
    this.depop.runs++;
    this.depop.listings += listings;
    this.depop.usd += DEPOP_RUN_USD + listings * depopListingUsd();
  }

  /** Count everything another meter counted. */
  add(other: Meter): void {
    for (const k of Object.keys(this.claude) as (keyof ClaudeTally)[]) this.claude[k] += other.claude[k];
    for (const k of Object.keys(this.depop) as (keyof DepopTally)[]) this.depop[k] += other.depop[k];
  }

  get usd(): number {
    return this.claude.usd + this.depop.usd;
  }
}
