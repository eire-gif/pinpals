import Link from "next/link";

// Same tab-bar look as src/app/dashboard/listings/page.tsx's own inline
// implementation, pulled out here so both new workspace pages (and that one,
// if it's ever refactored to match) share one definition rather than a third
// copy accumulating. Always links to `${basePath}?tab=<key>` with no `page`
// param — switching tabs intentionally resets whichever tab's own list back
// to page 1, so a stale page number from one tab never carries into another.
export type WorkspaceTab = { key: string; label: string; count?: number };

export default function WorkspaceTabs({
  tabs,
  activeKey,
  basePath,
}: {
  tabs: WorkspaceTab[];
  activeKey: string;
  basePath: string;
}) {
  return (
    <div className="flex gap-1.5 border-b border-line mb-6 overflow-x-auto">
      {tabs.map((t) => {
        const isActive = t.key === activeKey;
        return (
          <Link
            key={t.key}
            href={`${basePath}?tab=${t.key}`}
            className={`shrink-0 px-4 py-2.5 text-sm font-bold border-b-2 transition ${
              isActive ? "border-green-700 text-green-700" : "border-transparent text-ink-500 hover:text-ink-900"
            }`}
          >
            {t.label} {t.count != null && <span className="text-xs font-semibold text-ink-500">({t.count})</span>}
          </Link>
        );
      })}
    </div>
  );
}
