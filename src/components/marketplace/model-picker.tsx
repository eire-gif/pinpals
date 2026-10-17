"use client";

import { useEffect, useState } from "react";

import { MODEL_COLUMNS, modelsFrom, type FinderModel } from "@/lib/finder";
import { createClient } from "@/lib/supabase/client";
import { SELECT_CLASS } from "@/lib/ui";

/**
 * Selling: pick the exact model from the catalogue (0163, approved mock-up
 * "App 6 · Selling: pick the exact model"). Picking one is what puts the
 * listing under that model in the finder — and in its Top picks.
 *
 * Renders nothing (not even the hidden field) until the brand has catalogue
 * models in this category, so a brand we don't list by model — or a
 * database without 0163 yet — saves exactly as before.
 */
export default function ModelPicker({
  brand,
  category,
  value,
  onChange,
  disabled = false,
}: {
  brand: string;
  category: string;
  value: string;
  onChange: (modelId: string, model: FinderModel | null) => void;
  disabled?: boolean;
}) {
  const [loaded, setLoaded] = useState<{ key: string; models: FinderModel[] }>({ key: "", models: [] });
  const key = brand && category && brand !== "other" && brand !== "unknown" && brand !== "mixed" ? `${brand}|${category}` : "";

  useEffect(() => {
    if (!key) return;
    let live = true;
    const [b, c] = key.split("|");
    void createClient()
      .from("marketplace_models")
      .select(MODEL_COLUMNS)
      .eq("brand_id", b)
      .eq("category", c)
      .eq("active", true)
      .then(({ data, error }) => {
        if (!live) return;
        const models = error ? [] : modelsFrom(data).sort((x, y) => (y.year ?? 0) - (x.year ?? 0) || x.family.localeCompare(y.family));
        setLoaded({ key, models });
      });
    return () => {
      live = false;
    };
  }, [key]);

  const models = loaded.key === key ? loaded.models : [];
  if (!key || models.length === 0) return null;
  const known = models.some((m) => m.id === value);

  return (
    <div className="grid gap-1.5">
      <label htmlFor="modelId" className="text-[13.5px] font-bold">
        Which model? <span className="font-normal text-ink-500">(helps buyers find it)</span>
      </label>
      <select
        id="modelId"
        name="modelId"
        value={known ? value : ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value, models.find((m) => m.id === e.target.value) ?? null)}
        className={`${SELECT_CLASS} disabled:opacity-60`}
      >
        <option value="">Not listed / not sure</option>
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.family}
            {m.year ? ` (${m.year})` : ""}
          </option>
        ))}
      </select>
      <p className="text-xs text-ink-500">
        Shows your advert when a buyer picks this model — and lets it go in Top picks for it.
      </p>
    </div>
  );
}
