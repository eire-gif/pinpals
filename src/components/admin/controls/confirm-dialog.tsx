"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { runControl, type ControlState } from "@/app/admin/controls/actions";
import type { ControlEntity, MenuItem } from "@/lib/admin/controls";
import { adminToast } from "./toaster";

const initial: ControlState = {};

/**
 * The confirmation every control goes through: what will happen, a required
 * reason (it goes in the audit log), and for Delete permanently the item's
 * name typed out. Opened by AdminRowActions, BulkBar and RecordActions.
 */
export default function ConfirmDialog({
  entity,
  item,
  ids,
  confirmText,
  noun,
  onClose,
  onDone,
  bulk = false,
  redirectAfterDelete,
}: {
  entity: ControlEntity;
  item: MenuItem;
  ids: readonly (string | number)[];
  /** What to type for a delete: the item's name, or "delete N" for a bulk. */
  confirmText?: string;
  /** "post", "3 posts" — for the heading. */
  noun: string;
  onClose: () => void;
  onDone?: () => void;
  /** From the bulk bar: a delete is confirmed by "delete N", not a name. */
  bulk?: boolean;
  /** Where to go once a permanent delete succeeds (a detail page whose record is gone). */
  redirectAfterDelete?: string | null;
}) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const [state, formAction, pending] = useActionState(runControl, initial);
  const isDelete = item.verb === "delete";

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  useEffect(() => {
    if (state.success) {
      adminToast(state.message ?? "Done.");
      onDone?.();
      onClose();
      if (isDelete && redirectAfterDelete) router.push(redirectAfterDelete);
    }
  }, [state, onClose, onDone, isDelete, redirectAfterDelete, router]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="rounded-2xl p-0 w-[min(92vw,460px)] backdrop:bg-navy-900/50 bg-surface text-ink-900 shadow-xl"
    >
      <form action={formAction} className="p-6 flex flex-col gap-4">
        <input type="hidden" name="entity" value={entity} />
        <input type="hidden" name="verb" value={item.verb} />
        {bulk && <input type="hidden" name="bulk" value="1" />}
        {ids.map((id) => (
          <input key={String(id)} type="hidden" name="id" value={String(id)} />
        ))}

        <div>
          <h2 className="font-display font-bold text-xl">
            {item.label} {noun}?
          </h2>
          <p className="text-sm text-ink-500 mt-1">{item.description}</p>
        </div>

        <label className="flex flex-col gap-1 text-sm font-semibold">
          Reason
          <textarea
            name="reason"
            required
            maxLength={500}
            rows={2}
            autoFocus
            placeholder="Recorded in the audit log"
            className="w-full text-sm font-normal rounded-lg border-[1.5px] border-line px-3 py-2 resize-none bg-surface"
          />
        </label>

        {entity === "user" && isDelete && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="immediate" className="mt-1" />
            <span>
              Run the deletion at the next scheduled run instead of after the 30-day grace period (use when the member has
              asked for erasure in writing).
            </span>
          </label>
        )}

        {isDelete && confirmText && (
          <label className="flex flex-col gap-1 text-sm font-semibold">
            <span>
              Type <span className="font-mono bg-cream-100 rounded px-1.5 py-0.5">{confirmText}</span> to confirm
            </span>
            <input
              name="confirm"
              required
              autoComplete="off"
              className="w-full text-sm font-normal rounded-lg border-[1.5px] border-line px-3 py-2 bg-surface"
            />
          </label>
        )}

        {state.error && <p className="text-sm text-red-600 bg-red-100 rounded-lg px-3 py-2">{state.error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-full text-sm font-bold border-[1.5px] border-line hover:bg-cream-100 transition"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending}
            className={`px-4 py-2 rounded-full text-sm font-bold transition disabled:opacity-60 ${
              item.tone === "danger" ? "bg-red-600 text-cream-50 hover:opacity-90" : "bg-navy-900 text-cream-50 hover:bg-navy-800"
            }`}
          >
            {pending ? "Working…" : item.label}
          </button>
        </div>
      </form>
    </dialog>
  );
}
