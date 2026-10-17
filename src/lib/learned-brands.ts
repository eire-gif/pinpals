import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { setLearnedBrands, type LearnedBrand } from "@/lib/marketplace-brands";

/**
 * Brands added from member suggestions (0164), loaded into
 * marketplace-brands.ts so every brand list and check on the server
 * includes them. Cached for five minutes per server instance — a brand staff
 * add shows up within that, and the list is read on every sell and browse.
 *
 * Never throws: a failed load keeps the last good list (or none), which
 * means a learned brand is briefly missing, never that a page breaks.
 */

const TTL_MS = 5 * 60 * 1000;
let loadedAt = 0;
let inflight: Promise<void> | null = null;

export async function ensureLearnedBrands(supabase: SupabaseClient): Promise<void> {
  if (Date.now() - loadedAt < TTL_MS) return;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const { data, error } = await supabase
        .from("marketplace_brands")
        .select("id, label, categories")
        .eq("learned", true);
      if (error) return;
      setLearnedBrands(
        ((data ?? []) as { id: string; label: string; categories: string[] | null }[]).map(
          (b): LearnedBrand => ({ id: b.id, label: b.label, aliases: [], categories: b.categories ?? [] })
        )
      );
      loadedAt = Date.now();
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** After staff add a brand, so this instance shows it straight away. */
export function forgetLearnedBrands(): void {
  loadedAt = 0;
}
