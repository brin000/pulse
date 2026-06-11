/**
 * Reddit OAuth (client_credentials / "application only" flow).
 *
 * Why: anonymous www.reddit.com requests are heavily throttled and outright
 * blocked from data-center IPs (Vercel, etc.). With a registered script app,
 * requests go to oauth.reddit.com with a Bearer token and a real quota.
 *
 * Credentials are optional: when they are missing the client falls back to
 * the anonymous endpoint (fine for local development), and ultimately to
 * mock data — the run never hard-fails on auth.
 */

const TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
/** Refresh slightly early so a token never expires mid-run. */
const EXPIRY_MARGIN_MS = 60_000;

export function hasRedditCredentials(): boolean {
  return Boolean(process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET);
}

/** Module-level cache: one app-only token shared by all runs in this instance. */
let cached: { token: string; expiresAt: number } | null = null;

/**
 * Returns a valid app-only access token, fetching/refreshing as needed.
 * Throws on network/credential errors — callers treat that like any other
 * Reddit failure and fall back (anonymous endpoint or mock data).
 */
export async function getRedditAccessToken(): Promise<string> {
  if (cached && Date.now() < cached.expiresAt - EXPIRY_MARGIN_MS) {
    return cached.token;
  }

  const id = process.env.REDDIT_CLIENT_ID;
  const secret = process.env.REDDIT_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Reddit credentials are not configured");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Reddit token endpoint responded ${res.status}`);
  }

  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error("Reddit token response had no access_token");

  cached = {
    token: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
  return cached.token;
}
