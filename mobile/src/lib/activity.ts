import { AppState, Platform } from "react-native";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";

import { SITE_URL } from "./config";
import { supabase } from "./supabase";

/**
 * The app's half of the admin "Live now" panel (0161, website
 * src/app/api/activity/route.ts). Tells the site which section of the app is
 * on screen: once per screen (a view), then once a minute while the app is in
 * the foreground (still here).
 *
 *  - install id: random, made on first launch and kept on this phone — the
 *    panel counts installs (and opens) from it. Nothing about the phone.
 *  - session id: random, new each time the app is opened (or comes back after
 *    half an hour in the background).
 *
 * The member, if signed in, is worked out by the site from the token — the
 * app never says who it is. Best-effort: a failed ping is dropped silently.
 */

import { sectionForSegments, type ActivitySection } from "./activity-sections";

/** Screens that never ping: the admin screen (staff would inflate the numbers). */
function untracked(segments: readonly string[]): boolean {
  return segments.includes("admin");
}

const INSTALL_KEY = "pp_install_id";
const BACKGROUND_NEW_SESSION_MS = 30 * 60_000;
const HEARTBEAT_MS = 60_000;

function randomId(): string {
  let s = "";
  while (s.length < 32) s += Math.random().toString(16).slice(2);
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

let installId: string | null = null;
let sessionId = randomId();
let backgroundSince: number | null = null;
let currentSection: ActivitySection | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let started = false;

async function getInstallId(): Promise<string> {
  if (installId) return installId;
  try {
    const saved = await SecureStore.getItemAsync(INSTALL_KEY);
    if (saved && /^[A-Za-z0-9-]{16,64}$/.test(saved)) {
      installId = saved;
      return saved;
    }
    const made = randomId();
    await SecureStore.setItemAsync(INSTALL_KEY, made);
    installId = made;
    return made;
  } catch {
    installId = installId ?? randomId();
    return installId;
  }
}

async function ping(view: boolean): Promise<void> {
  if (!currentSection) return;
  if (Platform.OS !== "ios" && Platform.OS !== "android") return;
  try {
    const [install, { data }] = await Promise.all([getInstallId(), supabase.auth.getSession()]);
    const token = data.session?.access_token;
    await fetch(`${SITE_URL}/api/activity`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        session: sessionId,
        platform: Platform.OS,
        section: currentSection,
        view,
        install,
        appVersion: Constants.expoConfig?.version ?? null,
      }),
    });
  } catch {
    // Best-effort only.
  }
}

function startTimers(): void {
  if (started) return;
  started = true;
  timer = setInterval(() => {
    if (AppState.currentState === "active") void ping(false);
  }, HEARTBEAT_MS);
  AppState.addEventListener("change", (state) => {
    if (state === "active") {
      if (backgroundSince && Date.now() - backgroundSince > BACKGROUND_NEW_SESSION_MS) {
        sessionId = randomId();
        void ping(true);
      } else {
        void ping(false);
      }
      backgroundSince = null;
    } else if (state === "background") {
      backgroundSince = Date.now();
    }
  });
}

/** Called by the root layout whenever the route changes. */
export function reportScreen(segments: readonly string[]): void {
  if (untracked(segments)) {
    currentSection = null;
    return;
  }
  const section = sectionForSegments(segments);
  startTimers();
  currentSection = section;
  void ping(true);
}

/** For tests only. */
export function _stopActivityTimers(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
