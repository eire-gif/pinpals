import type { ReactNode } from "react";

/**
 * The top of every admin page: a Playfair title, one short line saying what
 * the page is for, and the page's primary action(s) on the right.
 */
export default function AdminPageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** A small line above the title — a back link on detail pages. */
  eyebrow?: ReactNode;
}) {
  return (
    <div className="mb-6">
      {eyebrow && <div className="text-sm text-ink-500 mb-2">{eyebrow}</div>}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display font-bold text-2xl text-ink-900">{title}</h1>
          {description && <p className="text-sm text-ink-500 mt-1">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
      </div>
    </div>
  );
}
