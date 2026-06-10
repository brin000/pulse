# Start with a Curated Subreddit Whitelist

Pulse will start with a curated whitelist of subreddits relevant to indie developers, AI tooling, and web development instead of searching all of Reddit. This keeps MVP demo quality stable, makes result evaluation more consistent, and leaves broader subreddit discovery as a future agent decision based on topic context.

## Consequences

The MVP may miss useful conversations outside the whitelist, but the first version prioritizes reliable signal over broad coverage. The whitelist should be represented as a typed `as const` config so tool inputs can be constrained by TypeScript and Zod.
