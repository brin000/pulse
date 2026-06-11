# ADR 0005: Multi-platform support (Reddit + Hacker News)

Status: accepted (Phase 5)

## Context

Pulse started Reddit-only. Phase 5.1 extracted the `PlatformAdapter` seam
(`lib/platforms/types.ts`) so the agent core no longer knows platform
specifics. This ADR records the decisions behind the first second platform.

## Decision 1: Hacker News as the second platform

- **Public API, no auth**: the Algolia HN search API (`hn.algolia.com/api/v1`)
  requires no credentials, no OAuth dance and has generous limits — the
  adapter is pure `fetch`, deployable anywhere. Reddit's auth story (ADR
  context: anonymous access blocked from data-center IPs) made this the main
  selection criterion.
- **Audience overlap**: Pulse's target user (indie developer building in
  public) lives on both sites. HN adds the startup/founder/Show-HN audience
  the subreddit whitelist doesn't cover.

## Decision 2: id namespace prefix ("hn-")

HN item ids are numeric and Reddit ids are base36 — they could collide.
The HN adapter prefixes every post id with `hn-` at compression time and
strips it before calling the API. Consequences:

- `seen_posts` (cron dedup) stays a flat id set with no platform column.
- `excludePostIds` filtering needs no platform awareness.
- Comment fetching can route by the post already in context; ids stay
  globally unique across platforms for free.

## Decision 3: HN "communities" are its sections

HN has no sub-forums. Pulse maps the community concept onto the three
sections that matter for posting decisions: `story`, `ask-hn`, `show-hn`
(Algolia tags `story` / `ask_hn` / `show_hn`). This keeps every platform
behind the same `communities` whitelist + `communityNorms` interface — the
norms differ per section (Show HN wants a demo, Ask HN wants first-hand
answers), exactly like subreddits differ in tone.

## Decision 4: the agent picks the platform

Platform choice is an agent decision, not a user setting. `search_threads`,
`check_community_norms` and `draft_standalone_post` carry a `platform` field
in their model-provided input; the runtime validates that the communities
belong to that platform (the two-layer validation now cross-checks the pair)
and routes through the registry. The decision prompt instructs the model to
pick the platform whose audience fits the topic and to say why in the search
step's reason — platform choice becomes visible agent reasoning in the
timeline instead of a dropdown.

## Compatibility notes

- Tool renames (`search_reddit` → `search_threads`, `get_post_comments` →
  `get_thread_comments`, `check_subreddit_rules` → `check_community_norms`)
  are mapped for persisted events via `canonicalToolName`; stored events are
  never rewritten.
- Persisted result JSON predating the `platform`/`community` fields is
  upgraded at the DB read boundary (`upgradeLegacyResult`), defaulting to
  Reddit — which is factually correct for every pre-P5 run.
- `PULSE_MOCK_HN=1` pins the HN adapter to mock data, mirroring
  `PULSE_MOCK_REDDIT=1`; both adapters also fall back to mock on API failure.
