import { Stack, useLocalSearchParams } from "expo-router";

import { WebShell } from "@/components/web-shell";

/**
 * Any site page, opened inside the app.
 *
 * Before this existed, every row in the Profile tab called
 * Linking.openURL() — which throws the member out to Safari, where they are a
 * stranger again, and where getting back means finding the app switcher. A
 * link that leaves the app to show the app's own content is the worst of both
 * worlds, and App Store Guideline 4 is unenthusiastic about it too.
 *
 * `path` is a site path; WebShell signs the member in before loading it.
 */
export default function WebScreen() {
  const { path, title } = useLocalSearchParams<{
    path: string;
    title?: string;
  }>();

  return (
    <>
      <Stack.Screen options={{ title: title ?? "PinPals" }} />
      <WebShell path={String(path ?? "/")} />
    </>
  );
}
