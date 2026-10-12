import Anthropic from "@anthropic-ai/sdk";

export const MODEL = "claude-opus-5-5";

// If a safety classifier declines a request, the API retries it on Anthropic's
// recommended fallback model instead of returning the refusal.
export const FALLBACKS = {
  betas: ["server-side-fallback-2026-07-01"] as Anthropic.Beta.AnthropicBeta[],
  fallbacks: "default" as const,
};

export function claudeConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

let client: Anthropic | undefined;

export function claude(): Anthropic {
  client ??= new Anthropic({ maxRetries: 2, timeout: 240_000 });
  return client;
}

/** A problem worth showing to the person, in plain words. */
export class StylistError extends Error {}

export function textOf(message: Anthropic.Beta.BetaMessage): string {
  return message.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/** Check a finished response; returns its text or throws a StylistError. */
export function finalText(message: Anthropic.Beta.BetaMessage): string {
  if (message.stop_reason === "refusal") {
    throw new StylistError("Your stylist couldn't help with that one. Try asking another way.");
  }
  if (message.stop_reason === "max_tokens") {
    throw new StylistError("That answer ran long and got cut off. Try again, or ask for something narrower.");
  }
  return textOf(message);
}

export function friendlyError(e: unknown): string {
  if (e instanceof StylistError) return e.message;
  if (e instanceof Anthropic.AuthenticationError) {
    return "Your Claude key isn't working. In Vercel, check ANTHROPIC_API_KEY, then redeploy.";
  }
  if (e instanceof Anthropic.PermissionDeniedError) {
    return "Your Claude key doesn't have access to this model. Check your Anthropic account.";
  }
  if (e instanceof Anthropic.RateLimitError) return "Claude is busy right now. Wait a minute and try again.";
  if (e instanceof Anthropic.BadRequestError) {
    // e.g. "Your credit balance is too low to access the Anthropic API."
    const body = e.error as { error?: { message?: string } } | undefined;
    return `Claude couldn't take the request: ${body?.error?.message ?? e.message}`;
  }
  if (e instanceof Anthropic.APIConnectionError) return "Couldn't reach Claude. Try again.";
  if (e instanceof Anthropic.APIError) {
    return e.status === 529 ? "Claude is overloaded right now. Try again in a minute." : `Claude had a problem (${e.status}). Try again.`;
  }
  if (e instanceof Error && e.name === "AbortError") return "Stopped.";
  return "Something went wrong. Try again.";
}
