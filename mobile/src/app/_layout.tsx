import { useEffect, useRef } from "react";
import { useFonts } from "expo-font";
import {
  PlayfairDisplay_700Bold,
  PlayfairDisplay_700Bold_Italic,
} from "@expo-google-fonts/playfair-display";
import {
  PublicSans_400Regular,
  PublicSans_600SemiBold,
  PublicSans_700Bold,
} from "@expo-google-fonts/public-sans";
import { Stack, useRouter, useSegments, type Href } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as Notifications from "expo-notifications";
import * as SplashScreen from "expo-splash-screen";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { appRouteFor } from "@/lib/alert-routes";
import { AuthProvider, useAuth } from "@/lib/auth";
import { hrefFromNotification, registerForPush } from "@/lib/push";
import { colors, fonts } from "@/lib/theme";

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

  // Held behind the splash alongside the session read. Rendering a screen in
  // the system font and then swapping it for Playfair a beat later is worse
  // than waiting — the whole layout shifts under the member.
  const [fontsLoaded] = useFonts({
    PlayfairDisplay_700Bold,
    PlayfairDisplay_700Bold_Italic,
    PublicSans_400Regular,
    PublicSans_600SemiBold,
    PublicSans_700Bold,
  });

  useEffect(() => {
    if (loading || !fontsLoaded) return;

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
  }, [session, loading, fontsLoaded, segments, router]);

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
  // both channels lead to the same event.
  //
  // IT IS A WEBSITE PATH, AND IT HAS TO BE TRANSLATED. Notifications predate
  // the app, so `data.href` is something like /tee-times/interested — a page
  // on pinpals.ie, not a route in src/app. Pushing it straight into
  // expo-router lands on "Unmatched Route", which is what tapping a
  // tee-time push used to do.
  //
  // appRouteFor() is the same table the inbox uses for a tapped alert row,
  // so both ways of opening the same notification now go to the same screen.
  // It was wired into the inbox and not into here, which is exactly the kind
  // of half-fix a second entry point invites.

  useEffect(() => {
    // Waiting on the auth gate matters: routing to /invite/12 while the gate
    // is still deciding gets it immediately replaced by /login.
    if (loading || !session) return;

    let active = true;

    const open = (href: string | null) => {
      if (!href) return;
      const route = appRouteFor(href);
      if (route.kind === "native") {
        router.push(route.path as Href);
        return;
      }
      // No native screen for it — the app's own web view, signed in, rather
      // than a dead end.
      router.push({ pathname: "/web", params: { path: route.path, title: "PinPals" } });
    };

    // The cold-start case. A tap that launched the app is not delivered to
    // the listener below — it has already happened by the time React mounts.
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!active) return;
      open(hrefFromNotification(response?.notification));
    });

    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => open(hrefFromNotification(response.notification))
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
        headerTitleStyle: { fontFamily: fonts.display, fontSize: 19 },
        contentStyle: { backgroundColor: colors.cream50 },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ headerShown: false }} />
      {/* The profile builder. No swipe-back: going "back" out of step one
          would land on a signed-in screen the member hasn't seen yet. */}
      <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="course/[id]" options={{ title: "Course", headerBackTitle: "Back" }} />
      <Stack.Screen name="course/review" options={{ presentation: "modal", title: "Rate & review" }} />
      {/* Comments open as a sheet over the feed (phase 5): the card stays
          collapsed and the conversation has a screen of its own. Set here,
          not in the screen — iOS can't change presentation after a push. */}
      <Stack.Screen name="comments/[id]" options={{ presentation: "modal", title: "Comments" }} />
      <Stack.Screen
        name="invite/[id]"
        options={{ title: "Tee time", headerBackTitle: "Back" }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    // GestureHandlerRootView explicitly, rather than relying on expo-router
    // providing one. Swipe-to-delete in the inbox is the first thing in the
    // app to use a gesture handler directly, and a missing root is the
    // failure where the gesture silently does nothing on a device while
    // everything still compiles.
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <StatusBar style="dark" />
          <RootNavigator />
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
