/**
 * Reddit API wrapper.
 *
 * Responsibilities:
 *   1. Search whitelisted subreddits and fetch top comments — via OAuth
 *      (oauth.reddit.com) when credentials are configured, anonymously
 *      (www.reddit.com) otherwise. Anonymous access works locally but is
 *      blocked from data-center IPs, so production should set credentials.
 *   2. Compress raw Reddit JSON into PostSummary / CommentSummary immediately —
 *      raw API payloads never reach the agent context or the LLM. This is the
 *      "context compression before every LLM call" decision from the README.
 *   3. Fall back to deterministic mock data when the API is unreachable, and
 *      label the result `source: "mock"` so the UI can disclose it.
 */
import { AGENT_LIMITS, isMockReddit, type Subreddit } from "@/lib/config";
import type { CommentSummary, PostSummary } from "@/lib/agent/schemas";
import { getRedditAccessToken, hasRedditCredentials } from "@/lib/reddit/auth";
import { MOCK_COMMENTS, MOCK_POSTS } from "@/lib/reddit/mock-data";

const ANON_BASE = "https://www.reddit.com";
const OAUTH_BASE = "https://oauth.reddit.com";
/** Post permalinks shown to the user always point at the public site. */
const PUBLIC_BASE = "https://www.reddit.com";
/** Identify ourselves politely; Reddit throttles anonymous default agents hard. */
const USER_AGENT = "pulse-mvp/0.1 (on-demand reddit discussion finder)";
const FETCH_TIMEOUT_MS = 8000;

interface SearchResult {
  posts: PostSummary[];
  source: "live" | "mock";
}

interface CommentsResult {
  comments: CommentSummary[];
  source: "live" | "mock";
}

/**
 * Fetch a Reddit API path (e.g. "/r/webdev/search.json?...") with a hard
 * timeout so a slow response can't stall the agent loop. Uses the OAuth host
 * + Bearer token when credentials are configured, anonymous host otherwise.
 */
async function fetchJson(path: string): Promise<unknown> {
  const headers: Record<string, string> = { "User-Agent": USER_AGENT };
  let base = ANON_BASE;
  if (hasRedditCredentials()) {
    headers.Authorization = `Bearer ${await getRedditAccessToken()}`;
    base = OAUTH_BASE;
  }

  const url = `${base}${path}`;
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Reddit API responded ${res.status} for ${url}`);
  }
  return res.json();
}

/** Convert one raw Reddit listing child into the compressed PostSummary shape. */
function compressPost(child: any, subreddit: Subreddit): PostSummary | null {
  const d = child?.data;
  if (!d?.id || !d?.title) return null;
  return {
    id: String(d.id),
    subreddit,
    title: String(d.title).slice(0, 300),
    score: Number(d.score ?? 0),
    numComments: Number(d.num_comments ?? 0),
    ageHours: Math.max(0, (Date.now() / 1000 - Number(d.created_utc ?? 0)) / 3600),
    url: `${PUBLIC_BASE}${d.permalink ?? ""}`,
    // Keep only a short preview of the body — full text is token waste.
    snippet: String(d.selftext ?? "").replace(/\s+/g, " ").slice(0, 280),
  };
}

/**
 * Search the given whitelisted subreddits for recent posts matching keywords.
 * Results from all subreddits are merged, deduped and capped.
 */
export async function searchReddit(
  keywords: string[],
  subreddits: Subreddit[],
): Promise<SearchResult> {
  if (isMockReddit()) {
    return { posts: filterMockPosts(keywords, subreddits), source: "mock" };
  }

  try {
    const query = encodeURIComponent(keywords.join(" "));
    // One request per subreddit, in parallel; each is small (limit=8).
    const listings = await Promise.all(
      subreddits.map((sub) =>
        fetchJson(
          `/r/${sub}/search.json?q=${query}&restrict_sr=1&sort=relevance&t=week&limit=8`,
        ).then((json: any) => ({ sub, children: json?.data?.children ?? [] })),
      ),
    );

    const seen = new Set<string>();
    const posts: PostSummary[] = [];
    for (const { sub, children } of listings) {
      for (const child of children) {
        const post = compressPost(child, sub);
        if (post && !seen.has(post.id)) {
          seen.add(post.id);
          posts.push(post);
        }
      }
    }
    // Newest-ish and most engaged first, capped for token budget.
    posts.sort((a, b) => b.score + b.numComments * 2 - (a.score + a.numComments * 2));
    return { posts: posts.slice(0, AGENT_LIMITS.maxPostsInContext * 2), source: "live" };
  } catch (err) {
    // Network failure must not kill the demo — fall back and disclose it.
    // Logged so "why is everything mock data?" is answerable from the server logs.
    console.warn("[reddit] search failed, falling back to mock data:", err);
    return { posts: filterMockPosts(keywords, subreddits), source: "mock" };
  }
}

/** Fetch and compress the top comments of a post. */
export async function getPostComments(postId: string): Promise<CommentsResult> {
  if (isMockReddit() || postId.startsWith("mock-")) {
    return { comments: MOCK_COMMENTS[postId] ?? [], source: "mock" };
  }

  try {
    const json: any = await fetchJson(
      `/comments/${postId}.json?sort=top&limit=${AGENT_LIMITS.maxCommentsInContext}&depth=1`,
    );
    // Reddit returns [postListing, commentListing]; we only need the comments.
    const children: any[] = json?.[1]?.data?.children ?? [];
    const comments: CommentSummary[] = children
      .filter((c) => c?.kind === "t1" && c?.data?.body)
      .slice(0, AGENT_LIMITS.maxCommentsInContext)
      .map((c) => ({
        author: String(c.data.author ?? "unknown"),
        score: Number(c.data.score ?? 0),
        snippet: String(c.data.body).replace(/\s+/g, " ").slice(0, 240),
      }));
    return { comments, source: "live" };
  } catch (err) {
    console.warn(`[reddit] comments fetch failed for "${postId}", falling back to mock data:`, err);
    return { comments: MOCK_COMMENTS[postId] ?? [], source: "mock" };
  }
}

/** Keyword/subreddit filter over the mock corpus, mirroring real search behavior. */
function filterMockPosts(keywords: string[], subreddits: Subreddit[]): PostSummary[] {
  const words = keywords.map((k) => k.toLowerCase());
  const inScope = MOCK_POSTS.filter((p) => subreddits.includes(p.subreddit));
  const matched = inScope.filter((p) => {
    const haystack = `${p.title} ${p.snippet}`.toLowerCase();
    return words.some((w) => haystack.includes(w));
  });
  // If keywords are too narrow for the small mock corpus, return everything in
  // scope — the agent's quality evaluation still decides what is acceptable.
  return matched.length > 0 ? matched : inScope;
}
