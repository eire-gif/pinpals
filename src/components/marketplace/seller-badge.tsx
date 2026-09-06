import { initials } from "@/lib/format";
import type { MockSeller } from "@/lib/marketplace-fixtures";

// Same avatar-circle-with-initials treatment already used for real members
// across the app (conversations list, dashboard) — reused here so a mock
// seller reads as visually consistent with a real profile once this phase
// reconnects to `profiles`, not like a different, one-off "product mockup"
// component.
export default function SellerBadge({
  seller,
  size = "md",
}: {
  seller: MockSeller;
  size?: "sm" | "md";
}) {
  const avatarSize = size === "sm" ? "w-8 h-8 text-xs" : "w-11 h-11 text-sm";

  return (
    <div className="flex items-center gap-3 min-w-0">
      <div
        className={`${avatarSize} rounded-full flex items-center justify-center text-white font-display font-bold shrink-0`}
        style={{ background: seller.avatarColor }}
        aria-hidden="true"
      >
        {initials(seller.name)}
      </div>
      <div className="min-w-0">
        <p className="font-semibold text-ink-900 truncate">{seller.name}</p>
        <p className="text-xs text-ink-500 truncate">
          {seller.homeClub ? `${seller.homeClub} · ` : ""}
          Member since {seller.memberSinceYear}
        </p>
      </div>
    </div>
  );
}
