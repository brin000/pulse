"use server";

/**
 * Server Actions for topic subscriptions.
 *
 * Actions instead of an API route on purpose: every caller is our own UI
 * (the cockpit's Monitor button and the /topics management page), so the
 * typed function boundary is enough — no external contract to version.
 * All DB helpers swallow failures, so actions report status instead of
 * throwing; the UI degrades quietly, matching the persistence policy.
 */
import { revalidatePath } from "next/cache";
import { runGoalSchema } from "@/lib/agent/schemas";
import {
  createTopic,
  deleteTopic,
  findTopicByName,
  setTopicEnabled,
} from "@/lib/db";

export type SubscribeResult = "subscribed" | "already-subscribed" | "error";

/**
 * Subscribe a topic for daily monitoring. Dedupes case-insensitively on the
 * topic text — re-clicking the button (or re-running the same topic) must
 * not pile up duplicate subscriptions.
 */
export async function subscribeTopic(
  topicRaw: string,
  goalRaw: string,
): Promise<SubscribeResult> {
  const topic = topicRaw.trim().slice(0, 200);
  if (topic.length < 3) return "error";
  // Actions are a system boundary: never trust the client-supplied goal.
  const goal = runGoalSchema.safeParse(goalRaw);
  if (!goal.success) return "error";

  if (await findTopicByName(topic)) return "already-subscribed";
  const created = await createTopic(topic, goal.data);
  if (!created) return "error";
  revalidatePath("/topics");
  return "subscribed";
}

/** Whether a topic is already monitored — drives the button's initial state. */
export async function isTopicSubscribed(topic: string): Promise<boolean> {
  return (await findTopicByName(topic)) !== null;
}

/** Pause/resume a subscription from the /topics list. */
export async function toggleTopic(id: string, enabled: boolean): Promise<void> {
  await setTopicEnabled(id, enabled);
  revalidatePath("/topics");
}

/** Remove a subscription (and its seen-post dedup memory). */
export async function removeTopic(id: string): Promise<void> {
  await deleteTopic(id);
  revalidatePath("/topics");
}
