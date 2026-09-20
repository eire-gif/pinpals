import Constants from "expo-constants";

/**
 * Everything the app needs to know about where PinPals lives.
 *
 * Two sources, in order:
 *
 *   1. `EXPO_PUBLIC_*` environment variables, which Metro inlines at build
 *      time. Used when someone is running `npx expo start` on a machine with
 *      a .env file.
 *   2. `expo.extra` in app.json, which is committed and therefore present in
 *      every cloud build.
 *
 * The fallback is what makes EAS builds work without anyone configuring
 * environment variables in a dashboard. That is safe for exactly these three
 * values and nothing else:
 *
 *   - the Supabase URL is a public hostname
 *   - the publishable key is designed to be shipped to clients; every table it
 *     can reach is behind RLS, which is what actually protects the data
 *   - the site URL is on a billboard
 *
 * The service-role key, the Stripe secret key and the VAPID private key must
 * NEVER appear in this app or in app.json. They live in Vercel, and the server
 * code that uses them stays on the website. See §4.1 of
 * claude/ios-app-build-spec.md: the app is a client, never a second
 * implementation.
 */

type Extra = {
  supabaseUrl?: string;
  supabasePublishableKey?: string;
  siteUrl?: string;
};

const extra = (Constants.expoConfig?.extra ?? {}) as Extra;

const resolve = (name: string, fromEnv: string | undefined, fromExtra: string | undefined): string => {
  const value = fromEnv ?? fromExtra;
  if (!value) {
    throw new Error(
      `Missing ${name}. Set it in .env, or in expo.extra in app.json.`
    );
  }
  return value;
};

export const SUPABASE_URL = resolve(
  "EXPO_PUBLIC_SUPABASE_URL",
  process.env.EXPO_PUBLIC_SUPABASE_URL,
  extra.supabaseUrl
);

export const SUPABASE_PUBLISHABLE_KEY = resolve(
  "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  extra.supabasePublishableKey
);

/** The live site. Web views and deep links are both resolved against this. */
export const SITE_URL =
  process.env.EXPO_PUBLIC_SITE_URL ?? extra.siteUrl ?? "https://www.pinpals.ie";

/**
 * Web views append this so the site can drop its own header, footer and nav.
 * A web page wearing its own navigation bar underneath a native tab bar is the
 * single clearest tell that an app is a wrapper, and Guideline 4.2 is written
 * for exactly that. Until the site reads the flag, the app still works — it
 * just looks doubled up.
 */
export const SHELL_PARAM = "shell=1";

/**
 * A site path carrying the shell flag, without the origin.
 *
 * Kept separate from webUrl() because the session handoff needs to send the
 * destination to the site as a path — an absolute URL there would be an open
 * redirect waiting to happen, and the route rejects one.
 */
export const shellPath = (path: string): string => {
  const p = path.startsWith("/") ? path : `/${path}`;
  return p.includes("?") ? `${p}&${SHELL_PARAM}` : `${p}?${SHELL_PARAM}`;
};

export const webUrl = (path: string): string => `${SITE_URL}${shellPath(path)}`;
