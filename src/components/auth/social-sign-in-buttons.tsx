import { continueWith } from "@/app/auth/social/actions";
import { enabledSocialProviders } from "@/lib/auth/social-providers";

/**
 * "Continue with Apple" / "Continue with Google" above the email form on
 * /login and /signup (Oct 2026). Renders nothing until a provider is switched
 * on (src/lib/auth/social-providers.ts), so the pages look as before.
 *
 * Styled to each company's rules: Apple's is black with the Apple mark,
 * Google's is white with the four-colour G.
 */
export default async function SocialSignInButtons({ next }: { next?: string }) {
  const providers = await enabledSocialProviders();
  if (providers.length === 0) return null;

  return (
    <div className="grid gap-2.5 mb-5">
      {providers.includes("apple") && (
        <form action={continueWith}>
          <input type="hidden" name="provider" value="apple" />
          {next && <input type="hidden" name="next" value={next} />}
          <button
            type="submit"
            className="w-full flex items-center justify-center gap-2.5 py-3.5 rounded-full font-bold bg-black text-white hover:bg-ink-900 transition"
          >
            <svg aria-hidden="true" width="17" height="20" viewBox="0 0 17 20" fill="currentColor">
              <path d="M14.1 10.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9C3.6 4.8 2 5.8 1.1 7.4c-1.8 3.2-.5 7.9 1.3 10.5.9 1.3 1.9 2.7 3.2 2.6 1.3-.1 1.8-.8 3.3-.8 1.6 0 2 .8 3.4.8 1.4 0 2.3-1.3 3.1-2.6 1-1.5 1.4-2.9 1.4-3-.1 0-2.7-1-2.7-4.3zM11.6 3c.7-.9 1.2-2 1-3.2-1 0-2.2.7-3 1.6-.6.7-1.2 1.9-1.1 3.1 1.2.1 2.3-.6 3.1-1.5z" />
            </svg>
            Continue with Apple
          </button>
        </form>
      )}
      {providers.includes("google") && (
        <form action={continueWith}>
          <input type="hidden" name="provider" value="google" />
          {next && <input type="hidden" name="next" value={next} />}
          <button
            type="submit"
            className="w-full flex items-center justify-center gap-2.5 py-3.5 rounded-full font-bold bg-white text-ink-900 border-[1.5px] border-line hover:bg-cream-100 transition"
          >
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 48 48">
              <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z" />
              <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.5 5.8c4.4-4 6.8-10 6.8-17.2z" />
              <path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s.9 7.4 2.7 10.7l7.8-6.1z" />
              <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.2 0-11.5-4.2-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z" />
            </svg>
            Continue with Google
          </button>
        </form>
      )}
      <div className="flex items-center gap-3 mt-1 text-xs text-ink-500">
        <span className="h-px flex-1 bg-line" />
        or use your email
        <span className="h-px flex-1 bg-line" />
      </div>
    </div>
  );
}
