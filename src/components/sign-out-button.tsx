"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function SignOutButton() {
  const router = useRouter();
  const supabase = createClient();

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <button
      onClick={handleSignOut}
      className="px-4 py-2.5 rounded-full text-sm font-semibold text-white/80 hover:text-white hover:bg-white/10 transition"
    >
      Log out
    </button>
  );
}
