import { requireStaff } from "@/lib/admin/authorization";
import { FINANCE_ROLES } from "@/lib/admin/finance";
import {
  formatCtr,
  listAffiliateProductsForAdmin,
  listBannersForAdmin,
  type AdminAffiliateProduct,
  type AdminBanner,
} from "@/lib/admin/marketplace-revenue";
import { BANNER_PLACEMENTS, BANNER_PLACEMENT_LABELS } from "@/lib/admin/marketplace-catalog";
import { formatDateTime } from "@/lib/admin/format";
import { formatPrice } from "@/lib/format";
import FieldsActionForm from "@/components/admin/fields-action-form";
import SimpleActionForm from "@/components/admin/simple-action-form";
import { saveAffiliateProduct, saveBanner, toggleAffiliateProduct, toggleBanner } from "./growth-actions";

// Retail & ads (0115): affiliate products shown in New Gear, and sponsored
// banners at the top of New Gear / Used Gear. Both tables are service-role
// writes only; every save validates server-side (https:// links included —
// see src/lib/admin/marketplace-catalog.ts) and is audited.
export default async function RetailTab() {
  await requireStaff({ roles: FINANCE_ROLES });
  const [products, banners] = await Promise.all([listAffiliateProductsForAdmin(), listBannersForAdmin()]);

  return (
    <div>
      <section className="mb-12">
        <h2 className="font-display font-bold text-lg mb-2">Sponsored banners</h2>
        <p className="text-sm text-ink-500 mb-4">
          One live banner shows per placement (the most recent that&rsquo;s active and inside its dates). The sponsor fee
          is a flat amount booked to revenue on the start date. Dates are in UTC.
        </p>

        {banners.length === 0 ? (
          <p className="text-sm text-ink-500 bg-surface border border-line rounded-2xl p-6 mb-4">No banners yet.</p>
        ) : (
          <div className="grid gap-3 mb-6">
            {banners.map((b) => (
              <BannerRow key={b.id} banner={b} />
            ))}
          </div>
        )}

        <details className="bg-surface border border-line rounded-2xl p-5">
          <summary className="font-bold text-sm cursor-pointer text-green-700">+ New banner</summary>
          <div className="mt-4">
            <FieldsActionForm action={saveBanner} submitLabel="Create banner" pendingLabel="Creating…" resetOnSuccess successLabel="Banner created.">
              <BannerFields />
            </FieldsActionForm>
          </div>
        </details>
      </section>

      <section>
        <h2 className="font-display font-bold text-lg mb-2">Affiliate products</h2>
        <p className="text-sm text-ink-500 mb-4">
          Retailer deals in New Gear, lowest sort order first. Links must be full https:// URLs carrying the affiliate tag.
          Clicks are counted here; commission is paid by the retailer outside PinPals.
        </p>

        {products.length === 0 ? (
          <p className="text-sm text-ink-500 bg-surface border border-line rounded-2xl p-6 mb-4">No affiliate products yet.</p>
        ) : (
          <div className="grid gap-3 mb-6">
            {products.map((p) => (
              <ProductRow key={p.id} product={p} />
            ))}
          </div>
        )}

        <details className="bg-surface border border-line rounded-2xl p-5">
          <summary className="font-bold text-sm cursor-pointer text-green-700">+ New affiliate product</summary>
          <div className="mt-4">
            <FieldsActionForm action={saveAffiliateProduct} submitLabel="Add product" pendingLabel="Adding…" resetOnSuccess successLabel="Product added.">
              <ProductFields />
            </FieldsActionForm>
          </div>
        </details>
      </section>
    </div>
  );
}

