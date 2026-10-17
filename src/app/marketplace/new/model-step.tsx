"use client";

import { useEffect, useRef, useState } from "react";

import { MODEL_COLUMNS, modelsFrom, type FinderModel } from "@/lib/finder";
import { createClient } from "@/lib/supabase/client";
import { FIELD_CLASS } from "@/lib/ui";

/**
 * Selling, step 4: which model (approved mock-up "Sell 4 · Model").
 *
 * The brand's catalogue models for this kind of item, newest first; picking
 * one asks which version. Models three or more sellers have typed (0164) are
 * offered as "suggested". Not on the list? Type it — the ad uses it straight
 * away, and once five sellers type the same thing it joins the catalogue.
 *
 * For "Other", "Unbranded" or "Mixed" there's no catalogue, so it's just
 * the typed box.
 */
export default function ModelStep({
  brand,
  category,
  modelId,
  model,
  onChange,
}: {
  brand: string;
  category: string;
  modelId: string;
  model: string;
  onChange: (next: { modelId: string; model: string; picked: FinderModel | null }) => void;
}) {
  const real = !!brand && !["other", "unknown", "mixed"].includes(brand);
  const key = real && category ? `${brand}|${category}` : "";
  const [loaded, setLoaded] = useState<{ key: string; models: FinderModel[]; suggested: string[] }>({ key: "", models: [], suggested: [] });
  const [typing, setTyping] = useState(false);
  const latest = useRef({ modelId, model, onChange });
  useEffect(() => {
    latest.current = { modelId, model, onChange };
  });
  const [older, setOlder] = useState(false);

  useEffect(() => {
    if (!key) return;
    let live = true;
    const [b, c] = key.split("|");
    const supabase = createClient();
    void Promise.all([
      supabase.from("marketplace_models").select(MODEL_COLUMNS).eq("brand_id", b).eq("category", c).eq("active", true),
      supabase.rpc("marketplace_member_suggestions", { p_category: c, p_brand: b }),
    ]).then(([m, s]) => {
      if (!live) return;
      const models = m.error ? [] : modelsFrom(m.data).sort((x, y) => (y.year ?? 0) - (x.year ?? 0) || x.family.localeCompare(y.family));
      setLoaded({ key, models, suggested: s.error ? [] : ((s.data ?? []) as { label: string }[]).map((x) => x.label) });
      // A model chosen before this step opened (from the finder's "Sell yours").
      const already = latest.current.modelId ? models.find((x) => x.id === latest.current.modelId) : undefined;
      if (already) latest.current.onChange({ modelId: already.id, model: latest.current.model, picked: already });
    });
    return () => {
      live = false;
    };
  }, [key]);

  const models = loaded.key === key ? loaded.models : [];
  const suggested = loaded.key === key ? loaded.suggested : [];
  const picked = models.find((m) => m.id === modelId) ?? null;
  const recent = models.filter((m) => (m.year ?? 0) >= new Date().getFullYear() - 5);
  const shown = older || recent.length < 4 ? models : recent;
  const freeText = !picked && (typing || (!!model && !suggested.includes(model)));

  if (!real || models.length === 0) {
    return (
      <label className="grid gap-1.5 text-[13.5px] font-bold">
        Model <span className="font-normal text-ink-500">(optional)</span>
        <input
          value={model}
          onChange={(e) => onChange({ modelId: "", model: e.target.value, picked: null })}
          maxLength={80}
          placeholder="As it's written on the item"
          className={FIELD_CLASS}
        />
      </label>
    );
  }

  return (
    <div className="grid gap-3">
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
        {shown.map((m) => {
          const on = m.id === modelId;
          return (
            <button
              key={m.id}
              type="button"
              aria-pressed={on}
              onClick={() => {
                setTyping(false);
                onChange({ modelId: on ? "" : m.id, model: on ? "" : m.versions.length ? "" : m.family, picked: on ? null : m });
              }}
              className={`text-left rounded-2xl bg-surface px-4 py-3 grid gap-0.5 transition ${on ? "border-2 border-green-700" : "border border-line hover:border-navy-900"}`}
            >
              <span className="flex items-center gap-2">
                {m.year ? <span className="text-[11px] font-extrabold text-gold-600 bg-cream-100 rounded px-1.5 py-0.5">{m.year}</span> : null}
                <span className="font-extrabold text-navy-900">{m.family}</span>
                {on ? <span className="ml-auto text-green-700" aria-hidden>✓</span> : null}
              </span>
              <span className="text-xs text-ink-500 truncate">{m.versions.slice(0, 4).join(" · ") || " "}</span>
            </button>
          );
        })}
      </div>
      {shown.length < models.length ? (
        <button type="button" onClick={() => setOlder(true)} className="justify-self-start text-sm font-bold text-green-700">
          Older models ({models.length - shown.length})
        </button>
      ) : null}

      {picked && picked.versions.length > 0 ? (
        <div className="rounded-2xl border border-line bg-surface p-4 grid gap-2">
          <span className="text-sm font-extrabold text-navy-900">Which {picked.family}?</span>
          <div className="flex flex-wrap gap-2">
            {picked.versions.map((v) => {
              const on = model === v;
              return (
                <button
                  key={v}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onChange({ modelId: picked.id, model: on ? "" : v, picked })}
                  className={`px-3.5 py-2 rounded-full text-sm font-bold border ${on ? "bg-navy-900 text-cream-50 border-navy-900" : "bg-surface border-line"}`}
                >
                  {v}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {suggested.length > 0 ? (
        <div>
          <p className="text-xs font-extrabold uppercase tracking-wider text-ink-500 mb-2">Suggested by members</p>
          <div className="flex flex-wrap gap-2">
            {suggested.map((label) => {
              const on = !modelId && model === label;
              return (
                <button
                  key={label}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    setTyping(false);
                    onChange({ modelId: "", model: on ? "" : label, picked: null });
                  }}
                  className={`px-3.5 py-2 rounded-full text-sm font-bold border ${on ? "bg-navy-900 text-cream-50 border-navy-900" : "bg-surface border-line"}`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-4 items-center">
        <button
          type="button"
          onClick={() => {
            setTyping(true);
            onChange({ modelId: "", model: suggested.includes(model) ? "" : model, picked: null });
          }}
          className="text-sm font-bold text-green-700"
        >
          Not listed — type it
        </button>
        <button type="button" onClick={() => onChange({ modelId: "", model: "", picked: null })} className="text-sm font-bold text-ink-500">
          Not sure
        </button>
      </div>
      {freeText ? (
        <label className="grid gap-1.5 text-[13.5px] font-bold">
          Model name
          <input
            value={model}
            onChange={(e) => onChange({ modelId: "", model: e.target.value, picked: null })}
            maxLength={80}
            autoFocus
            placeholder="As it's written on the item"
            className={FIELD_CLASS}
          />
          <span className="text-xs font-normal text-ink-500">Your ad uses it straight away. When a few sellers type the same model, it joins the list for everyone.</span>
        </label>
      ) : null}
    </div>
  );
}
