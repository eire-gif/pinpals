import type { ReactNode } from "react";
import Link from "next/link";

import { requireConsole } from "@/lib/society-console/access";
import { consoleNav, roleLabel } from "@/lib/society-console/rules";
import ConsoleNav from "./console-nav";

// Private to the committee, per member: never prerendered or shared-cached.
export const dynamic = "force-dynamic";

/**
 * The society console's frame: a photographic banner with the society's
 * name and your office, then the sidebar of tools you have. The layout's own
 * check keeps the frame from drawing for anyone not on the committee; every
 * page checks again for its own area, and every action checks on each call.
 */
export default async function SocietyConsoleLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireConsole(id);
  const { society } = ctx;
  const sections = consoleNav(society.id, ctx.role, ctx.areas);

  return (
    <div className="min-h-screen bg-cream-50">
      <header className="relative overflow-hidden bg-navy-900 text-cream-50">
        {society.coverUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={society.coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-35" />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-navy-900 via-navy-900/85 to-navy-900/40" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 flex items-center gap-4">
          {society.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={society.logoUrl} alt="" className="h-14 w-14 sm:h-16 sm:w-16 rounded-2xl object-cover bg-cream-50 shrink-0 ring-2 ring-gold-500/60" />
          ) : (
            <span className="h-14 w-14 sm:h-16 sm:w-16 rounded-2xl bg-gold-500 text-navy-900 font-display font-bold text-2xl inline-flex items-center justify-center shrink-0">
              {society.name.slice(0, 1).toUpperCase()}
            </span>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-gold-400">
              <span className="w-5 h-0.5 bg-gold-500 inline-block" /> Society admin
            </div>
            <h1 className="font-display font-bold text-2xl sm:text-3xl truncate">{society.name}</h1>
            <p className="text-sm text-cream-50/80">
              {roleLabel(ctx.role, ctx.office)} · {society.memberCount} member{society.memberCount === 1 ? "" : "s"}
              {society.clubName ? ` · ${society.clubName}` : ""}
            </p>
          </div>
          <Link href="/society" className="ml-auto hidden sm:inline-block text-sm font-semibold text-cream-50/80 hover:text-cream-50">
            All my societies
          </Link>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 md:py-8 grid gap-4 md:grid-cols-[210px_minmax(0,1fr)] md:gap-8">
        <ConsoleNav sections={sections} />
        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}
