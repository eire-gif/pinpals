"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ControlEntity, MenuItem } from "@/lib/admin/controls";
import ConfirmDialog from "./confirm-dialog";

/**
 * The "…" menu on every admin list row, and (variant="buttons") the actions
 * panel on every detail page. The Server Component works out which items the
 * viewer may use for this row (menuFor() in src/lib/admin/controls.ts) and
 * passes them in; every item opens the same ConfirmDialog, and the Server
 * Action re-checks everything.
 */
export default function AdminRowActions({
  entity,
  id,
  noun,
  confirmName,
  items,
  editHref,
  viewHref,
  variant = "menu",
  redirectAfterDelete,
}: {
  entity: ControlEntity;
  id: string | number;
  /** e.g. "post", "listing" — for the dialog heading. */
  noun: string;
  /** What to type to confirm a permanent delete (confirmationName()). */
  confirmName: string;
  items: readonly MenuItem[];
  editHref?: string | null;
  viewHref?: string | null;
  variant?: "menu" | "buttons";
  /** On a detail page: where to go once the record is deleted. */
  redirectAfterDelete?: string | null;
}) {
  // Where the open menu sits. Fixed to the viewport rather than absolute,
  // because list tables scroll sideways on a phone and an absolute menu
  // would be clipped by that scroll container.
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const open = pos !== null;
  const [active, setActive] = useState<MenuItem | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setActive(null), []);
  const setOpen = useCallback((next: boolean) => {
    const rect = button.current?.getBoundingClientRect();
    setPos(next && rect ? { top: rect.bottom + 4, right: Math.max(8, window.innerWidth - rect.right) } : null);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onMove = () => setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, setOpen]);

  const dialog = active && (
    <ConfirmDialog
      entity={entity}
      item={active}
      ids={[id]}
      confirmText={confirmName}
      noun={`this ${noun}`}
      onClose={close}
      redirectAfterDelete={redirectAfterDelete}
    />
  );

  if (variant === "buttons") {
    if (!editHref && items.length === 0) {
      return <p className="text-sm text-ink-500">Your role can view this {noun} but not change it.</p>;
    }
    return (
      <div className="flex flex-wrap gap-2">
        {editHref && (
          <Link href={editHref} className="px-4 py-2 rounded-full text-sm font-bold border-[1.5px] border-line hover:bg-cream-100 transition">
            Edit
          </Link>
        )}
        {items.map((item) => (
          <button
            key={item.verb}
            type="button"
            onClick={() => setActive(item)}
            className={`px-4 py-2 rounded-full text-sm font-bold transition ${
              item.tone === "danger"
                ? "border-[1.5px] border-red-600 text-red-600 hover:bg-red-100"
                : "bg-navy-900 text-cream-50 hover:bg-navy-800"
            }`}
          >
            {item.label}
          </button>
        ))}
        {dialog}
      </div>
    );
  }

  if (!editHref && !viewHref && items.length === 0) return null;

  return (
    <div ref={wrap} className="relative inline-block text-left">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for this ${noun}`}
        ref={button}
        onClick={() => setOpen(!open)}
        className="w-8 h-8 rounded-full grid place-items-center text-ink-500 hover:bg-cream-100 hover:text-ink-900 transition font-bold"
      >
        ⋯
      </button>
      {pos && (
        <div
          role="menu"
          style={{ top: pos.top, right: pos.right }}
          className="fixed z-50 min-w-[190px] max-h-[60vh] overflow-y-auto rounded-xl border border-line bg-surface shadow-lg py-1 text-sm"
        >
          {viewHref && (
            <Link role="menuitem" href={viewHref} className="block px-4 py-2 hover:bg-cream-100" onClick={() => setOpen(false)}>
              Open
            </Link>
          )}
          {editHref && (
            <Link role="menuitem" href={editHref} className="block px-4 py-2 hover:bg-cream-100" onClick={() => setOpen(false)}>
              Edit
            </Link>
          )}
          {items.map((item) => (
            <button
              key={item.verb}
              role="menuitem"
              type="button"
              onClick={() => {
                setOpen(false);
                setActive(item);
              }}
              className={`block w-full text-left px-4 py-2 hover:bg-cream-100 ${
                item.tone === "danger" ? "text-red-600 border-t border-line mt-1 pt-2" : ""
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
      {dialog}
    </div>
  );
}
