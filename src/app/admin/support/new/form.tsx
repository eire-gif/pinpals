"use client";

import { useActionState } from "react";
import {
  SUPPORT_CASE_CATEGORIES,
  SUPPORT_CASE_CATEGORY_LABELS,
  SUPPORT_CASE_LINKED_TARGET_TYPES,
  SUPPORT_CASE_LINKED_TARGET_TYPE_LABELS,
  SUPPORT_CASE_PRIORITIES,
  SUPPORT_CASE_PRIORITY_LABELS,
} from "@/lib/admin/support-cases";
import { createCase, type CreateCaseState } from "./actions";

const initialState: CreateCaseState = {};

export default function NewCaseForm() {
  const [state, formAction, pending] = useActionState(createCase, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4 max-w-2xl">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold text-ink-900">Member</span>
        <input
          type="text"
          name="member"
          required
          placeholder="Email or full name"
          className="px-4 py-2.5 rounded-lg border-[1.5px] border-line bg-surface text-sm"
        />
        {state.candidates && state.candidates.length > 0 && (
          <ul className="text-xs text-ink-500 mt-1 list-disc list-inside">
            {state.candidates.map((c) => (
              <li key={c.id}>
                {c.name} {c.email && <>— {c.email}</>}
              </li>
            ))}
          </ul>
        )}
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold text-ink-900">Subject</span>
        <input
          type="text"
          name="subject"
          required
          maxLength={200}
          className="px-4 py-2.5 rounded-lg border-[1.5px] border-line bg-surface text-sm"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold text-ink-900">Description</span>
        <textarea
          name="description"
          rows={4}
          maxLength={4000}
          placeholder="What the member said, in your own words — never a copy-paste of message/payment content"
          className="px-4 py-2.5 rounded-lg border-[1.5px] border-line bg-surface text-sm resize-none"
        />
      </label>

      <div className="grid sm:grid-cols-2 gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold text-ink-900">Category</span>
          <select
            name="category"
            required
            defaultValue=""
            className="px-4 py-2.5 rounded-lg border-[1.5px] border-line bg-surface text-sm"
          >
            <option value="" disabled>
              Choose…
            </option>
            {SUPPORT_CASE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {SUPPORT_CASE_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold text-ink-900">Priority</span>
          <select
            name="priority"
            defaultValue="normal"
            className="px-4 py-2.5 rounded-lg border-[1.5px] border-line bg-surface text-sm"
          >
            {SUPPORT_CASE_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {SUPPORT_CASE_PRIORITY_LABELS[p]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold text-ink-900">Linked record type (optional)</span>
          <select
            name="linkedTargetType"
            defaultValue=""
            className="px-4 py-2.5 rounded-lg border-[1.5px] border-line bg-surface text-sm"
          >
            <option value="">None</option>
            {SUPPORT_CASE_LINKED_TARGET_TYPES.map((t) => (
              <option key={t} value={t}>
                {SUPPORT_CASE_LINKED_TARGET_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold text-ink-900">Linked record id</span>
          <input
            type="text"
            name="linkedTargetId"
            placeholder="e.g. 42"
            className="px-4 py-2.5 rounded-lg border-[1.5px] border-line bg-surface text-sm"
          />
        </label>
      </div>

      {state.error && <p className="text-sm text-red-600 bg-red-100 rounded-lg px-4 py-3">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="self-start px-6 py-3 rounded-full font-bold text-sm bg-navy-900 text-cream-50 hover:bg-navy-800 transition disabled:opacity-60"
      >
        {pending ? "Creating…" : "Create case"}
      </button>
    </form>
  );
}
