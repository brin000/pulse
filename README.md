# Pulse

Pulse helps developers show up in the right developer conversations, at the right time, with something worth saying.

Pulse is an on-demand AI agent that helps an indie developer build presence on Reddit and Hacker News by finding timely conversations and drafting useful comment replies. The agent decides per run which platform fits the topic — and explains why on the live timeline (docs/adr/0005-multi-platform.md).

Status: MVP in progress.

## Getting Started

```bash
npm install
npm run dev          # http://localhost:3000
```

Pulse runs in **mock mode** out of the box: the full agent loop (orchestrator,
validation, SSE timeline, UI) works with deterministic decisions and canned
data — no API key required. To run with live Claude decisions:

```bash
cp .env.example .env.local   # then set ANTHROPIC_API_KEY
```

Reddit data is fetched via OAuth (script-app credentials, see `.env.example`);
without credentials Pulse degrades to the anonymous public endpoint and
ultimately to mock data. Hacker News data comes from the public Algolia API
(no credentials needed). If either platform is unreachable, Pulse falls back
to mock data and labels it as such in the UI (`PULSE_MOCK_REDDIT=1` /
`PULSE_MOCK_HN=1` pin the fallback for deterministic demos).

## Why I Am Building This

I'm a developer trying to build in public. I know I should be joining relevant Reddit discussions to build presence, but every attempt turns into the same slow loop: find the right thread, read the room, and write something that does not sound like spam. By the time I finish, the conversation is often already dead.

So I am building Pulse to solve my own problem.

The first version keeps publishing manual by design: Pulse finds the opportunity, reads the room, drafts options, and I decide what to post.

## Current Scope

What Pulse does today (matching the Roadmap below):

- On-demand runs: enter a topic and watch the agent work on a live timeline.
- Comment reply drafts for existing Reddit and Hacker News threads, plus standalone post generation (explicit goal or auto-pivot when no thread is worth joining).
- Multi-platform: the agent decides per run whether Reddit or Hacker News fits the topic.
- Scheduled monitoring: topic subscriptions re-run daily via cron, with dedup, budget guardrails, in-app notifications and optional email.
- Persistent run history: every run is saved to a libsql database and replayable from /history.
- Manual review: Pulse never posts automatically.
- Agent cockpit UI: the interface shows what the agent is doing, not just the final answer.

Still out of scope:

- Auto-posting (deliberate: publishing stays manual)
- Platforms beyond Reddit and Hacker News

## First Real Test Case

Pulse's first real test case is Pulse itself:

> Use Pulse to find Reddit conversations about practical AI agent development while building Pulse in public.

The first success standard is not upvotes. Pulse succeeds when it finds a live, relevant thread that is still active enough to join, explains why it is worth joining, identifies the missing angle, and drafts a reply I would be willing to manually edit and post.

## Agent Architecture

Pulse is not designed as a fixed pipeline, and it does not hand the whole loop to an automatic tool-calling runner. Pulse uses Vercel AI SDK's built-in provider support, model calls, and streaming primitives, while the server-side orchestrator owns the agent loop.

The orchestrator controls:

- Tool input and output validation
- Tool execution
- Retry limits
- Termination conditions
- Context compression
- Server-Sent Events timeline updates

This means Claude makes local decisions, but the runtime controls whether those decisions are valid, what gets executed, how context changes, and when the loop stops.

The model returns a structured `AgentDecision` on each step. Pulse uses Vercel AI SDK's `generateObject` with a Zod schema instead of asking the model to produce free-form JSON:

```ts
type AgentDecision = {
  action: "call_tool" | "finish" | "fail";
  toolName?: ToolName;
  input?: unknown;
  reason: string;
};
```

Even after `generateObject` validates the model output, the orchestrator re-validates the decision's tool name and input arguments against the tool's own schema before execution — that is where the danger lives. Pulse treats model output as untrusted until it passes the runtime boundary.

The `reason` field drives the streaming timeline. The UI should show not only what the agent did, but why it made each decision.

