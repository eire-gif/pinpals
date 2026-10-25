import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SWITCH_PARAMS, switchRoute } from "@/lib/auth/account-switch";

export const metadata = { title: "Switch account? · PinPals", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * "You're already signed in as X" — shown when a sign-in link is opened in a
 * browser that's signed in already. See src/lib/auth/account-switch.ts.
 */
export default async function SwitchAccountPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const route = switchRoute(params.route);
  if (!route) redirect("/");

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email;

  const fields = SWITCH_PARAMS.flatMap((key) => {
    const value = params[key];
    return typeof value === "string" ? [[key, value] as const] : [];
  });

  return (
    <div className="max-w-md mx-auto px-6 py-20">
      <div className="text-center mb-8">
        <span className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-green-700">
          <span className="w-5 h-0.5 bg-gold-500 inline-block" /> Check before you continue
        </span>
        <h1 className="font-display font-bold text-3xl mt-2">You&rsquo;re already signed in</h1>
        <p className="text-ink-500 mt-3 text-sm">
          {email ? (
            <>
              This browser is signed in as <strong className="text-ink-900">{email}</strong>.{" "}
            </>
          ) : null}
          The link you opened signs in to an account from an email or the app. If you didn&rsquo;t ask for it
          yourself just now, stay where you are — someone may be trying to get you to use their account.
        </p>
      </div>
      <div className="bg-surface rounded-2xl shadow-lg p-8 space-y-3">
        <Link
          href="/dashboard"
          className="block w-full text-center rounded-xl bg-green-700 text-white font-bold py-3"
        >
          {email ? `Stay signed in as ${email}` : "Stay signed in"}
        </Link>
        <form method="post" action={route}>
          {fields.map(([key, value]) => (
            <input key={key} type="hidden" name={key} value={value} />
          ))}
          <button type="submit" className="w-full rounded-xl border-2 border-green-700 text-green-700 font-bold py-3">
            I asked for this link — continue
          </button>
        </form>
      </div>
    </div>
  );
}
