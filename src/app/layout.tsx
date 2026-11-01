import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cover Story",
  description: "You are twelve, home alone, and the doorbell just went.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
