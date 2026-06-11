/**
 * Deterministic mock Hacker News data.
 *
 * Used when PULSE_MOCK_HN=1 or when the Algolia API is unreachable. Shaped
 * exactly like compressed live data and always labeled `source: "mock"` so
 * the UI can disclose it. Ids carry the "hn-" prefix like real HN posts do
 * after compression (see client.ts), keeping the seen_posts namespace clean.
 */
import type { CommentSummary, PostSummary } from "@/lib/agent/schemas";

export const HN_MOCK_POSTS: PostSummary[] = [
  {
    id: "hn-mock-1",
    platform: "hackernews",
    community: "story",
    title: "The agent loop is a control problem, not a prompt problem",
    score: 342,
    numComments: 198,
    ageHours: 7,
    url: "https://news.ycombinator.com/item?id=hn-mock-1",
    snippet:
      "Most 'AI agent' failures I've debugged came from the runtime, not the model: no termination conditions, unvalidated tool calls, context that grows until the model drowns. We treat agents as distributed-systems problems now.",
  },
  {
    id: "hn-mock-2",
    platform: "hackernews",
    community: "ask-hn",
    title: "Ask HN: How do you stay present in developer communities while shipping?",
    score: 87,
    numComments: 64,
    ageHours: 11,
    url: "https://news.ycombinator.com/item?id=hn-mock-2",
    snippet:
      "Solo founder here. I know being active where my users hang out matters, but every genuine reply costs me an hour of context switching. How do other founders and indie hackers balance community presence with actually building?",
  },
  {
    id: "hn-mock-3",
    platform: "hackernews",
    community: "show-hn",
    title: "Show HN: I built a side project that streams an AI agent's reasoning live",
    score: 156,
    numComments: 73,
    ageHours: 5,
    url: "https://news.ycombinator.com/item?id=hn-mock-3",
    snippet:
      "After months of agent demos that were just spinners, I built a small tool that streams every decision and tool call as it happens. Would love feedback on whether the timeline view actually builds trust or just adds noise.",
  },
  {
    id: "hn-mock-4",
    platform: "hackernews",
    community: "story",
    title: "Structured outputs in production: a year of schema-constrained LLM calls",
    score: 271,
    numComments: 142,
    ageHours: 26,
    url: "https://news.ycombinator.com/item?id=hn-mock-4",
    snippet:
      "Write-up of what broke and what held after a year of forcing every model response through JSON schemas: validation at two layers, retry budgets, and why we stopped trusting the SDK's parsing alone.",
  },
  {
    id: "hn-mock-5",
    platform: "hackernews",
    community: "ask-hn",
    title: "Ask HN: Is launching a startup on top of LLM APIs still defensible?",
    score: 119,
    numComments: 211,
    ageHours: 18,
    url: "https://news.ycombinator.com/item?id=hn-mock-5",
    snippet:
      "Every founder I meet is building a wrapper. What actually compounds: the orchestration layer, the data, the distribution? Curious what HN thinks separates a feature from a company here.",
  },
];

export const HN_MOCK_COMMENTS: Record<string, CommentSummary[]> = {
  "hn-mock-1": [
    {
      author: "distsys_refugee",
      score: 84,
      snippet:
        "Calling it a control problem is exactly right. Retry budgets, bounded loops, and validated state transitions — none of that lives in the prompt.",
    },
    {
      author: "promptless",
      score: 52,
      snippet:
        "We cut our agent failures in half by validating tool arguments at the runtime boundary instead of trusting the SDK's schema pass.",
    },
    {
      author: "yak_shaver_9000",
      score: 31,
      snippet:
        "The missing piece in most write-ups: showing the operator WHY each step happened. Observability is the difference between a demo and a product.",
    },
  ],
  "hn-mock-2": [
    {
      author: "bootstrapped_ben",
      score: 41,
      snippet:
        "I timebox it: 25 minutes a day, only threads where I have first-hand experience to add. Everything else is fear of missing out.",
    },
    {
      author: "quietlaunch",
      score: 27,
      snippet:
        "The trick is showing up early in a thread's life. A thoughtful comment at hour 2 beats a brilliant one at hour 30.",
    },
  ],
  "hn-mock-3": [
    {
      author: "skeptical_sre",
      score: 38,
      snippet:
        "The timeline view is the right instinct. I'd want to see the failures too — an agent that only shows its wins reads like marketing.",
    },
    {
      author: "ux_for_ml",
      score: 22,
      snippet:
        "Streaming the reasoning is great until it scrolls forever. Collapse the noise, keep the decisions.",
    },
  ],
  "hn-mock-4": [
    {
      author: "json_schema_stan",
      score: 47,
      snippet:
        "Validate twice, log the diffs. The model drifts in ways your unit tests never anticipate.",
    },
  ],
  "hn-mock-5": [
    {
      author: "moat_inspector",
      score: 63,
      snippet:
        "The wrapper isn't the moat. The workflow you embed it in — and the data exhaust from that workflow — can be.",
    },
  ],
};
