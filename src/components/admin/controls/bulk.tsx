"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { bulkConfirmationPhrase, type ControlEntity, type MenuItem } from "@/lib/admin/controls";
import ConfirmDialog from "./confirm-dialog";

/**
 * Checkbox selection for an admin list, and the sticky bar that acts on it.
 *
 *   <BulkProvider>
 *     <SelectAll ids={[...]} />           (in the header)
 *     <SelectRow id={row.id} />           (in each row)
 *     <BulkBar entity="post" items={…} /> (once, anywhere inside)
 *   </BulkProvider>
 *
 * The list stays a Server Component; only these small pieces are client.
 * The bar offers both directions (Hide and Restore) because a selection can
 * mix states — the action skips rows already where they're being moved to,
 * and says how many it did.
 */

type Ctx = {
  selected: ReadonlySet<string>;
  toggle: (id: string, on: boolean) => void;
  setMany: (ids: readonly string[], on: boolean) => void;
  clear: () => void;
};

const SelectionContext = createContext<Ctx | null>(null);

export function BulkProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const toggle = useCallback((id: string, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  const setMany = useCallback((ids: readonly string[], on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);
  const clear = useCallback(() => setSelected(new Set()), []);

  const value = useMemo(() => ({ selected, toggle, setMany, clear }), [selected, toggle, setMany, clear]);
  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

function useSelection(): Ctx {
  const ctx = useContext(SelectionContext);
  if (!ctx) throw new Error("Bulk selection components must be inside <BulkProvider>.");
  return ctx;
}

const box = "w-4 h-4 rounded border-line accent-[var(--navy-900)] cursor-pointer";

export function SelectRow({ id, label }: { id: string | number; label?: string }) {
  const { selected, toggle } = useSelection();
  const key = String(id);
  return (
    <input
      type="checkbox"
      className={box}
      aria-label={label ?? `Select #${key}`}
      checked={selected.has(key)}
      onChange={(e) => toggle(key, e.target.checked)}
    />
  );
}

export function SelectAll({ ids }: { ids: readonly (string | number)[] }) {
  const { selected, setMany } = useSelection();
  const keys = ids.map(String);
  const all = keys.length > 0 && keys.every((k) => selected.has(k));
  const some = !all && keys.some((k) => selected.has(k));
  return (
    <input
      type="checkbox"
      className={box}
      aria-label="Select all on this page"
      checked={all}
      ref={(el) => {
        if (el) el.indeterminate = some;
      }}
      disabled={keys.length === 0}
      onChange={(e) => setMany(keys, e.target.checked)}
    />
  );
}

export function BulkBar({
  entity,
  items,
  noun,
  plural,
}: {
  entity: ControlEntity;
  items: readonly MenuItem[];
  noun: string;
  plural: string;
}) {
  const { selected, clear } = useSelection();
  const [active, setActive] = useState<MenuItem | null>(null);
  const close = useCallback(() => setActive(null), []);
  const count = selected.size;
  if (items.length === 0 || (count === 0 && !active)) return null;

  const ids = [...selected];
  const label = `${count} ${count === 1 ? noun : plural}`;

  return (
    <>
      <div className="sticky bottom-4 z-40 mt-4">
        <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-navy-900 text-cream-50 px-4 py-3 shadow-lg">
          <span className="text-sm font-bold mr-auto">{label} selected</span>
          {items.map((item) => (
            <button
              key={item.verb}
              type="button"
              onClick={() => setActive(item)}
              className={`px-3.5 py-1.5 rounded-full text-sm font-bold transition ${
                item.tone === "danger" ? "bg-red-600 text-cream-50 hover:opacity-90" : "bg-cream-50 text-navy-900 hover:bg-cream-100"
              }`}
            >
              {item.label}
            </button>
          ))}
          <button type="button" onClick={clear} className="px-3 py-1.5 rounded-full text-sm font-bold text-cream-100 hover:text-white">
            Clear
          </button>
        </div>
      </div>
      {active && (
        <ConfirmDialog
          entity={entity}
          item={active}
          ids={ids}
          noun={label}
          confirmText={bulkConfirmationPhrase(ids.length)}
          bulk
          onClose={close}
          onDone={clear}
        />
      )}
    </>
  );
}
