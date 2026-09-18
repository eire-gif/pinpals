import { useRef, useState, type ForwardRefExoticComponent, type RefAttributes } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import RNWebView, {
  type WebViewNavigation,
  type WebViewProps,
} from "react-native-webview";
import { SafeAreaView } from "react-native-safe-area-context";

import { SITE_URL } from "@/lib/config";
import { colors, radii, spacing, type } from "@/lib/theme";

/**
 * react-native-webview 14's root index.d.ts declares
 * `class WebView<P = undefined> extends Component<WebViewProps & P>`, and
 * `WebViewProps & undefined` collapses to `never` — so under strict TypeScript
 * every prop on the component is rejected as "not assignable to type never".
 * The implementation it actually ships (lib/WebView.d.ts) is a function
 * component with a forwarded ref, which is what this alias describes.
 *
 * This is a bug in the package's published types, not in the code below.
 * Delete the alias and import RNWebView directly once it is fixed upstream.
 */
type WebViewHandle = {
  reload: () => void;
  goBack: () => void;
  injectJavaScript: (script: string) => void;
};

const WebView = RNWebView as unknown as ForwardRefExoticComponent<
  WebViewProps & RefAttributes<WebViewHandle>
>;

/**
 * A web view that behaves like a screen rather than like a browser.
 *
 * Three things it does that a bare <WebView> does not:
 *
 *  1. Keeps navigation inside pinpals.ie. A link to a third-party site inside
 *     an app with no address bar is a phishing surface and reads badly at
 *     review; those are blocked here rather than silently followed.
 *  2. Shows a real error state. A white screen when the member is on a train
 *     with no signal is the most common "this app is broken" report there is.
 *  3. Renders its own spinner over a cream background, so the first paint is
 *     the brand's colour rather than a white flash.
 */
export function WebShell({ uri }: { uri: string }) {
  const ref = useRef<WebViewHandle>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const allowed = (request: WebViewNavigation): boolean => {
    try {
      const host = new URL(request.url).hostname;
      return host === "www.pinpals.ie" || host === "pinpals.ie";
    } catch {
      return false;
    }
  };

  if (failed) {
    return (
      <SafeAreaView style={styles.fill} edges={["top"]}>
        <View style={styles.centre}>
          <Text style={styles.errorTitle}>Can&apos;t reach PinPals</Text>
          <Text style={styles.errorBody}>
            Check your connection and try again.
          </Text>
          <Pressable
            style={styles.retry}
            onPress={() => {
              setFailed(false);
              setLoading(true);
              ref.current?.reload();
            }}
          >
            <Text style={styles.retryLabel}>Try again</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.fill} edges={["top"]}>
      <WebView
        ref={ref}
        source={{ uri }}
        originWhitelist={[`${SITE_URL}/*`]}
        style={styles.fill}
        // iOS reuses the app's shared cookie store, which is what will let the
        // session handoff work when it lands (§4.2 of the build spec).
        sharedCookiesEnabled
        pullToRefreshEnabled
        allowsBackForwardNavigationGestures
        onLoadEnd={() => setLoading(false)}
        onError={() => setFailed(true)}
        onHttpError={(event) => {
          if (event.nativeEvent.statusCode >= 500) setFailed(true);
        }}
        onShouldStartLoadWithRequest={(request) => {
          if (allowed(request)) return true;
          // TODO: open off-site links in the system browser via expo-web-browser
          // rather than dropping them, once there are any worth following.
          return false;
        }}
      />
      {loading && (
        <View style={styles.overlay} pointerEvents="none">
          <ActivityIndicator size="large" color={colors.green700} />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.cream50,
  },
  centre: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
    gap: spacing.sm,
  },
  errorTitle: { fontSize: type.title, fontWeight: "700", color: colors.ink900 },
  errorBody: { fontSize: type.body, color: colors.ink500, textAlign: "center" },
  retry: {
    marginTop: spacing.md,
    paddingVertical: 14,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.pill,
    backgroundColor: colors.green700,
  },
  retryLabel: { color: colors.cream50, fontWeight: "700", fontSize: type.body },
});
