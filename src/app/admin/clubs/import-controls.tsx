"use client";

import { useActionState } from "react";
import { COUNTRIES } from "@/lib/regions";
import { runCourseImport, type ImportState } from "./actions";

const initialState: ImportState = {};

/**
 * "Refresh from OpenStreetMap", one country at a time.
 *
 * Per-country rather than one "refresh everything" button because the runs
 * are minutes long and Overpass — a free, shared service — sheds load under
 * exactly this kind of query. Five separate runs also mean a failure costs
 * one country's refresh rather than the whole directory's.
 *
 * The confirmation deliberately says "started", not "done": the import runs
 * on well past this request (see runCourseImport's own comment), and the
 * per-country counts above are where staff actually see the result.
 */
export default function ImportControls({ className = "" }: { className?: string }) {
  const [state, formAction, pending] = useActionState(runCourseImport, initialState);

  return (
    <form
      action={formAction}
      className={`flex flex-wrap items-center gap-3 bg-surface border border-line rounded-xl px-4 py-3 ${className}`}
    >
      <span className="text-sm font-bold">Refresh from OpenStreetMap</span>

      <select
        name="country"
        defaultValue=""
        required
        aria-label="Country to refresh"
        className="px-3.5 py-2 rounded-full border-[1.5px] border-line bg-surface-tint text-sm font-semibold"
      >
        <option value="" disabled>
          Choose a country…
        </option>
        {COUNTRIES.map((c) => (
          <option key={c.code} value={c.code}>
            {c.name}
          </option>
        ))}
      </select>

      <button
        type="submit"
        disabled={pending}
        className="px-4 py-2 rounded-full text-sm font-bold bg-navy-900 text-cream-50 disabled:opacity-60"
      >
        {pending ? "Starting…" : "Start import"}
      </button>

      {state.started && (
        <span className="text-sm text-green-800 bg-green-100 rounded-full px-3 py-1 font-semibold">
          {state.started} import started — it runs in the background for a few minutes. Reload this
          page to see the new counts.
        </span>
      )}
      {state.error && (
        <span className="text-sm text-red-600 bg-red-100 rounded-full px-3 py-1 font-semibold">
          {state.error}
        </span>
      )}

      <p className="w-full text-xs text-ink-500">
        Courses marked &ldquo;verified&rdquo; keep their website, county, town and coordinates —
        an import only ever corrects their country. Courses marked &ldquo;manual&rdquo; are never
        touched at all.
      </p>
    </form>
  );
}
