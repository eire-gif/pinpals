import Image from "next/image";
import { initials } from "@/lib/format";

// Small, medium, large — table rows use sm, detail-page headers use lg.
const SIZE_CLASSES = {
  sm: "w-9 h-9 text-xs",
  md: "w-12 h-12 text-sm",
  lg: "w-16 h-16 text-xl",
} as const;

const SIZE_PX = { sm: 36, md: 48, lg: 64 } as const;

/**
 * The admin surface's avatar. Mirrors MemberAvatar
 * (src/components/member-avatar.tsx) — same photo-then-initials fallback,
 * same reasoning — but kept as its own component because the two have
 * different size scales and the admin/member split is a boundary this
 * codebase maintains deliberately elsewhere (see SELLER_LISTING_STATUS_LABELS
 * vs admin/format.ts's own map).
 *
 * `avatarUrl` is optional: a call site that hasn't been passed a profile's
 * photo yet simply keeps rendering initials, so adding it to the remaining
 * admin pages is incremental rather than all-or-nothing.
 */
export default function AdminAvatar({
  name,
  color,
  avatarUrl,
  size = "sm",
}: {
  name: string;
  color: string | null;
  avatarUrl?: string | null;
  size?: keyof typeof SIZE_CLASSES;
}) {
  if (avatarUrl) {
    const px = SIZE_PX[size];
    return (
      <div className={`shrink-0 rounded-full overflow-hidden relative bg-cream-100 ${SIZE_CLASSES[size]}`}>
        <Image src={avatarUrl} alt="" width={px} height={px} className="w-full h-full object-cover" />
      </div>
    );
  }

  return (
    <div
      className={`shrink-0 rounded-full flex items-center justify-center text-white font-display font-bold ${SIZE_CLASSES[size]}`}
      style={{ background: color ?? "#1f5c2e" }}
    >
      {initials(name)}
    </div>
  );
}
