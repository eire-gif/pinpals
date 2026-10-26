import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";

import { supabase } from "./supabase";

type AuthState = {
  session: Session | null;
  /** True until the stored session has been read back from the Keychain. */
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  /**
   * Finish joining with the 6-digit code from the confirmation email. On
   * success Supabase returns a session, the gate in _layout.tsx sees it, and
   * — because this sets `consumeJustJoined` — sends the new member to the
   * profile builder rather than to Home.
   */
  verifySignUp: (email: string, code: string) => Promise<{ error: string | null }>;
  /**
   * True exactly once after verifySignUp succeeds, then false. Read by the
   * auth gate to decide between the profile builder and Home. A ref rather
   * than state: flipping it must not re-render anything, and it has to be
   * readable synchronously inside the effect that does the routing.
   */
  consumeJustJoined: () => boolean;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const justJoined = useRef(false);

  useEffect(() => {
    let active = true;

    // Reading from SecureStore is async, so on a cold start there is a moment
    // where we do not yet know whether anyone is signed in. `loading` exists so
    // the root layout can hold the splash rather than flashing the login screen
    // at a member who is already signed in.
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, next) => {
        setSession(next);
      }
    );

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      session,
      loading,
      signIn: async (email, password) => {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        // Deliberately not distinguishing "no such account" from "wrong
        // password" — the same reasoning the website's login action uses.
        return { error: error ? "That email and password don't match." : null };
      },
      signOut: async () => {
        await supabase.auth.signOut();
      },
      verifySignUp: async (email, code) => {
        justJoined.current = true;
        const { error } = await supabase.auth.verifyOtp({
          email: email.trim(),
          token: code.trim(),
          type: "signup",
        });
        if (error) {
          justJoined.current = false;
          // Supabase answers an expired code and a wrong one with the same
          // error, and so do we.
          return { error: "That code didn't work. Check it, or send a new one." };
        }
        return { error: null };
      },
      consumeJustJoined: () => {
        const value = justJoined.current;
        justJoined.current = false;
        return value;
      },
    }),
    [session, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
