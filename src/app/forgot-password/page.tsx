import Link from "next/link";
import ForgotPasswordForm from "./forgot-password-form";

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="max-w-md mx-auto px-6 py-20">
      <div className="text-center mb-8">
        <span className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-green-700">
          <span className="w-5 h-0.5 bg-gold-500 inline-block" /> Reset password
        </span>
        <h1 className="font-display font-bold text-3xl mt-2">Forgot your password?</h1>
      </div>
      <div className="bg-surface rounded-2xl shadow-lg p-8">
        {error === "expired" && (
          <p className="text-sm text-red-600 bg-red-100 rounded-lg px-3.5 py-2.5 mb-4">
            That reset link has expired or was already used. Enter your email to get a fresh one.
          </p>
        )}
        <ForgotPasswordForm />
        <p className="text-sm text-ink-500 text-center mt-5">
          Remembered it?{" "}
          <Link href="/login" className="text-green-700 font-bold">
            Back to log in →
          </Link>
        </p>
      </div>
    </div>
  );
}
