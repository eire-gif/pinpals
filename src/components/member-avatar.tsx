import Image from "next/image";
import { initials } from "@/lib/format";

/**
 * A member's avatar: their uploaded photo when they have one, their
 * initials on their own colour when they don't.
 *
 * One component for every member-facing surface (directory tiles, profile
 * pages, seller cards, conversations, dashboard) so a photo can never
 * appear in some places and initials in others for the same person — the
 * inconsistency that made "photos on the tiles only" the wrong scope for
 * this feature. AdminAvatar (src/components/admin/avatar.tsx) is the
 * equivalent for the admin surface and takes the same `avatarUrl` prop.
 *
 * The initials fallback is permanent, not a loading state: most members
 * will never upload a photo, and a circle with their initials is a
 * deliberate part of the design rather than a placeholder to be apologised
 * for.
 */

const SIZE_CLASSES = {
  xs: "w-8 h-8 text-xs",
  sm: "w-9 h-9 text-xs",
  md: "w-11 h-11 text-sm",
  lg: "w-14 h-14 text-lg",
  xl: "w-16 h-16 text-xl",
} as const;

/** Rendered pixel width per size, for next/image's own sizing. Kept beside
 * SIZE_CLASSES so the two can't drift: a wrong value here costs image
 * quality (a 32px source stretched to 64px), not layout. */
const SIZE_PX = {
  xs: 32,
  sm: 36,
  md: 44,
  lg: 56,
  xl: 64,
} as const;

export type MemberAvatarSize = keyof typeof SIZE_CLASSES;

export default function MemberAvatar({
  name,
  avatarUrl,
  color,
  size = "md",
  className = "",
}: {
  name: string;
  avatarUrl?: string | null;
  color?: string | null;
  size?: MemberAvatarSize;
  className?: string;
}) {
  const base = `shrink-0 rounded-full overflow-hidden ${SIZE_CLASSES[size]} ${className}`;

  if (avatarUrl) {
    const px = SIZE_PX[size];
    return (
      <div className={`${base} relative bg-cream-100`}>
        <Image
          src={avatarUrl}
          // Decorative: every call site already renders the member's name
          // as text immediately beside this. An alt of "Photo of Conor
          // Murphy" would make a screen reader announce the name twice.
          alt=""
          width={px}
          height={px}
          className="w-full h-full object-cover"
        />
      </div>
    );
  }

  return (
    <div
      className={`${base} flex items-center justify-center text-white font-display font-bold`}
      style={{ background: color ?? "#1f5c2e" }}
      aria-hidden="true"
    >
      {initials(name)}
    </div>
  );
}
