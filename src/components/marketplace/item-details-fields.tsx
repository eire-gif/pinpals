"use client";

import { useEffect } from "react";
import BrandCombobox from "./brand-combobox";
import {
  DEXTERITIES,
  SHAFT_FLEXES,
  SHAFT_MATERIALS,
  MAX_BRAND_OTHER_LENGTH,
  MAX_MODEL_LENGTH,
  MAX_SPEC_LENGTH,
  SPEC_FIELD_LABELS,
  SPEC_FIELD_PLACEHOLDERS,
  isBrandValidFor,
  specFieldsFor,
  type SpecField,
} from "@/lib/marketplace-brands";
import type { Listing } from "@/lib/types";

const inputClass =
  "px-3.5 py-3 rounded-lg border-[1.5px] border-line focus:outline-none focus:border-green-600 bg-surface";

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs text-red-600 mt-1">{message}</p>;
}

export type ItemDetailsDefaults = Pick<
  Listing,
  "brand" | "brand_other" | "model" | "dexterity" | "shaft_flex" | "shaft_material" | "loft" | "item_size"
>;

/**
 * The "what is it, exactly" block shared by the create and edit listing
 * forms — brand, plus whichever spec fields the chosen category actually
 * has (a driver has a loft and a shaft flex; a golf bag has neither).
 *
 * One component rather than two copies because the two forms have to agree
 * about this: which spec fields a category shows is a rule
 * (SPEC_FIELDS_BY_CATEGORY), and a rule that's implemented twice is a rule
 * that eventually disagrees with itself. The parent owns brand state so it
 * can also own "the category changed" — see the effect below.
 *
 * Everything here is optional. A seller who fills none of it in still gets
 * a listing; a seller who fills it in gets found by the buyers filtering on
 * exactly these fields.
 */