Planned loop:

```text
User enters a topic
        |
        v
Server-side orchestrator starts
        |
        v
Model returns an AgentDecision
        |
        v
Validate decision with Zod
        |
        v
Execute selected tool
        |
        v
Validate tool result with Zod
        |
        v
Emit SSE timeline event
        |
        v
Compress and update context
        |
        v
Continue, retry, or terminate
        |
        v
User reviews and copies final draft manually
```

Core structure:

```ts
while (!terminated) {
  const decision = await decideNextAction(context);
  const validDecision = validateToolDecision(decision);

  const result = await executeTool(validDecision);
  const validResult = validateToolResult(validDecision.tool, result);

  emitTimelineEvent(validDecision, validResult);

  context = compressAndUpdateContext(context, validDecision, validResult);
  terminated = shouldTerminate(context, validResult, iteration);
}
```

## Tool Design

Each tool has one job:

- `search_threads`: fetch relevant threads by platform, keyword, and community.
- `evaluate_result_quality`: score relevance, recency, and discussion activity.
- `get_thread_comments`: fetch top comments only for promising threads.
- `evaluate_content_gap`: identify what useful angle is missing from the discussion.
- `check_community_norms`: help avoid replies that violate community tone or rules.
- `draft_comment_reply`: produce reviewable comment drafts.
- `draft_standalone_post`: draft an original post for a target community.

The MVP starts with a curated subreddit whitelist for indie developer and AI tooling topics:

```ts
export const SUBREDDIT_WHITELIST = [
  "webdev",
  "nextjs",
  "SideProject",
  "indiehackers",
  "SaaS",
  "artificial",
  "LocalLLaMA",
] as const;

export type Subreddit = typeof SUBREDDIT_WHITELIST[number];
```

This is deliberate: a small whitelist keeps demo quality stable and result evaluation consistent. Future versions can make subreddit discovery an agent decision based on topic context.

All tool inputs and outputs will be validated with Zod schemas before the agent executes or consumes them. This keeps the tool boundary explicit instead of treating model-generated arguments as trusted data.

The point is not just to generate text. The point is to give the model enough structured control to search, inspect, reason, and revise without hiding the process.

## Drafting Rules

Pulse's goal is to help the user write something worth posting, not to create stealth marketing.

The system prompt should enforce this default:

- Do not mention the user's own project by default.
- Mention the user's project only when the thread explicitly asks for examples, tools, personal projects, or lived experience.
- When project context is relevant, frame it as experience, not promotion.
- Prefer practical lessons, specific trade-offs, and useful context over product pitching.

## Engineering Focus

Pulse is meant to demonstrate agent runtime and product engineering skills:

- Vercel AI SDK's built-in provider support for model switching
- Context compression before LLM calls
- Tool boundaries that let the model compose behavior
- Structured `AgentDecision` schema with decision reasons
- `generateObject` for schema-constrained model decisions
- Two-layer validation before tool execution
- Zod schema validation for tool inputs and outputs
- Typed curated subreddit whitelist for MVP search quality
- Loop termination and retry limits
- Streaming tool-call visibility through a small Server-Sent Events layer
- Server-side API key handling
- A clear UI for non-deterministic agent execution

## Tech Stack

- Next.js 14 App Router
- TypeScript
- Tailwind CSS
- Vercel AI SDK
- Anthropic Claude API with tool calling and streaming
- Zod
- Reddit public API
- Vercel

## Roadmap

- [x] Mock agent loop with visible timeline
- [x] Real Reddit search (with disclosed mock fallback)
- [x] Top comment fetching
- [x] Context compression
- [x] Content gap evaluation
- [x] Reviewable comment reply drafts
- [x] Standalone post generation
- [x] Scheduled monitoring
- [x] Multi-platform support (Reddit + Hacker News, agent-chosen per run)
- [ ] Vercel deployment
- [ ] Real dogfooding case

## Honesty Note

Pulse is still being built. This README will not include a usage case until I have actually used Pulse on a real Reddit thread.
