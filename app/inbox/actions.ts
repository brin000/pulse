"use server";

/**
 * Server Actions for the notification inbox. Same rationale as the topics
 * actions: internal UI callers only, so typed actions beat an API route.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { markNotificationRead } from "@/lib/db";

/** Mark one notification read in place (the inbox row's explicit button). */
export async function markRead(id: string): Promise<void> {
  await markNotificationRead(id);
  revalidatePath("/inbox");
  revalidatePath("/");
}

/**
 * Open a notification: mark it read, then jump to the run it points at.
 * One action so "I looked at it" and "it stops counting as unread" can
 * never drift apart.
 */
export async function openNotification(id: string, runId: string): Promise<void> {
  await markNotificationRead(id);
  revalidatePath("/inbox");
  revalidatePath("/");
  redirect(`/history/${runId}`);
}
