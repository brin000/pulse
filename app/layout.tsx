import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pulse — join the right Reddit conversations in time",
  description:
    "Pulse helps developers show up in the right Reddit conversations, at the right time, with something worth saying. An on-demand AI agent with a fully observable decision loop.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh font-sans antialiased">{children}</body>
    </html>
  );
}
