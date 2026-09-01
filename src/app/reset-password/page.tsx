import ResetPasswordForm from "./reset-password-form";

export default function ResetPasswordPage() {
  return (
    <div className="max-w-md mx-auto px-6 py-20">
      <div className="text-center mb-8">
        <span className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-green-700">
          <span className="w-5 h-0.5 bg-gold-500 inline-block" /> Almost there
        </span>
        <h1 className="font-display font-bold text-3xl mt-2">Choose a new password.</h1>
      </div>
      <div className="bg-surface rounded-2xl shadow-lg p-8">
        <ResetPasswordForm />
      </div>
    </div>
  );
}
