"use client";

import Link from "next/link";
import { useActionState } from "react";
import { logIn, type LoginState } from "./actions";

const initialState: LoginState = {};

export default function LoginForm({ next }: { next?: string }) {
  const [state, formAction, pending] = useActionState(logIn, initialState);

  return (
    <form action={formAction} className="grid gap-4">
      {/* Carried through the form rather than read from the URL in the
          action: a Server Action has no access to the page's query string.
          Still validated server-side — this field is as forgeable as the
          URL it came from. */}
      {next && <input type="hidden" name="next" value={next} />}
      <div className="grid gap-1.5">
        <label htmlFor="email" className="text-[13.5px] font-bold">Email</label>
        <input id="email" name="email" type="email" required autoComplete="email"
          className="px-3.5 py-3 rounded-lg border-[1.5px] border-line focus:outline-none focus:border-green-600" />
      </div>
      <div className="grid gap-1.5">
        <div className="flex items-center justify-between">
          <label htmlFor="password" className="text-[13.5px] font-bold">Password</label>
          <Link href="/forgot-password" className="text-[13px] text-green-700 font-bold hover:text-green-600">
            Forgot password?
          </Link>
        </div>
        <input id="password" name="password" type="password" required autoComplete="current-password"
          className="px-3.5 py-3 rounded-lg border-[1.5px] border-line focus:outline-none focus:border-green-600" />
      </div>

      {state.error && (
        <p className="text-sm text-red-600 bg-red-100 rounded-lg px-3.5 py-2.5">{state.error}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-1 w-full py-3.5 rounded-full font-bold bg-green-700 text-cream-50 hover:bg-green-600 transition disabled:opacity-60"
      >
        {pending ? "Logging in…" : "Log in"}
      </button>
    </form>
  );
}
