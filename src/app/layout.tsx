import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AtliQ Contract Risk Analyzer",
  description: "AI review assistant for AtliQ contracts — not legal advice.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
