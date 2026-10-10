import type { Tile } from "@/components/form-bits";
import { CATEGORIES, type Category } from "./listings";

/**
 * The marketplace's categories as picture tiles (Oct 2026) — the listing
 * form and the filter sheet. Icons are Material Design Icons, shipped with
 * @expo/vector-icons.
 */
const CATEGORY_ICONS: Record<Category, Tile["icon"]> = {
  Drivers: "golf",
  "Woods & hybrids": "golf-tee",
  Irons: "numeric-7-box-outline",
  Wedges: "angle-acute",
  Putters: "flag-variant",
  "Full sets": "layers-triple",
  "Bags & trolleys": "bag-personal",
  "Shoes & apparel": "tshirt-crew",
  "Balls & accessories": "circle-slice-8",
};

export const CATEGORY_TILES: Tile[] = CATEGORIES.map((c) => ({ key: c, label: c, icon: CATEGORY_ICONS[c] }));
