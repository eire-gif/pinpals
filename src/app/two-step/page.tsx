import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/admin/authorization";
import { createClient } from "@/lib/supabase/server";
import { adminReturnPath } from "@/lib/admin/return-path";
import TwoStepForm from "./two-step-form";

export const metadata = { title: "Two-step sign-in · PinPals", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Two-step sign-in for staff: set up an authenticator app the first time,
 * then a six-digit code each time you sign in to Admin. requireStaff() sends
 * staff here; members get the usual 404.
 */
export default async function TwoStepPage() {
  await requireStaff({ requiredAal: "aal1" });

  // Where to go afterwards: the admin page that sent them here (set by
  // src/proxy.ts), if it is one; otherwise the Overview.
  const remembered = (await cookies()).get("pp_admin_next")?.value ?? "";
  const next = adminReturnPath(remembered);

  const supabase = await createClient();
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (data?.currentLevel === "aal2") redirect(next);

  return (
    <div className="max-w-md mx-auto px-6 py-20">
      <div className="text-center mb-8">
        <span className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-green-700">
          <span className="w-5 h-0.5 bg-gold-500 inline-block" /> Staff
        </span>
        <h1 className="font-display font-bold text-3xl mt-2">Two-step sign-in</h1>
        <p className="text-ink-500 mt-2 text-sm">
          Admin needs a code from an authenticator app as well as your password, so a stolen password alone can&rsquo;t open it.
        </p>
      </div>
      <div className="bg-surface rounded-2xl shadow-lg p-8">
        <TwoStepForm hasFactor={data?.nextLevel === "aal2"} next={next} />
      </div>
    </div>
  );
}

