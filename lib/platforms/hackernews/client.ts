/**
 * Hacker News API wrapper (Algolia public search API — no auth required).
 *
 * Mirrors the Reddit client's responsibilities and failure policy:
 *   1. Search recent stories per section and fetch top-level comments.
 *   2. Compress raw payloads into PostSummary / CommentSummary immediately —
 *      raw API JSON never reaches the agent context or the LLM.
 *   3. Fall back to deterministic mock data (PULSE_MOCK_HN=1 or any fetch
 *      failure) and label the result `source: "mock"` so the UI discloses it.
 *
 * Post ids are prefixed "hn-" before they leave this module. That keeps the
 * id namespace disjoint from Reddit's, so seen_posts dedup rows can never
 * collide across platforms (docs/adr/0005-multi-platform.md). getComments
 * strips the prefix again before calling the API.
 */
import { AGENT_LIMITS, isMockHackerNews } from "@/lib/config";
import type { CommentSummary, PostSummary } from "@/lib/agent/schemas";
import {
  HN_COMMUNITY_TAGS,
  type HnCommunity,
} from "@/lib/platforms/hackernews/communities";
import { HN_MOCK_COMMENTS, HN_MOCK_POSTS } from "@/lib/platforms/hackernews/mock-data";

const ALGOLIA_BASE = "https://hn.algolia.com/api/v1";
/** Post links shown to the user point at the HN thread, not the API. */
const PUBLIC_ITEM_BASE = "https://news.ycombinator.com/item?id=";
/** Same hard timeout as the Reddit client — a slow API must not stall the loop. */
const FETCH_TIMEOUT_MS = 8000;
/** Search window: only threads young enough to still be joinable. */
const WEEK_SECONDS = 7 * 24 * 3600;

const ID_PREFIX = "hn-";

interface SearchResult {
  posts: PostSummary[];
  source: "live" | "mock";
}

interface CommentsResult {
  comments: CommentSummary[];
  source: "live" | "mock";
}

async function fetchJson(path: string): Promise<unknown> {
  const url = `${ALGOLIA_BASE}${path}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`HN Algolia API responded ${res.status} for ${url}`);
  }
  return res.json();
}

/** Comment bodies arrive as HTML; strip tags/entities for the compressed snippet. */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Derive the Pulse community from a hit's Algolia tags. Ask/Show HN items
 * also carry the generic "story" tag, so the specific sections win.
 */
function communityFromTags(tags: string[]): HnCommunity {
  if (tags.includes("ask_hn")) return "ask-hn";
  if (tags.includes("show_hn")) return "show-hn";
  return "story";
}

/** Convert one raw Algolia hit into the compressed PostSummary shape. */
function compressHit(hit: any): PostSummary | null {
  if (!hit?.objectID || !hit?.title) return null;
  const text = typeof hit.story_text === "string" ? stripHtml(hit.story_text) : "";
  return {
    id: `${ID_PREFIX}${hit.objectID}`,
    platform: "hackernews",
    community: communityFromTags(Array.isArray(hit._tags) ? hit._tags : []),
    title: String(hit.title).slice(0, 300),
    score: Number(hit.points ?? 0),
    numComments: Number(hit.num_comments ?? 0),
    ageHours: Math.max(0, (Date.now() / 1000 - Number(hit.created_at_i ?? 0)) / 3600),
    url: `${PUBLIC_ITEM_BASE}${hit.objectID}`,
    // Link-only stories have no body; the external URL is the next-best preview.
    snippet: (text || String(hit.url ?? "")).slice(0, 280),
  };
}

/**
 * Search the requested HN sections for recent stories matching the keywords.
 * One request per section in parallel (mirrors the per-subreddit pattern);
 * results are merged, deduped and capped.
 */
export async function searchHackerNews(
  keywords: string[],
  communities: HnCommunity[],
): Promise<SearchResult> {
  if (isMockHackerNews()) {
    return { posts: filterMockPosts(keywords, communities), source: "mock" };
  }

  try {
    const query = encodeURIComponent(keywords.join(" "));
    const since = Math.floor(Date.now() / 1000) - WEEK_SECONDS;
    const listings = await Promise.all(
      communities.map((community) =>
        fetchJson(
          `/search?query=${query}&tags=${HN_COMMUNITY_TAGS[community]}&numericFilters=created_at_i>${since}&hitsPerPage=8`,
        ).then((json: any) => json?.hits ?? []),
      ),
    );

    // "story" search results include Ask/Show HN items too, so dedupe by id.
    const seen = new Set<string>();
    const posts: PostSummary[] = [];
    for (const hits of listings) {
      for (const hit of hits) {
        const post = compressHit(hit);
        if (post && !seen.has(post.id)) {
          seen.add(post.id);
          posts.push(post);
        }
      }
    }
    // Same engagement-first ordering and token-budget cap as the Reddit client.
    posts.sort((a, b) => b.score + b.numComments * 2 - (a.score + a.numComments * 2));
    return { posts: posts.slice(0, AGENT_LIMITS.maxPostsInContext * 2), source: "live" };
  } catch (err) {
    console.warn("[hackernews] search failed, falling back to mock data:", err);
    return { posts: filterMockPosts(keywords, communities), source: "mock" };
  }
}

/** Fetch and compress the top-level comments of a thread. */
export async function getHnComments(postId: string): Promise<CommentsResult> {
  if (isMockHackerNews() || postId.startsWith(`${ID_PREFIX}mock-`)) {
    return { comments: HN_MOCK_COMMENTS[postId] ?? [], source: "mock" };
  }

  try {
    // The "hn-" prefix is Pulse's namespace, not the API's — strip it here.
    const itemId = postId.startsWith(ID_PREFIX) ? postId.slice(ID_PREFIX.length) : postId;
    const json: any = await fetchJson(`/items/${itemId}`);
    const children: any[] = Array.isArray(json?.children) ? json.children : [];
    const comments: CommentSummary[] = children
      .filter((c) => c?.type === "comment" && c?.text)
      .slice(0, AGENT_LIMITS.maxCommentsInContext)
      .map((c) => ({
        author: String(c.author ?? "unknown"),
        // Algolia reports null points for most comments; 0 is the honest floor.
        score: Number(c.points ?? 0),
        snippet: stripHtml(String(c.text)).slice(0, 240),
      }));
    return { comments, source: "live" };
  } catch (err) {
    console.warn(`[hackernews] comments fetch failed for "${postId}", falling back to mock data:`, err);
    return { comments: HN_MOCK_COMMENTS[postId] ?? [], source: "mock" };
  }
}

/** Keyword/section filter over the mock corpus, mirroring real search behavior. */
function filterMockPosts(keywords: string[], communities: HnCommunity[]): PostSummary[] {
  const words = keywords.map((k) => k.toLowerCase());
  const inScope = HN_MOCK_POSTS.filter((p) =>
    communities.includes(p.community as HnCommunity),
  );
  // No match stays empty on purpose — same honesty rule as the Reddit mock:
  // it is what lets the auto goal pivot instead of replying off-topic.
  return inScope.filter((p) => {
    const haystack = `${p.title} ${p.snippet}`.toLowerCase();
    return words.some((w) => haystack.includes(w));
  });
}
