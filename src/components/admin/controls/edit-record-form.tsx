"use client";

import { useActionState, useEffect } from "react";
import { saveRecordEdit, type ControlState } from "@/app/admin/controls/actions";
import type { ControlEntity, EditField } from "@/lib/admin/controls";
import { adminToast } from "./toaster";

const initial: ControlState = {};
const input = "w-full text-sm rounded-lg border-[1.5px] border-line px-3 py-2 bg-surface";

/**
 * The generic admin edit form: one field per entry in the record's field
 * list (ENTITY_CONTROLS[entity].edit.fields), plus the reason every change
 * needs. Validated again on the server by the same field list.
 */
export default function EditRecordForm({
  entity,
  id,
  fields,
  values,
}: {
  entity: ControlEntity;
  id: string | number;
  fields: readonly EditField[];
  values: Record<string, unknown>;
}) {
  const [state, formAction, pending] = useActionState(saveRecordEdit, initial);

  useEffect(() => {
    if (state.success) adminToast(state.message ?? "Saved.");
  }, [state]);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="entity" value={entity} />
      <input type="hidden" name="id" value={String(id)} />

      {fields.map((f) => {
        const value = values[f.name];
        const str = value == null ? "" : String(value);
        return (
          <label key={f.name} className="flex flex-col gap-1 text-sm font-semibold">
            <span>
              {f.label}
              {!f.required && <span className="font-normal text-ink-500"> (optional)</span>}
            </span>
            {f.kind === "textarea" ? (
              <textarea name={f.name} defaultValue={str} maxLength={f.max} rows={5} className={`${input} font-normal`} />
            ) : f.kind === "select" ? (
              <select name={f.name} defaultValue={str} className={`${input} font-normal`}>
                {f.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                name={f.name}
                type={f.kind === "number" ? "number" : "text"}
                defaultValue={str}
                maxLength={f.kind === "text" ? f.max : undefined}
                min={f.kind === "number" ? f.min : undefined}
                max={f.kind === "number" ? f.max : undefined}
                step={f.integer ? 1 : undefined}
                required={f.required}
                className={`${input} font-normal`}
              />
            )}
          </label>
        );
      })}

      <label className="flex flex-col gap-1 text-sm font-semibold">
        Reason for the change
        <input name="reason" required maxLength={500} placeholder="Recorded in the audit log" className={`${input} font-normal`} />
      </label>

      {state.error && <p className="text-sm text-red-600 bg-red-100 rounded-lg px-3 py-2">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="self-start px-5 py-2 rounded-full font-bold text-sm bg-navy-900 text-cream-50 hover:bg-navy-800 transition disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}