export default function ItemDetailsFields({
  category,
  subcategory,
  brand,
  onBrandChange,
  defaults,
  disabled = false,
  fieldErrors = {},
}: {
  category: string;
  subcategory: string;
  brand: string;
  onBrandChange: (brandId: string) => void;
  defaults?: Partial<ItemDetailsDefaults>;
  disabled?: boolean;
  fieldErrors?: Record<string, string>;
}) {
  // A brand that made sense under the old category usually doesn't under
  // the new one (Motocaddy is a trolley brand, not a wedge brand). Clearing
  // it is the honest behaviour: silently keeping it would submit a brand
  // the schema rejects, and silently mapping it to something else would put
  // words in the seller's mouth.
  useEffect(() => {
    if (brand && category && !isBrandValidFor(brand, category, subcategory)) {
      onBrandChange("");
    }
  }, [brand, category, subcategory, onBrandChange]);

  const specFields = specFieldsFor(category);
  const showSpec = (field: SpecField) => specFields.includes(field);

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="grid gap-1.5">
          <label htmlFor="brand-input" className="text-[13.5px] font-bold">
            Brand <span className="font-normal text-ink-500">(optional)</span>
          </label>
          <BrandCombobox
            category={category}
            subcategory={subcategory}
            value={brand}
            onChange={onBrandChange}
            disabled={disabled}
          />
          <p className="text-xs text-ink-500">
            Buyers filter by brand — adding it is the single biggest thing that helps your item get found.
          </p>
          <FieldError message={fieldErrors.brand} />
        </div>

        {brand === "other" ? (
          <div className="grid gap-1.5">
            <label htmlFor="brandOther" className="text-[13.5px] font-bold">
              Brand name
            </label>
            <input
              id="brandOther"
              name="brandOther"
              maxLength={MAX_BRAND_OTHER_LENGTH}
              disabled={disabled}
              defaultValue={defaults?.brand_other ?? ""}
              placeholder="Type the brand as it appears on the item"
              className={`${inputClass} disabled:opacity-60`}
            />
            <FieldError message={fieldErrors.brandOther} />
          </div>
        ) : (
          showSpec("model") && (
            <div className="grid gap-1.5">
              <label htmlFor="model" className="text-[13.5px] font-bold">
                {SPEC_FIELD_LABELS.model} <span className="font-normal text-ink-500">(optional)</span>
              </label>
              <input
                id="model"
                name="model"
                maxLength={MAX_MODEL_LENGTH}
                disabled={disabled}
                defaultValue={defaults?.model ?? ""}
                placeholder={SPEC_FIELD_PLACEHOLDERS.model}
                className={`${inputClass} disabled:opacity-60`}
              />
              <FieldError message={fieldErrors.model} />
            </div>
          )
        )}
      </div>

      {/* When "Other" took the model field's slot above, model gets its own
       * row rather than being dropped — a seller typing a brand we don't
       * know still wants to say which model it is. */}
      {brand === "other" && showSpec("model") && (
        <div className="grid gap-1.5">
          <label htmlFor="model" className="text-[13.5px] font-bold">
            {SPEC_FIELD_LABELS.model} <span className="font-normal text-ink-500">(optional)</span>
          </label>
          <input
            id="model"
            name="model"
            maxLength={MAX_MODEL_LENGTH}
            disabled={disabled}
            defaultValue={defaults?.model ?? ""}
            placeholder={SPEC_FIELD_PLACEHOLDERS.model}
            className={`${inputClass} disabled:opacity-60`}
          />
          <FieldError message={fieldErrors.model} />
        </div>
      )}

      {(showSpec("dexterity") || showSpec("shaftFlex") || showSpec("shaftMaterial")) && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {showSpec("dexterity") && (
            <div className="grid gap-1.5">
              <label htmlFor="dexterity" className="text-[13.5px] font-bold">
                {SPEC_FIELD_LABELS.dexterity} <span className="font-normal text-ink-500">(optional)</span>
              </label>
              <select
                id="dexterity"
                name="dexterity"
                disabled={disabled}
                defaultValue={defaults?.dexterity ?? ""}
                className={`${inputClass} disabled:opacity-60`}
              >
                <option value="">Not specified</option>
                {DEXTERITIES.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              <FieldError message={fieldErrors.dexterity} />
            </div>
          )}
          {showSpec("shaftFlex") && (
            <div className="grid gap-1.5">
              <label htmlFor="shaftFlex" className="text-[13.5px] font-bold">
                {SPEC_FIELD_LABELS.shaftFlex} <span className="font-normal text-ink-500">(optional)</span>
              </label>
              <select
                id="shaftFlex"
                name="shaftFlex"
                disabled={disabled}
                defaultValue={defaults?.shaft_flex ?? ""}
                className={`${inputClass} disabled:opacity-60`}
              >
                <option value="">Not specified</option>
                {SHAFT_FLEXES.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
              <FieldError message={fieldErrors.shaftFlex} />
            </div>
          )}
          {showSpec("shaftMaterial") && (
            <div className="grid gap-1.5">
              <label htmlFor="shaftMaterial" className="text-[13.5px] font-bold">
                {SPEC_FIELD_LABELS.shaftMaterial} <span className="font-normal text-ink-500">(optional)</span>
              </label>
              <select
                id="shaftMaterial"
                name="shaftMaterial"
                disabled={disabled}
                defaultValue={defaults?.shaft_material ?? ""}
                className={`${inputClass} disabled:opacity-60`}
              >
                <option value="">Not specified</option>
                {SHAFT_MATERIALS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <FieldError message={fieldErrors.shaftMaterial} />
            </div>
          )}
        </div>
      )}

      {(showSpec("loft") || showSpec("itemSize")) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {showSpec("loft") && (
            <div className="grid gap-1.5">
              <label htmlFor="loft" className="text-[13.5px] font-bold">
                {SPEC_FIELD_LABELS.loft} <span className="font-normal text-ink-500">(optional)</span>
              </label>
              <input
                id="loft"
                name="loft"
                maxLength={MAX_SPEC_LENGTH}
                disabled={disabled}
                defaultValue={defaults?.loft ?? ""}
                placeholder={SPEC_FIELD_PLACEHOLDERS.loft}
                className={`${inputClass} disabled:opacity-60`}
              />
              <FieldError message={fieldErrors.loft} />
            </div>
          )}
          {showSpec("itemSize") && (
            <div className="grid gap-1.5">
              <label htmlFor="itemSize" className="text-[13.5px] font-bold">
                {SPEC_FIELD_LABELS.itemSize} <span className="font-normal text-ink-500">(optional)</span>
              </label>
              <input
                id="itemSize"
                name="itemSize"
                maxLength={MAX_SPEC_LENGTH}
                disabled={disabled}
                defaultValue={defaults?.item_size ?? ""}
                placeholder={SPEC_FIELD_PLACEHOLDERS.itemSize}
                className={`${inputClass} disabled:opacity-60`}
              />
              <FieldError message={fieldErrors.itemSize} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
