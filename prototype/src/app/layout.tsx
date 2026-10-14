import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";
import { UserMenu, UserProvider } from "@/components/UserProvider";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "AtliQ Contract Risk Analyzer",
  description: "AI review assistant for AtliQ contracts — not legal advice.",
};

const TODAY = process.env.DATASET_TODAY || "2026-09-28";

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) {
    // only the login page renders without a session (middleware redirects everything else)
    return (
      <html lang="en">
        <body className="antialiased">{children}</body>
      </html>
    );
  }
  const user = { username: session.u, name: session.n, title: session.t, role: session.r };
  return (
    <html lang="en">
      <body className="antialiased">
        <UserProvider user={user}>
          <div className="flex min-h-screen">
            <Sidebar />
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="no-print flex items-center justify-between gap-4 border-b border-amber-200 bg-amber-50 px-5 py-1.5 text-xs text-amber-900">
                <span>
                  <strong className="font-semibold">Review assistant — not legal advice.</strong> Final decision rests with the authorised signer. The AI never approves, rejects, signs or sends
                  anything. <span className="text-amber-800/70">· Dataset date {TODAY}</span>
                </span>
                <UserMenu />
              </div>
              <main className="min-w-0 flex-1">{children}</main>
            </div>
          </div>
        </UserProvider>
      </body>
    </html>
  );
}
