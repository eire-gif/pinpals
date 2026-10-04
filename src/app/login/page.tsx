import Link from "next/link";
import LoginForm from "./login-form";
import { safeRedirectPath } from "@/lib/safe-redirect";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; confirmed?: string; confirm_error?: string }>;
}) {
  // Anything that isn't a real path on this site is dropped here, so the
  // hidden field below never even carries it.
  const { next, confirmed, confirm_error } = await searchParams;
  const safeNext = safeRedirectPath(next);

  return (
    <div className="max-w-md mx-auto px-6 py-20">
      <div className="text-center mb-8">
        <span className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-green-700">
          <span className="w-5 h-0.5 bg-gold-500 inline-block" /> Welcome back
        </span>
        <h1 className="font-display font-bold text-3xl mt-2">Log in to Pinpals.</h1>
      </div>
      {/* Where /auth/confirm sends a member whose link couldn't sign them in
          here. "confirmed": the address is confirmed, the link was opened in
          another browser. "confirm_error": the link had expired or was used. */}
      {confirmed ? (
        <p role="status" className="mb-4 rounded-xl bg-green-100 text-green-800 text-sm font-semibold px-4 py-3 text-center">
          Your email is confirmed. Log in to get started.
        </p>
      ) : confirm_error ? (
        <p role="status" className="mb-4 rounded-xl bg-red-100 text-red-600 text-sm font-semibold px-4 py-3 text-center">
          That confirmation link has expired or was already used. Log in — or sign up again to get a fresh link.
        </p>
      ) : null}
      <div className="bg-surface rounded-2xl shadow-lg p-8">
        <LoginForm next={safeNext ?? undefined} />
        <p className="text-sm text-ink-500 text-center mt-5">
          New here?{" "}
          <Link href="/signup" className="text-green-700 font-bold">
            Create an account →
          </Link>
        </p>
      </div>
    </div>
  );
}
