import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";

import { supabase } from "./supabase";
import { disconnectWidget } from "./widgets";
import { endAllLockScreens } from "./lock-screen";
import { clearMembership } from "./membership";
import { clearAgeAccess } from "./age";

type AuthState = {
  session: Session | null;
  /** True until the stored session has been read back from the Keychain. */
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

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
      (event, next) => {
        setSession(next);
        // However the member ends up signed out (here, deleting the
        // account, a revoked session), the Home Screen widget forgets them.
        if (event === "SIGNED_OUT") {
          // Junior members (0159): the next member on this phone mustn't
          // inherit my age answer, in memory or on disk.
          clearAgeAccess();
          disconnectWidget();
          endAllLockScreens();
        }
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
        // This phone only. The default ("global") would also sign the member
        // out of the website on every browser they use.
        await supabase.auth.signOut({ scope: "local" });
        // The next member to sign in on this phone mustn't inherit my plan.
        clearMembership();
        clearAgeAccess();
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