function BannerRow({ banner: b }: { banner: AdminBanner }) {
  const live = b.live;
  return (
    <div className="bg-surface border border-line rounded-2xl p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {b.eyebrow && <span className="text-[11px] uppercase tracking-wide font-bold text-gold-600">{b.eyebrow}</span>}
            <span className="font-display font-bold text-ink-900">{b.title}</span>
            <Pill tone={live ? "green" : b.active ? "neutral" : "red"}>{live ? "Live" : b.active ? "Scheduled / ended" : "Off"}</Pill>
          </div>
          <div className="text-sm text-ink-500 mt-1">
            {b.sponsor} · {BANNER_PLACEMENT_LABELS[b.placement] ?? b.placement} · {formatDateTime(b.starts_at)} →{" "}
            {b.ends_at ? formatDateTime(b.ends_at) : "no end"}
          </div>
          <a href={b.link_url} target="_blank" rel="noopener noreferrer" className="text-xs underline text-ink-500 break-all">
            {b.link_url}
          </a>
        </div>
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <Fact label="Fee" value={b.fee_eur != null ? formatPrice(Number(b.fee_eur)) : "—"} />
          <Fact label="Impressions" value={b.impressions.toLocaleString("en-IE")} />
          <Fact label="Clicks" value={b.clicks.toLocaleString("en-IE")} />
          <Fact label="CTR" value={formatCtr(b.impressions, b.clicks)} />
        </dl>
      </div>
      <div className="mt-4 flex flex-wrap items-start gap-4">
        <SimpleActionForm key={`banner-${b.id}-${b.active}`} action={toggleBanner} idField="bannerId" id={b.id} submitLabel={b.active ? "Turn off" : "Turn on"} pendingLabel="Saving…" tone={b.active ? "danger" : "default"} />
        <details className="flex-1 min-w-64">
          <summary className="text-sm text-ink-500 cursor-pointer py-2">Edit…</summary>
          <div className="mt-2">
            <FieldsActionForm action={saveBanner} submitLabel="Save banner" pendingLabel="Saving…">
              <input type="hidden" name="bannerId" value={b.id} />
              <BannerFields banner={b} />
            </FieldsActionForm>
          </div>
        </details>
      </div>
    </div>
  );
}

function ProductRow({ product: p }: { product: AdminAffiliateProduct }) {
  return (
    <div className="bg-surface border border-line rounded-2xl p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display font-bold text-ink-900">{p.title}</span>
            <Pill tone={p.active ? "green" : "red"}>{p.active ? "Showing" : "Hidden"}</Pill>
          </div>
          <div className="text-sm text-ink-500 mt-1">
            {[p.brand, p.category, p.retailer].filter(Boolean).join(" · ")}
          </div>
          <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-xs underline text-ink-500 break-all">
            {p.url}
          </a>
        </div>
        <dl className="grid grid-cols-3 gap-4 text-sm">
          <Fact
            label="Price"
            value={p.price_eur != null ? formatPrice(Number(p.price_eur)) : "—"}
            sub={p.was_price_eur != null ? `was ${formatPrice(Number(p.was_price_eur))}` : undefined}
          />
          <Fact label="Sort" value={String(p.sort_order)} />
          <Fact label="Clicks" value={p.clicks.toLocaleString("en-IE")} />
        </dl>
      </div>
      <div className="mt-4 flex flex-wrap items-start gap-4">
        <SimpleActionForm key={`product-${p.id}-${p.active}`} action={toggleAffiliateProduct} idField="productId" id={p.id} submitLabel={p.active ? "Hide" : "Show"} pendingLabel="Saving…" tone={p.active ? "danger" : "default"} />
        <details className="flex-1 min-w-64">
          <summary className="text-sm text-ink-500 cursor-pointer py-2">Edit…</summary>
          <div className="mt-2">
            <FieldsActionForm action={saveAffiliateProduct} submitLabel="Save product" pendingLabel="Saving…">
              <input type="hidden" name="productId" value={p.id} />
              <ProductFields product={p} />
            </FieldsActionForm>
          </div>
        </details>
      </div>
    </div>
  );
}

// ---------- Field sets (server-rendered; posted through FieldsActionForm) ----------

const inputCls = "w-full text-sm rounded-lg border-[1.5px] border-line px-3 py-2 bg-surface";

function Field({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={`grid gap-1 ${wide ? "sm:col-span-2" : ""}`}>
      <span className="text-xs uppercase tracking-wide text-ink-500 font-semibold">{label}</span>
      {children}
    </label>
  );
}

/** ISO → "YYYY-MM-DDTHH:mm" in UTC, for a datetime-local input. */
function toInputUtc(iso: string | null): string {
  return iso ? new Date(iso).toISOString().slice(0, 16) : "";
}

