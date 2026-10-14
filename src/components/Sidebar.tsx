"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useStored } from "@/lib/client/store";

const NAV = [
  { href: "/", label: "Review queue", icon: "M4 6h16M4 12h16M4 18h10" },
  { href: "/register", label: "Commitments register", icon: "M9 12l2 2 4-4M7 4h10a2 2 0 012 2v14l-7-3-7 3V6a2 2 0 012-2z" },
  { href: "/precedents", label: "Precedents", icon: "M12 6v6l4 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
  { href: "/rules", label: "Rules", icon: "M9 5h11M9 12h11M9 19h11M4 5h.01M4 12h.01M4 19h.01" },
  { href: "/library", label: "Signed library", icon: "M4 19.5A2.5 2.5 0 016.5 17H20M4 19.5V5a2 2 0 012-2h14v14M4 19.5A2.5 2.5 0 006.5 22H20v-5" },
  { href: "/audit", label: "Reports & audit", icon: "M9 17v-6m4 6V7m4 10v-3M5 21h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2z" },
];

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0">
      <path d={d} />
    </svg>
  );
}

export function Sidebar() {
  const path = usePathname();
  const [collapsed, setCollapsed] = useStored<boolean>("ui.navCollapsed", false);
  return (
    <aside className={`no-print sticky top-0 flex h-screen shrink-0 flex-col border-r border-slate-200 bg-white transition-all ${collapsed ? "w-16" : "w-60"}`}>
      <div className="flex items-center justify-between px-4 pb-3 pt-4">
        {!collapsed && (
          <Link href="/" className="leading-tight">
            <div className="text-[15px] font-semibold text-slate-900">AtliQ</div>
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Contract Risk Analyzer</div>
          </Link>
        )}
        <button onClick={() => setCollapsed(!collapsed)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Collapse navigation" title={collapsed ? "Expand" : "Collapse"}>
          {collapsed ? "»" : "«"}
        </button>
      </div>
      <div className="px-3 pb-3">
        <Link
          href="/review/new"
          className="flex items-center justify-center gap-2 rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700"
          title="New review"
        >
          <span className="text-base leading-none">+</span>
          {!collapsed && "New review"}
        </Link>
      </div>
      <nav className="flex-1 space-y-0.5 px-2">
        {NAV.map((n) => {
          const active = n.href === "/" ? path === "/" || path.startsWith("/review") : path.startsWith(n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              title={n.label}
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm ${active ? "bg-brand-50 font-medium text-brand-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"}`}
            >
              <Icon d={n.icon} />
              {!collapsed && n.label}
            </Link>
          );
        })}
      </nav>
      {!collapsed && (
        <div className="border-t border-slate-100 p-4 text-[11px] leading-snug text-slate-400">
          Capstone prototype on a synthetic dataset. Humans confirm findings, decide and sign.
        </div>
      )}
    </aside>
  );
}
