/**
 * Deterministic mock Reddit data.
 *
 * Used when PULSE_MOCK_REDDIT=1 or when the live Reddit API is unreachable.
 * The data is shaped exactly like compressed live data and is always labeled
 * `source: "mock"` so the UI can show a badge ? demo data is never passed off
 * as real.
 */
import type { CommentSummary, PostSummary } from "@/lib/agent/schemas";

export const MOCK_POSTS: PostSummary[] = [
  {
    id: "mock-1",
    platform: "reddit",
    community: "LocalLLaMA",
    title:
      "What does your agent harness actually do besides calling the model in a loop?",
    score: 412,
    numComments: 87,
    ageHours: 5,
    url: "https://www.reddit.com/r/LocalLLaMA/comments/mock-1",
    snippet:
      "Everyone says they built an 'agent' but most repos I read are a while-loop around a chat completion. What does real control look like: validation, termination, context management?",
  },
  {
    id: "mock-2",
    platform: "reddit",
    community: "nextjs",
    title: "Streaming tool-call progress to the client: SSE or the AI SDK hooks?",
    score: 156,
    numComments: 34,
    ageHours: 9,
    url: "https://www.reddit.com/r/nextjs/comments/mock-2",
    snippet:
      "Building an AI feature in App Router. Should I hand-roll Server-Sent Events from a route handler or rely on the SDK's hooks? I want to show each tool call as it happens.",
  },
  {
    id: "mock-3",
    platform: "reddit",
    community: "SideProject",
    title: "I keep missing the window to join discussions relevant to my product",
    score: 73,
    numComments: 21,
    ageHours: 14,
    url: "https://www.reddit.com/r/SideProject/comments/mock-3",
    snippet:
      "By the time I find the right thread and write something thoughtful, the conversation is dead. How do you all stay present in your communities while actually building?",
  },
  {
    id: "mock-4",
    platform: "reddit",
    community: "webdev",
    title: "Are structured outputs finally good enough to build on?",
    score: 240,
    numComments: 52,
    ageHours: 30,
    url: "https://www.reddit.com/r/webdev/comments/mock-4",
    snippet:
      "Schema-constrained generation seems mature now. Anyone shipping production features that depend on the model returning valid JSON every time?",
  },
];

export const MOCK_COMMENTS: Record<string, CommentSummary[]> = {
  "mock-1": [
    {
      author: "runtime_skeptic",
      score: 96,
      snippet:
        "The loop is the easy part. The hard part is deciding when to STOP. Most agents either run forever or quit after one step.",
    },
    {
      author: "tokens_are_money",
      score: 71,
      snippet:
        "Context management is underrated. If you dump raw API responses into the prompt you blow the budget by step 3.",
    },
    {
      author: "claude_enjoyer",
      score: 44,
      snippet:
        "Tool boundaries matter more than prompts. One mega-tool = pipeline. Small composable tools = actual agency.",
    },
  ],
  "mock-2": [
    {
      author: "edge_runtime_fan",
      score: 28,
      snippet:
        "Hand-rolled SSE is 40 lines and you understand every byte. The hooks are great until you need custom event types.",
    },
    {
      author: "app_router_dev",
      score: 19,
      snippet: "ReadableStream from a route handler works fine. Just remember the headers.",
    },
  ],
  "mock-3": [
    {
      author: "shipit_sarah",
      score: 15,
      snippet: "I block 30 minutes every morning for Reddit and still miss the good threads.",
    },
  ],
  "mock-4": [
    {
      author: "json_or_bust",
      score: 33,
      snippet: "Validate twice. The SDK validates the shape but your runtime should re-check before acting.",
    },
  ],
};