function BannerFields({ banner }: { banner?: AdminBanner }) {
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      <Field label="Title *">
        <input name="title" required minLength={2} maxLength={80} defaultValue={banner?.title} className={inputCls} />
      </Field>
      <Field label="Sponsor *">
        <input name="sponsor" required minLength={2} maxLength={80} defaultValue={banner?.sponsor} className={inputCls} />
      </Field>
      <Field label="Eyebrow">
        <input name="eyebrow" maxLength={40} defaultValue={banner?.eyebrow ?? ""} placeholder="e.g. Sponsored" className={inputCls} />
      </Field>
      <Field label="Placement">
        <select name="placement" defaultValue={banner?.placement ?? "new_gear"} className={inputCls}>
          {BANNER_PLACEMENTS.map((p) => (
            <option key={p} value={p}>
              {BANNER_PLACEMENT_LABELS[p]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Subtitle" wide>
        <input name="subtitle" maxLength={140} defaultValue={banner?.subtitle ?? ""} className={inputCls} />
      </Field>
      <Field label="Link (https://) *" wide>
        <input name="link_url" type="url" required pattern="https://.*" defaultValue={banner?.link_url} className={inputCls} />
      </Field>
      <Field label="Image URL (https://)" wide>
        <input name="image_url" type="url" pattern="https://.*" defaultValue={banner?.image_url ?? ""} className={inputCls} />
      </Field>
      <Field label="Starts (UTC — blank = now)">
        <input name="starts_at" type="datetime-local" defaultValue={toInputUtc(banner?.starts_at ?? null)} className={inputCls} />
      </Field>
      <Field label="Ends (UTC — blank = open)">
        <input name="ends_at" type="datetime-local" defaultValue={toInputUtc(banner?.ends_at ?? null)} className={inputCls} />
      </Field>
      <Field label="Sponsor fee (€)">
        <input name="fee_eur" inputMode="decimal" defaultValue={banner?.fee_eur ?? ""} placeholder="e.g. 250" className={inputCls} />
      </Field>
      <label className="flex items-center gap-2 text-sm self-end pb-2">
        <input type="checkbox" name="active" defaultChecked={banner?.active ?? true} /> Active
      </label>
    </div>
  );
}

function ProductFields({ product }: { product?: AdminAffiliateProduct }) {
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      <Field label="Title *" wide>
        <input name="title" required minLength={2} maxLength={120} defaultValue={product?.title} className={inputCls} />
      </Field>
      <Field label="Retailer *">
        <input name="retailer" required minLength={2} maxLength={80} defaultValue={product?.retailer} className={inputCls} />
      </Field>
      <Field label="Brand">
        <input name="brand" maxLength={60} defaultValue={product?.brand ?? ""} className={inputCls} />
      </Field>
      <Field label="Category">
        <input name="category" maxLength={60} defaultValue={product?.category ?? ""} className={inputCls} />
      </Field>
      <Field label="Sort order">
        <input name="sort_order" type="number" step={1} defaultValue={product?.sort_order ?? 0} className={inputCls} />
      </Field>
      <Field label="Price (€)">
        <input name="price_eur" inputMode="decimal" defaultValue={product?.price_eur ?? ""} className={inputCls} />
      </Field>
      <Field label="Was price (€)">
        <input name="was_price_eur" inputMode="decimal" defaultValue={product?.was_price_eur ?? ""} className={inputCls} />
      </Field>
      <Field label="Product link with affiliate tag (https://) *" wide>
        <input name="url" type="url" required pattern="https://.*" defaultValue={product?.url} className={inputCls} />
      </Field>
      <Field label="Image URL (https://)" wide>
        <input name="image_url" type="url" pattern="https://.*" defaultValue={product?.image_url ?? ""} className={inputCls} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="active" defaultChecked={product?.active ?? true} /> Show in New Gear
      </label>
    </div>
  );
}

function Fact({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-ink-500 font-semibold">{label}</dt>
      <dd className="font-bold text-ink-900">{value}</dd>
      {sub && <dd className="text-xs text-ink-500 line-through">{sub}</dd>}
    </div>
  );
}

function Pill({ tone, children }: { tone: "green" | "red" | "neutral"; children: React.ReactNode }) {
  const cls =
    tone === "green" ? "bg-green-100 text-green-800" : tone === "red" ? "bg-red-100 text-red-600" : "bg-cream-100 text-ink-500";
  return <span className={`inline-block text-xs font-bold px-2.5 py-1 rounded-full whitespace-nowrap ${cls}`}>{children}</span>;
}
