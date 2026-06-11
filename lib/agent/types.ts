/**
 * Runtime types shared by the orchestrator, the API route and the UI.
 * (Model-facing shapes live in schemas.ts; these are runtime/UI shapes.)
 */
import type {
  CommentSummary,
  ContentGap,
  Draft,
  PostSummary,
  QualityEvaluation,
  RunGoal,
  StandalonePost,
  SubredditRules,
  ToolName,
} from "@/lib/agent/schemas";

/**
 * The agent's working memory for a single run.
 *
 * This object is what gets "compressed": tool results are reduced to summaries
 * before being stored, and `compressAndUpdateContext` trims lists so each
 * subsequent LLM call stays small. It lives only for the request — runs are
 * session-local by design (no persistence in the MVP).
 */
export interface AgentContext {
  topic: string;
  /** What the user asked for: reply drafts, an original post, or auto-pivot. */
  goal: RunGoal;
  /**
   * Whether this run uses mock LLM decisions. Decided per request by the API
   * route (no API key, PULSE_MOCK, or an unauthorized visitor on a gated
   * deployment) — never read from global env below the route layer.
   */
  mockLlm: boolean;
  /** Iterations executed so far (bounded by AGENT_LIMITS.maxSteps). */
  steps: number;
  searchAttempts: number;
  draftAttempts: number;
  /** Compressed search results (capped at maxPostsInContext). */
  posts: PostSummary[];
  quality: QualityEvaluation | null;
  /** Thread the agent committed to replying in. */
  selectedPost: PostSummary | null;
  comments: CommentSummary[];
  gap: ContentGap | null;
  rules: SubredditRules | null;
  drafts: Draft[];
  /** Original post draft (post goal, or the auto-goal pivot output). */
  standalonePost: StandalonePost | null;
  /** Whether the data behind this run came from the live Reddit API or mocks. */
  dataSource: "live" | "mock" | null;
  /** Validation/tool failures, kept so the model can react to them. */
  failures: string[];
  /**
   * Post ids the run must never surface (cron dedup: threads already
   * recommended for this topic). Applied inside the search_reddit executor —
   * BEFORE quality scoring — so an excluded post can't even become a
   * candidate. Empty/undefined for manual cockpit runs.
   */
  excludePostIds?: string[];
}

/** A single entry on the streaming timeline. One SSE message per event. */
export interface TimelineEvent {
  id: string;
  type:
    | "run_start"
    | "decision"
    | "tool_start"
    | "tool_result"
    | "tool_error"
    | "finish"
    | "error";
  /** Short human-readable headline, e.g. "search_reddit". */
  title: string;
  /**
   * Structured link to the tool a tool_* event belongs to. The UI matches on
   * this field (icons, pipeline progress) — titles are display copy only and
   * must never be parsed.
   */
  tool?: ToolName;
  /** The model's `reason` — the "why" behind the step. */
  reason?: string;
  /** Small structured payload for richer rendering (counts, scores, ...). */
  detail?: string;
  timestamp: string;
}

/** Final payload sent on the `result` SSE event when a run completes. */
export interface RunResult {
  /**
   * Terminal verdict of the run. "failed" covers the explicit `fail` action,
   * decision errors, cancellation and the step cap — anything that ended the
   * loop abnormally. A finish with zero drafts still counts as "success";
   * the UI explains the empty result separately.
   */
  outcome: "success" | "failed";
  topic: string;
  selectedPost: PostSummary | null;
  gap: ContentGap | null;
  rules: SubredditRules | null;
  drafts: Draft[];
  /** Original post draft, when the run produced one instead of (or beyond) replies. */
  standalonePost: StandalonePost | null;
  dataSource: "live" | "mock" | null;
  steps: number;
}
