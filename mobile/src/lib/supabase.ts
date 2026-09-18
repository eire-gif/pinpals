import "react-native-url-polyfill/auto";

import { AppState } from "react-native";
import * as SecureStore from "expo-secure-store";
import { createClient } from "@supabase/supabase-js";

import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./config";

/**
 * Session storage.
 *
 * The obvious choice is AsyncStorage, and most Supabase React Native examples
 * use it. We don't, because a Supabase session contains a refresh token, and a
 * refresh token is a long-lived credential for a member's account — on a
 * jailbroken or backed-up device, AsyncStorage is a plain file. SecureStore
 * puts it in the iOS Keychain instead.
 *
 * The catch, and the reason this is more than one line: SecureStore warns above
 * 2048 bytes per value, and a session carrying an access token, a refresh token
 * and the user object routinely exceeds that. So values are split across
 * numbered keys, with a small index key recording how many parts there are.
 *
 * `removeItem` must delete every part, including parts left behind by a
 * previously longer value — otherwise a stale chunk 3 survives a write that
 * only produced chunks 0..2, and the next read reassembles two different
 * sessions into one unparseable string. That is why the count is stored rather
 * than discovered by probing.
 */

const CHUNK_SIZE = 1800;
const countKey = (key: string) => `${key}.parts`;
const partKey = (key: string, i: number) => `${key}.${i}`;

const readCount = async (key: string): Promise<number> => {
  const raw = await SecureStore.getItemAsync(countKey(key));
  const n = raw ? Number.parseInt(raw, 10) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
};

const ChunkedSecureStore = {
  getItem: async (key: string): Promise<string | null> => {
    try {
      const count = await readCount(key);
      if (count === 0) return null;

      const parts: string[] = [];
      for (let i = 0; i < count; i += 1) {
        const part = await SecureStore.getItemAsync(partKey(key, i));
        // A missing part means the stored value is torn — a half-written
        // session is worse than none, because it fails at parse time in
        // whatever screen happens to read it first. Treat it as signed out.
        if (part === null) return null;
        parts.push(part);
      }
      return parts.join("");
    } catch {
      return null;
    }
  },

  setItem: async (key: string, value: string): Promise<void> => {
    try {
      const previous = await readCount(key);

      const parts: string[] = [];
      for (let i = 0; i < value.length; i += CHUNK_SIZE) {
        parts.push(value.slice(i, i + CHUNK_SIZE));
      }

      for (let i = 0; i < parts.length; i += 1) {
        await SecureStore.setItemAsync(partKey(key, i), parts[i]);
      }
      // Clear any parts the previous, longer value left behind.
      for (let i = parts.length; i < previous; i += 1) {
        await SecureStore.deleteItemAsync(partKey(key, i));
      }
      await SecureStore.setItemAsync(countKey(key), String(parts.length));
    } catch {
      // Storage failure means the member gets signed out next launch, which is
      // recoverable. Throwing here would take down whatever triggered the write.
    }
  },

  removeItem: async (key: string): Promise<void> => {
    try {
      const count = await readCount(key);
      for (let i = 0; i < count; i += 1) {
        await SecureStore.deleteItemAsync(partKey(key, i));
      }
      await SecureStore.deleteItemAsync(countKey(key));
    } catch {
      // Same reasoning as above.
    }
  },
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: ChunkedSecureStore,
    autoRefreshToken: true,
    persistSession: true,
    // There is no URL bar to read a session out of. Leaving this on makes the
    // client parse deep-link URLs looking for auth fragments, which we handle
    // deliberately elsewhere.
    detectSessionInUrl: false,
  },
});

/**
 * Supabase refreshes tokens on a timer. A backgrounded app has no timers, so
 * without this a member who leaves the app for an hour comes back to a expired
 * access token and a screen full of RLS denials. Stopping the timer while
 * backgrounded also avoids pointless refreshes at 3am.
 */
AppState.addEventListener("change", (state) => {
  if (state === "active") {
    void supabase.auth.startAutoRefresh();
  } else {
    void supabase.auth.stopAutoRefresh();
  }
});
