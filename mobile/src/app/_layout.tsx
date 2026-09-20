import { useEffect, useRef } from "react";
import { Stack, useRouter, useSegments, type Href } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as Notifications from "expo-notifications";
import * as SplashScreen from "expo-splash-screen";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider, useAuth } from "@/lib/auth";
import { hrefFromNotification, registerForPush } from "@/lib/push";
import { colors } from "@/lib/theme";

void SplashScreen.preventAutoHideAsync();

/**
 * The auth gate.
 *
 * Kept in its own component below <AuthProvider> because it needs the session,
 * and a provider cannot consume its own context. The effect runs on every
 * change of session or route, which is what makes sign-out from any screen
 * land back on login without each screen having to handle it.
 */
function RootNavigator() {
  const { session, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;

    void SplashScreen.hideAsync();

    // Keyed on "is this the login screen", NOT "is this inside (tabs)". The
    // latter looks equivalent until a signed-in route lives outside the tab
    // group — invite/[id] does — and then every push to it is immediately
    // bounced back to the tabs.
    const onLogin = segments[0] === "login";

    if (!session && !onLogin) {
      router.replace("/login");
    } else if (session && onLogin) {
      router.replace("/(tabs)");
    }
  }, [session, loading, segments, router]);

  // ---------------------------------------------------------------------
  // Push registration
  // ---------------------------------------------------------------------
  //
  // Keyed on the USER id, not on the session object, which is replaced on
  // every token refresh — roughly hourly. Registering is an insert-or-update
  // on a unique endpoint so it would be harmless, but it would also mean a
  // permission prompt's worth of work every hour for no reason.
  //
  // It runs after sign-in rather than on first launch deliberately: iOS
  // allows exactly one system prompt per install, and a member who is asked
  // before they know what the app is says no, permanently.
  const registeredFor = useRef<string | null>(null);

  useEffect(() => {
    const userId = session?.user?.id ?? null;
    if (!userId || registeredFor.current === userId) return;

    registeredFor.current = userId;
    void registerForPush().then((result) => {
      if (!result.ok) console.warn(`[push] not registered: ${result.reason}`);
    });
  }, [session?.user?.id]);

  // ---------------------------------------------------------------------
  // Tapping a notification
  // ---------------------------------------------------------------------
  //
  // A notification that can only open the app makes the member hunt for the
  // thing it was about. `href` is the same path the web payload carries, so
  // both channels lead to the same screen and there is one definition of
  // where an event goes.

  useEffect(() => {
    // Waiting on the auth gate matters: routing to /invite/12 while the gate
    // is still deciding gets it immediately replaced by /login.
    if (loading || !session) return;

    let active = true;

    // The cold-start case. A tap that launched the app is not delivered to
    // the listener below — it has already happened by the time React mounts.
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!active) return;
      const href = hrefFromNotification(response?.notification);
      if (href) router.push(href as Href);
    });

    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const href = hrefFromNotification(response.notification);
        if (href) router.push(href as Href);
      }
    );

    return () => {
      active = false;
      subscription.remove();
    };
  }, [loading, session, router]);

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.cream50 },
        headerTintColor: colors.ink900,
        headerTitleStyle: { fontWeight: "700" },
        contentStyle: { backgroundColor: colors.cream50 },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen
        name="invite/[id]"
        options={{ title: "Tee time", headerBackTitle: "Back" }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="dark" />
        <RootNavigator />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
