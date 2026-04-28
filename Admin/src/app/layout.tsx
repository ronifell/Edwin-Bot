import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Bot Admin",
  description: "Admin panel for PostgreSQL lead records",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
