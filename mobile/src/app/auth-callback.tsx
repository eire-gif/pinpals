import { useEffect, useRef } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";

import { routeAfterSignIn } from "@/lib/signup-code";
import { completeFromRedirect } from "@/lib/social-sign-in";
import { supabase } from "@/lib/supabase";
import { colors } from "@/lib/theme";

/**
 * pinpals://auth-callback — where Google sends a member back to after
 * "Continue with Google" (lib/social-sign-in.ts).
 *
 * Normally nobody sees this: the browser sheet catches the link and hands it
 * to signInWithGoogle() directly. On some Android phones the link also opens
 * the app, and expo-router lands here. If the sign-in finished (or is
 * finishing) elsewhere, this simply steps out of the way; if the app was
 * started fresh by the link, the code is redeemed here.
 *
 * Reachable signed out: the auth gate in _layout.tsx lets this screen through.
 */
export default function AuthCallbackScreen() {
  const router = useRouter();
  const url = Linking.useURL();
  const started = useRef(false);
  const latestUrl = useRef<string | null>(null);
  latestUrl.current = url;

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const t = setTimeout(() => {
      void (async () => {
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          if (router.canGoBack()) router.back();
          else router.replace(await routeAfterSignIn(data.session.user.id));
          return;
        }
        const link = latestUrl.current ?? (await Linking.getInitialURL());
        const result = link ? await completeFromRedirect(link) : null;
        if (result?.ok) router.replace(await routeAfterSignIn(result.userId));
        else router.replace("/login");
      })();
    }, 600); // give the browser sheet's own completion the first go
    return () => clearTimeout(t);
  }, [router]);

  return (
    <View style={styles.fill}>
      <ActivityIndicator color={colors.cream50} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.navy900 },
});
