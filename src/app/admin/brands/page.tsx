import Image from "next/image";
import Link from "next/link";

import AdminPageHeader from "@/components/admin/page-header";
import { requireStaff } from "@/lib/admin/authorization";
import { EDIT_ROLES } from "@/lib/admin/controls";
import { canAccess } from "@/lib/admin/roles";
import { CATEGORIES } from "@/lib/marketplace";
import { createAdminClient } from "@/lib/supabase/admin";
import { AddModelForm, LogoForm, ModelToggle } from "./brand-forms";

export const dynamic = "force-dynamic";

type BrandRow = { id: string; label: string; logo_url: string | null; is_fallback: boolean };
type ModelRow = { id: string; brand_id: string; category: string; family: string; year: number | null; versions: string[]; active: boolean };

/**
 * Admin → Brands & models (0163). Every brand's logo — shown in the fixed
 * white logo box on brand tiles across the website and the app — and the
 * model catalogue behind "find by club, brand and model" and the sell form.
 * Any staff member may look; admins change things.
 */
export default async function AdminBrandsPage({ searchParams }: { searchParams: Promise<{ q?: string; brand?: string; logos?: string }> }) {
  const { staff } = await requireStaff();
  const canEdit = canAccess(staff, EDIT_ROLES);
  const { q = "", brand: picked = "", logos = "" } = await searchParams;

  const admin = createAdminClient();
  const [{ data: brandData }, { data: modelData }] = await Promise.all([
    admin.from("marketplace_brands").select("id, label, logo_url, is_fallback").order("label").returns<BrandRow[]>(),
    admin.from("marketplace_models").select("id, brand_id, category, family, year, versions, active").returns<ModelRow[]>(),
  ]);
  const brands = (brandData ?? []).filter((b) => !b.is_fallback);
  const models = modelData ?? [];
  const modelCount = new Map<string, number>();
  for (const m of models) modelCount.set(m.brand_id, (modelCount.get(m.brand_id) ?? 0) + 1);

  const term = q.trim().toLowerCase();
  const shown = brands.filter(
    (b) => (!term || b.label.toLowerCase().includes(term) || b.id.includes(term)) && (logos !== "missing" || !b.logo_url)
  );
  const withLogos = brands.filter((b) => b.logo_url).length;
  const current = picked ? brands.find((b) => b.id === picked) : undefined;
  const currentModels = current ? models.filter((m) => m.brand_id === current.id) : [];

  return (
    <div>
      <AdminPageHeader
        title="Brands & models"
        description={`${brands.length} brands (${withLogos} with a logo) · ${models.length} models in the catalogue. Logos show on every brand tile; models power find by club, brand and model.`}
      />

      {current ? (
        <section className="mb-8 bg-surface border border-line rounded-2xl p-5">
          <p className="text-sm">
            <Link href={`/admin/brands${q ? `?q=${encodeURIComponent(q)}` : ""}`} className="text-ink-500 hover:text-ink-900">
              ← All brands
            </Link>
          </p>
          <div className="mt-3 flex flex-wrap items-start gap-6">
            <span className="relative w-48 h-24 rounded-xl bg-white border border-line flex items-center justify-center overflow-hidden">
              {current.logo_url ? (
                <Image src={current.logo_url} alt={current.label} fill unoptimized className="object-contain p-3" />
              ) : (
                <span className="text-xl font-extrabold text-navy-900">{current.label}</span>
              )}
            </span>
            <div className="flex-1 min-w-[260px]">
              <h2 className="font-display font-bold text-2xl">{current.label}</h2>
              <p className="text-sm text-ink-500">{current.id}</p>
              {canEdit ? (
                <div className="mt-3">
                  <LogoForm brandId={current.id} hasLogo={!!current.logo_url} />
                </div>
              ) : null}
            </div>
          </div>

          <h3 className="font-bold text-lg mt-8 mb-3">Models ({currentModels.length})</h3>
          {CATEGORIES.filter((c) => currentModels.some((m) => m.category === c)).map((c) => (
            <div key={c} className="mb-5">
              <p className="text-xs font-bold uppercase tracking-wider text-ink-500 mb-2">{c}</p>
              <ul className="divide-y divide-line border border-line rounded-xl">
                {currentModels
                  .filter((m) => m.category === c)
                  .sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || a.family.localeCompare(b.family))
                  .map((m) => (
                    <li key={m.id} className={`flex items-center gap-3 px-4 py-2.5 text-sm ${m.active ? "" : "opacity-50"}`}>
                      <span className="w-12 text-gold-600 font-bold">{m.year ?? ""}</span>
                      <span className="font-semibold">{m.family}</span>
                      <span className="flex-1 truncate text-ink-500">{m.versions.join(" · ")}</span>
                      {canEdit ? <ModelToggle modelId={m.id} active={m.active} /> : null}
                    </li>
                  ))}
              </ul>
            </div>
          ))}
          {canEdit ? (
            <div className="mt-6 border-t border-line pt-5">
              <h3 className="font-bold mb-3">Add a model</h3>
              <AddModelForm brandId={current.id} category={currentModels[0]?.category ?? "Drivers"} />
            </div>
          ) : null}
        </section>
      ) : null}

      <form className="flex flex-wrap gap-2 mb-4" action="/admin/brands">
        <input name="q" defaultValue={q} placeholder="Search brands" className="rounded-full border border-line px-4 py-2 text-sm bg-surface" />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="logos" value="missing" defaultChecked={logos === "missing"} /> Missing a logo
        </label>
        <button type="submit" className="px-4 py-2 rounded-full bg-navy-900 text-cream-50 text-sm font-bold">
          Search
        </button>
      </form>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
        {shown.map((b) => (
          <Link
            key={b.id}
            href={`/admin/brands?brand=${encodeURIComponent(b.id)}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
            className={`rounded-2xl border bg-surface p-3 flex flex-col gap-2 hover:border-navy-900 transition ${b.id === picked ? "border-navy-900" : "border-line"}`}
          >
            <span className="relative h-16 rounded-xl bg-white border border-line flex items-center justify-center overflow-hidden">
              {b.logo_url ? (
                <Image src={b.logo_url} alt={b.label} fill unoptimized className="object-contain p-2" />
              ) : (
                <span className="font-extrabold text-navy-900 text-sm text-center px-2">{b.label}</span>
              )}
            </span>
            <span className="flex justify-between text-xs">
              <span className="font-semibold truncate">{b.label}</span>
              <span className="text-ink-500">{modelCount.get(b.id) ?? 0} models</span>
            </span>
            {!b.logo_url ? <span className="text-[11px] font-bold text-gold-600">No logo yet</span> : null}
          </Link>
        ))}
      </div>
    </div>
  );
}
