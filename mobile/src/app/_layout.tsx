import { useEffect, useMemo, useRef } from "react";
import { AppState, Platform, View } from "react-native";
import { consumePendingInvite } from "@/lib/find-pinpals";
import { consumePendingGroupInvite } from "@/lib/groups-data";
import { consumePendingTeeLink } from "@/lib/tee-time-sharing";
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
import { SafeAreaInsetsContext, SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";

import { AdTakeoverHost } from "@/components/ad-takeover";
import { GlobalTabBar, wantsGlobalTabBar } from "@/components/global-tab-bar";
import { myRoundRight } from "@/components/my-round-pill";
import { MyRoundWatcher } from "@/lib/my-round";
import { reportScreen } from "@/lib/activity";
import { loadAgeAccess, useAgeAccess } from "@/lib/age";
import { gateFor, openWhileWaiting } from "@/lib/age-rules";
import { alertAction, appRouteFor } from "@/lib/alert-routes";
import { applyUpdateAtLaunch } from "@/lib/app-updates";
import { goHome } from "@/lib/go-home";
import { checkStoreAgeSignal } from "@/lib/store-age";
import { AuthProvider, useAuth } from "@/lib/auth";
import { hrefFromNotification, registerForPush, typeFromNotification } from "@/lib/push";
import { connectWidget } from "@/lib/widgets";
// Defines the lock screen distance task: iOS may wake the app just to deliver a location.
import "@/lib/lock-screen-location";
import { colors, contentColumn, fonts, headerTitleStyle } from "@/lib/theme";

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
  //
  // Android (Oct 2026): the fonts are built into the app by the expo-font
  // plugin in app.json, so nothing is loaded here. Loading them at runtime
  // as well left Android measuring text in the system font and drawing it in
  // Public Sans, which is wider — every label came out cut short ("Ho…",
  // "Phot"). On Android the embedded file name is the family name, so
  // fonts.* in lib/theme.ts resolves unchanged. iOS keeps loading at runtime:
  // its embedded fonts would register under their PostScript names instead.
  const [fontsLoaded] = useFonts(
    Platform.OS === "android"
      ? {}
      : {
          PlayfairDisplay_700Bold,
          PlayfairDisplay_700Bold_Italic,
          PublicSans_400Regular,
          PublicSans_600SemiBold,
          PublicSans_700Bold,
        },
  );

  // Junior members (0159): what this member may do by age (lib/age.ts).
  // Only an answer the server has actually given (`known`) holds anyone at a
  // screen — never the adult-like fallback used while offline.
  const age = useAgeAccess();
  const ageGate = session && age.known ? gateFor(age.access) : null;

  useEffect(() => {
    if (loading || !fontsLoaded) return;

    void SplashScreen.hideAsync();

    // Keyed on "is this the login screen", NOT "is this inside (tabs)". The
    // latter looks equivalent until a signed-in route lives outside the tab
    // group — invite/[id] does — and then every push to it is immediately
    // bounced back to the tabs.
    // Screens a signed-out visitor may be on: log in, sign up, and the
    // landing for a sign-up confirmation link (which signs them in and then
    // moves on by itself — so it is not bounced to the tabs here).
    const first = segments[0] as string | undefined;
    const onAuthForm = first === "login" || first === "signup";
    // card-link: a shared scorecard (pinpals.ie/c/…) opens for anyone.
    // join: a member's invite link or QR code (Find PinPals, 0118).
    // tee-link: a shared tee time (0132).
    const signedOutAllowed = onAuthForm || first === "auth-confirm" || first === "card-link" || first === "join" || first === "tee-link";

    if (!session && !signedOutAllowed) {
      router.replace("/login");
    } else if (session && onAuthForm) {
      router.replace("/(tabs)");
    } else if (session && ageGate && !signedOutAllowed) {
      // Junior members (0159). A member from before juniors adds their date
      // of birth, once; a 13–15 year old waits here until a parent says yes
      // — with the Rules of Golf, the course directory and the guides still
      // open to them. Not from the sign-up confirmation (it moves on by
      // itself and lands back here) or a signed-out page.
      if (ageGate === "dateOfBirth" && first !== "age") {
        router.replace("/age/date-of-birth");
      } else if (ageGate === "waiting" && !openWhileWaiting(first)) {
        router.replace("/age/waiting");
      }
    }
  }, [session, loading, fontsLoaded, segments, router, ageGate]);

  // The admin "Live now" panel (0161, lib/activity.ts): which section of the
  // app is on screen. Keyed on the joined segments so a re-render doesn't
  // count a second view of the same screen.
  const segmentKey = segments.join("/");
  useEffect(() => {
    if (loading) return;
    reportScreen(segments);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segmentKey, loading]);

  // The age answer is cached for five minutes; coming back to the app is
  // when a parent's "yes" (or a birthday) is most likely to have happened.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && session) void loadAgeAccess();
    });
    return () => sub.remove();
  }, [session]);

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
    // A new member on this phone: their own age answer, then (once a day,
    // adults only) what the app store says about their age (lib/store-age.ts).
    void loadAgeAccess(true).then((snap) => {
      if (snap.known) void checkStoreAgeSignal(userId, snap.access);
    });
    // An invite link opened before signing in (app/join.tsx): connect now.
    void consumePendingInvite().then((owner) => {
      if (owner) router.push({ pathname: "/member/[id]", params: { id: owner } });
    });
    // A group's invite link opened before signing in (app/join-group.tsx).
    // A shared tee time opened before signing in (app/tee-link.tsx).
    void consumePendingTeeLink().then((inviteId) => {
      if (inviteId) router.push({ pathname: "/invite/[id]", params: { id: String(inviteId) } });
    });
    void consumePendingGroupInvite().then((groupId) => {
      if (groupId) router.push({ pathname: "/group/[id]", params: { id: String(groupId) } });
    });
    void registerForPush().then((result) => {
      if (!result.ok) console.warn(`[push] not registered: ${result.reason}`);
    });
    // The Home Screen widget's key (lib/widgets.ts). iPhone only; a no-op elsewhere.
    void connectWidget(userId);
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

    const open = (href: string | null, type: string | null) => {
      // Junior members (0159): a change of age band or a parent's "yes"
      // changes what the app shows — fresh answer first, then Home.
      if (alertAction(type) === "refreshAge") {
        void loadAgeAccess(true).then(() => goHome());
        return;
      }
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
      open(hrefFromNotification(response?.notification), typeFromNotification(response?.notification));
    });

    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => open(hrefFromNotification(response.notification), typeFromNotification(response.notification))
    );

    return () => {
      active = false;
      subscription.remove();
    };
  }, [loading, session, router]);

  // The six tabs under every screen pushed over them (global-tab-bar.tsx).
  // The stack sits above the bar rather than under it, so no screen needs
  // to leave room; and with the bar taking the home indicator's strip, the
  // screens above are told the bottom inset is nothing, or every one that
  // pads for it would leave a gap over the bar.
  const insets = useSafeAreaInsets();
  const tabBar = !!session && wantsGlobalTabBar(segments as string[]);
  const stackInsets = useMemo(() => (tabBar ? { ...insets, bottom: 0 } : insets), [tabBar, insets]);

  return (
    <>
    <View style={{ flex: 1 }}>
    <SafeAreaInsetsContext.Provider value={stackInsets}>
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.cream50 },
        headerTintColor: colors.ink900,
        headerTitleStyle,
        // Every screen's back button says "Back". Without this, a screen
        // opened from the tabs showed the route group's name: "(tabs)".
        headerBackTitle: "Back",
        // iPad: every screen's content a centred column (theme.ts). A phone
        // is narrower than the column, so it changes nothing there.
        contentStyle: { backgroundColor: colors.cream50, ...contentColumn },
        // MY ROUND (Oct 2026): the green pill on every header while a round
        // you're playing in is live. A screen with its own right-hand
        // buttons spreads myRoundRight(...) or noMyRound(...) instead.
        ...myRoundRight(),
      }}
    >
      {/* Full width: the tab bar spans the screen; the tabs centre their own content. */}
      <Stack.Screen name="(tabs)" options={{ headerShown: false, title: "Back", contentStyle: { backgroundColor: colors.cream50 } }} />
      {/* Full width navy; the form centres itself (AUTH_COLUMN). */}
      <Stack.Screen name="login" options={{ headerShown: false, contentStyle: { backgroundColor: colors.navy900 } }} />
      <Stack.Screen name="signup" options={{ headerShown: false, contentStyle: { backgroundColor: colors.navy900 } }} />
      <Stack.Screen name="auth-confirm" options={{ headerShown: false, gestureEnabled: false, contentStyle: { backgroundColor: colors.navy900 } }} />
      {/* The profile builder. No swipe-back: going "back" out of step one
          would land on a signed-in screen the member hasn't seen yet. */}
      <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false }} />
      {/* Junior members (0159): full-screen stops — no header, no swipe-back. */}
      <Stack.Screen name="age/date-of-birth" options={{ headerShown: false, gestureEnabled: false, contentStyle: { backgroundColor: colors.navy900 } }} />
      <Stack.Screen name="age/waiting" options={{ headerShown: false, gestureEnabled: false, contentStyle: { backgroundColor: colors.navy900 } }} />
      <Stack.Screen name="course/[id]" options={{ title: "Course", headerBackTitle: "Back" }} />
      <Stack.Screen name="course/review" options={{ presentation: "modal", title: "Rate & review" }} />
      <Stack.Screen name="rate-course" options={{ title: "Rate a course", headerBackTitle: "Back" }} />
      <Stack.Screen name="my-bag" options={{ title: "My bag", headerBackTitle: "Back" }} />
      {/* Memberships (0156): navy screens, gated by the `memberships` flag. */}
      <Stack.Screen name="membership/index" options={{ title: "", headerBackTitle: "Back", contentStyle: { backgroundColor: colors.navy900 } }} />
      <Stack.Screen name="membership/manage" options={{ title: "Membership", headerBackTitle: "Back", contentStyle: { backgroundColor: colors.navy900 } }} />
      {/* Hole maps (0108): no swipe-back — dragging the map from the left
          edge would otherwise leave the screen mid-pan. */}
      {/* Full width: the satellite map uses the whole screen. */}
      <Stack.Screen name="hole-map" options={{ title: "Hole map", headerBackTitle: "Back", gestureEnabled: false, contentStyle: { backgroundColor: colors.cream50 } }} />
      <Stack.Screen name="scorecards/index" options={{ title: "Scorecards", headerBackTitle: "Back" }} />
      <Stack.Screen name="scorecards/new" options={{ title: "New scorecard", headerBackTitle: "Back" }} />
      <Stack.Screen name="scorecards/[id]" options={{ title: "Scorecard", headerBackTitle: "Back" }} />
      <Stack.Screen name="scorecards/certify/[id]" options={{ title: "Certify card", headerBackTitle: "Back" }} />
      {/* Comments open as a sheet over the feed (phase 5): the card stays
          collapsed and the conversation has a screen of its own. Set here,
          not in the screen — iOS can't change presentation after a push. */}
      <Stack.Screen name="comments/[id]" options={{ presentation: "modal", title: "Comments" }} />
      {/* Share a post (phase 6): a sheet like Comments. */}
      <Stack.Screen name="share/[id]" options={{ presentation: "modal", title: "Share post" }} />
      {/* Who reacted (Oct 2026): a sheet like Comments and Share. */}
      <Stack.Screen name="reactions/[id]" options={{ presentation: "modal", title: "Reactions" }} />
      {/* Share to your feed (0166): the sharer's words over the post. */}
      <Stack.Screen name="share-to-feed/[id]" options={{ presentation: "modal", title: "Share to your feed" }} />
      <Stack.Screen name="saved" options={{ title: "Saved posts", headerBackTitle: "Back" }} />
      <Stack.Screen
        name="invite/[id]"
        options={{ title: "Tee time", headerBackTitle: "Back" }}
      />
    </Stack>
    </SafeAreaInsetsContext.Provider>
    </View>
    {tabBar ? <GlobalTabBar /> : null}
    {/* Loads the live round behind every MY ROUND pill, once. */}
    <MyRoundWatcher memberId={session?.user?.id ?? null} />
    {/* In-app advertising (0139): renders nothing unless the `ads` flag
        and the server's master switch are both on. */}
    <AdTakeoverHost />
    </>
  );
}

export default function RootLayout() {
  // A new over-the-air update goes live at this launch, not the next one.
  useEffect(() => {
    void applyUpdateAtLaunch();
  }, []);

  return (
    // GestureHandlerRootView explicitly, rather than relying on expo-router
    // providing one. Swipe-to-delete in the inbox is the first thing in the
    // app to use a gesture handler directly, and a missing root is the
    // failure where the gesture silently does nothing on a device while
    // everything still compiles.
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.cream50 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <StatusBar style="dark" />
          <RootNavigator />
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
