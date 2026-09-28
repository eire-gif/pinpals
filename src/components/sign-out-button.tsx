"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Logging out.
 *
 * Rendered twice: as a pill at the end of the desktop header row, and as a
 * full-width row at the bottom of the mobile sheet. The mobile one is new —
 * until it existed there was no way to log out at all on a phone, which is
 * where most members are. `className` is what lets the two look like the
 * thing they sit in rather than forcing one shape into both.
 *
 * `onSignedOut` closes the sheet. Without it the menu stays open over a page
 * that has just become the signed-out homepage, which reads as the button
 * having done nothing.
 */
export default function SignOutButton({
  className,
  onSignedOut,
}: {
  className?: string;
  onSignedOut?: () => void;
} = {}) {
  const router = useRouter();
  const supabase = createClient();

  async function handleSignOut() {
    await supabase.auth.signOut();
    onSignedOut?.();
    router.push("/");
    router.refresh();
  }

  return (
    <button
      onClick={handleSignOut}
      className={
        className ??
        "px-4 py-2.5 rounded-full text-sm font-semibold text-white/80 hover:text-white hover:bg-white/10 transition"
      }
    >
      Log out
    </button>
  );
}
