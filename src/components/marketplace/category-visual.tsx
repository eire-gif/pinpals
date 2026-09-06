import type { ReactNode } from "react";
import type { MockCategory } from "@/lib/marketplace-fixtures";

// Every listing in the development fixture (src/lib/marketplace-fixtures.ts)
// renders as a stylised category tile rather than a real photo — there is no
// storage bucket or upload path wired up in this phase, and reaching for
// placeholder images from an external host would need next.config.ts image
// domain configuration this phase deliberately doesn't touch. A tinted tile
// with a simple line icon keeps the grid visually complete and on-brand
// without implying real product photography exists yet.
type CategoryVisual = { tint: string; iconColor: string; icon: ReactNode };

const ICON_PROPS = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const CATEGORY_VISUALS: Record<MockCategory, CategoryVisual> = {
  Drivers: {
    tint: "#eef2ec",
    iconColor: "#1f5c2e",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M7 20l7-15 4 2-6 15-5-2z" />
        <path d="M14 5l3-2 1.5 3-3 1.5" />
      </svg>
    ),
  },
  "Woods & hybrids": {
    tint: "#eef2ec",
    iconColor: "#1f5c2e",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M9 20l4-16 4 1.5-5 16z" />
        <ellipse cx="14" cy="5.5" rx="2.6" ry="1.6" transform="rotate(-20 14 5.5)" />
      </svg>
    ),
  },
  Irons: {
    tint: "#f3f0e6",
    iconColor: "#b6862a",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M8 20l6-14" />
        <path d="M14 6l3.5-1.2a1.4 1.4 0 011.8 1.7L18 10l-6 2.5" />
      </svg>
    ),
  },
  Wedges: {
    tint: "#f3f0e6",
    iconColor: "#b6862a",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M9 20l5-13" />
        <path d="M14 7l4-2 1 2.2-4 2.3" />
        <path d="M15.5 8.5l1 2" />
      </svg>
    ),
  },
  Putters: {
    tint: "#eef2ec",
    iconColor: "#1f5c2e",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M10 20l3-13" />
        <path d="M13 7l5-1v3l-5 .8" />
        <circle cx="7" cy="20" r="1.4" />
      </svg>
    ),
  },
  "Full sets": {
    tint: "#eaf0e8",
    iconColor: "#173f22",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M6 20V6.5A1.5 1.5 0 017.5 5h1A1.5 1.5 0 0110 6.5V20" />
        <path d="M14 20V4.5A1.5 1.5 0 0115.5 3h1A1.5 1.5 0 0118 4.5V20" />
        <rect x="4.5" y="20" width="15" height="1.6" rx="0.8" />
      </svg>
    ),
  },
  "Bags & trolleys": {
    tint: "#f3f0e6",
    iconColor: "#b6862a",
    icon: (
      <svg {...ICON_PROPS}>
        <rect x="5" y="9" width="10" height="11" rx="1.6" />
        <path d="M7 9V6.5A1.5 1.5 0 018.5 5h3A1.5 1.5 0 0113 6.5V9" />
        <circle cx="18" cy="17" r="2" />
        <path d="M15.5 15.3l-1.2-1.3" />
      </svg>
    ),
  },
  "Shoes & apparel": {
    tint: "#f6e9e6",
    iconColor: "#a83a2b",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M4 17.5V13c1.6 0 2.6-.5 3.4-1.4l1.9-2c.5-.6 1.3-.6 1.9-.1l1 1c.6.6 1.4.9 2.3.9H18a2 2 0 012 2v4.1H4z" />
        <path d="M4 17.5h16" />
      </svg>
    ),
  },
  "Balls & accessories": {
    tint: "#eef2ec",
    iconColor: "#1f5c2e",
    icon: (
      <svg {...ICON_PROPS}>
        <circle cx="12" cy="12" r="7" />
        <circle cx="9.5" cy="9.5" r="0.6" fill="currentColor" stroke="none" />
        <circle cx="13" cy="8.5" r="0.6" fill="currentColor" stroke="none" />
        <circle cx="14.5" cy="12" r="0.6" fill="currentColor" stroke="none" />
        <circle cx="10.5" cy="14" r="0.6" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
};

export function CategoryTile({
  category,
  className = "w-10 h-10",
}: {
  category: MockCategory;
  className?: string;
}) {
  const visual = CATEGORY_VISUALS[category];
  return (
    <div className={className} style={{ color: visual.iconColor }} aria-hidden="true">
      {visual.icon}
    </div>
  );
}

export function categoryTint(category: MockCategory): string {
  return CATEGORY_VISUALS[category].tint;
}
