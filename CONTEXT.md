# Pulse

Pulse helps developers show up in the right Reddit conversations, at the right time, with something worth saying. The context centers on building developer presence through reviewable drafts, not on automatically posting content.

## Language

**Indie Developer**:
The primary user: a solo or small-team builder who shares product progress and participates in communities directly.
_Avoid_: Generic creator, marketer

**Build in Public**:
An ongoing practice where an indie developer shares progress, lessons, and asks in public communities while building a product.
_Avoid_: Content marketing, social media posting

**Developer Presence**:
The reputation and familiarity an indie developer builds by repeatedly contributing useful replies in relevant communities.
_Avoid_: Personal brand, audience growth

**Discussion Window**:
The short period when a Reddit thread is active enough that a thoughtful reply can still be noticed and useful.
_Avoid_: Posting time, trend window

**Right Time**:
In the MVP, the right time means the on-demand agent finds a thread that is still active enough to join when the user runs Pulse. It does not mean scheduled monitoring or notifications.
_Avoid_: Automatic alert, best posting time

**Conversation Worth Joining**:
A Reddit discussion that is relevant to the indie developer's topic, currently active, and has a missing angle the developer can credibly add.
_Avoid_: Viral post, content opportunity

**Read the Room**:
Understanding a Reddit thread's tone, norms, and current discussion shape before deciding what kind of contribution would be welcome.
_Avoid_: Sentiment analysis, tone detection

**Reviewable Draft**:
A suggested Reddit reply or post that the user reviews and copies manually; Pulse does not publish it automatically.
_Avoid_: Auto-post, generated content

**First Real Test Case**:
Pulse's initial real-world use: finding conversations about AI agent development while the indie developer builds Pulse in public.
_Avoid_: Demo scenario, fake case study

**Worth Posting**:
A reviewable draft is worth posting when the indie developer would be willing to manually edit and publish it in the target Reddit thread.
_Avoid_: High-upvote prediction, engagement guarantee

**Stealth Marketing**:
Content that disguises product promotion as a helpful Reddit reply. Pulse should help the user write something worth posting, not smuggle in a pitch.
_Avoid_: Subtle promotion, product plug

**On-Demand Agent**:
The MVP interaction model: the indie developer enters a topic, then Pulse scans Reddit and drafts reviewable replies for that session.
_Avoid_: Scheduled monitor, background notification agent

**Session-Local Run**:
A Pulse run that exists only in the current browser session; the user can review and copy drafts, but Pulse does not persist run history in the MVP.
_Avoid_: Saved history, persistent memory

**Comment Reply**:
The only draft type in the MVP: a reply to an existing Reddit thread that responds to the current discussion and fills a missing angle.
_Avoid_: Standalone post, generic content draft

**Agent Cockpit**:
The MVP interface style: a clear developer-tool view of the agent's execution timeline, selected thread, content gap, and reviewable drafts.
_Avoid_: Landing page, visual showcase

## Example Dialogue

Developer: "I keep missing the discussion window on Reddit when I build in public."

Domain Expert: "So Pulse should help build developer presence by finding conversations worth joining and preparing reviewable drafts, but the indie developer still decides whether to post."

Developer: "The first real test case can be Pulse itself: finding AI agent development discussions while I build it."

Domain Expert: "Then the first success standard is not upvotes. It is whether Pulse finds a live thread, explains the missing angle, and drafts something worth posting manually."

Developer: "Pulse should not start as a scheduled monitor. The first version runs on demand when I enter a topic."

Domain Expert: "Then 'right time' means finding threads that are still active during an on-demand run, not notifying me in the background."

Domain Expert: "The MVP should draft comment replies only, because replying forces Pulse to read the room and understand the current thread."

Developer: "Pulse does not need saved history in the MVP. Each run can be session-local."

Developer: "The first UI should be an agent cockpit, not a polished marketing page."

Domain Expert: "Pulse should help write replies worth posting, not stealth marketing. Mentioning the user's own project should be the exception, not the default."
