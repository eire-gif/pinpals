"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { activeConsoleHref, type ResolvedNavSection } from "@/lib/society-console/rules";

function Links({ sections, active, onPick }: { sections: readonly ResolvedNavSection[]; active: string | null; onPick?: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      {sections.map((section) => (
        <div key={section.title ?? "top"}>
          {section.title && <div className="px-3 mb-1 text-[11px] font-bold uppercase tracking-[0.08em] text-ink-500">{section.title}</div>}
          <ul className="flex flex-col gap-0.5">
            {section.items.map((item) => {
              const isActive = item.href === active;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onPick}
                    aria-current={isActive ? "page" : undefined}
                    className={`block px-3 py-1.5 rounded-lg text-sm transition ${isActive ? "bg-navy-900 text-cream-50 font-semibold" : "text-ink-900 hover:bg-cream-100"}`}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** The console sidebar; on a phone, a Menu button above the page. */
export default function ConsoleNav({ sections }: { sections: readonly ResolvedNavSection[] }) {
  const pathname = usePathname() ?? "";
  const active = activeConsoleHref(pathname, sections);
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const current = sections.flatMap((s) => s.items).find((i) => i.href === active);
  return (
    <>
      <div className="md:hidden">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpenOn(open ? null : pathname)}
          className="w-full flex items-center justify-between rounded-xl border border-line bg-surface px-4 py-2.5 text-sm font-semibold"
        >
          <span>{current?.label ?? "Menu"}</span>
          <span className="text-ink-500">{open ? "Close" : "Menu"}</span>
        </button>
        {open && (
          <nav aria-label="Society" className="mt-2 rounded-xl border border-line bg-surface p-3">
            <Links sections={sections} active={active} onPick={() => setOpenOn(null)} />
          </nav>
        )}
      </div>
      <nav aria-label="Society" className="hidden md:block sticky top-6 self-start">
        <Links sections={sections} active={active} />
      </nav>
    </>
  );
}
