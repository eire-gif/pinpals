import { useEffect } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider, useAuth } from "@/lib/auth";
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

    const inApp = segments[0] === "(tabs)";

    if (!session && inApp) {
      router.replace("/login");
    } else if (session && !inApp) {
      router.replace("/(tabs)");
    }
  }, [session, loading, segments, router]);

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
