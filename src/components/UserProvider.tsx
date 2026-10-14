"use client";

import { createContext, useContext } from "react";
import { setCurrentUser } from "@/lib/client/store";
import type { Role } from "@/lib/auth/session";

export interface CurrentUser {
  username: string;
  name: string;
  title: string;
  role: Role;
}

const Ctx = createContext<CurrentUser | null>(null);

export function UserProvider({ user, children }: { user: CurrentUser; children: React.ReactNode }) {
  setCurrentUser(user); // reviewer actions and the audit trail record who actually acted
  return <Ctx.Provider value={user}>{children}</Ctx.Provider>;
}

export function useCurrentUser(): CurrentUser | null {
  return useContext(Ctx);
}

export function UserMenu() {
  const user = useCurrentUser();
  if (!user) return null;
  return (
    <span className="flex shrink-0 items-center gap-3 text-amber-800/90">
      <span>
        Signed in as <strong className="font-semibold">{user.name}</strong> ({user.title})
      </span>
      <button
        onClick={async () => {
          await fetch("/api/auth/logout", { method: "POST" });
          window.location.href = "/login";
        }}
        className="rounded border border-amber-300 bg-white px-2 py-0.5 text-[11px] font-medium text-amber-900 hover:bg-amber-100"
      >
        Sign out
      </button>
    </span>
  );
}
