/**
 * Home page — a thin Server Component shell around the client cockpit.
 *
 * Exists as a server boundary for one reason: the inbox badge in the header
 * must come from a real database query (unread notification count), and the
 * cockpit itself is necessarily a client component (SSE streaming state).
 */
import { countUnreadNotifications } from "@/lib/db";
import { HomeCockpit } from "@/components/HomeCockpit";

// Reads the database per request; the badge must never be statically cached.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const unreadCount = await countUnreadNotifications();
  return <HomeCockpit unreadCount={unreadCount} />;
}
