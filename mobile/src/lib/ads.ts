import { useSyncExternalStore } from "react";
import { Image, Linking } from "react-native";
import * as SecureStore from "expo-secure-store";

import { rowToAd, type Ad, type AdRow, type TakeoverTrigger } from "./ads-rules";
import { isOn } from "./features";
import { supabase } from "./supabase";

/**
 * In-app advertising (0139, claude/advertising.md): the adverts for this
 * member, their images, and counting views and taps.
 *
 * Two switches must both be on for anything to happen: the `ads` feature
 * flag (features.ts) and ad_settings.ads_enabled on the server, which
 * ads_for_me() checks. With either off, the list is empty and every
 * component renders nothing.
 *
 * No new native module: images are warmed with React Native's own
 * Image.prefetch, links open with Linking, and the phone-only memory
 * ("Hide this advert", when the last takeover showed) lives in
 * expo-secure-store, as recap-prompts.ts does — so this ships over the air.
 *
 * Counting goes through ad_log(), which de-duplicates on the server; the
 * queue here only saves round trips (one view per advert per hour, batched).
 */

export type { Ad } from "./ads-rules";

type Where = { country: string | null; county: string | null; clubId: number | null };

type State = { ads: Ad[]; where: Where; userId: string | null };

let state: State = { ads: [], where: { country: null, county: null, clubId: null }, userId: null };
const listeners = new Set<() => void>();

function setState(next: Partial<State>) {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The member's adverts (all formats). Empty while loading, on error, or with ads off. */
export function useAds(): Ad[] {
  return useSyncExternalStore(subscribe, () => state.ads, () => state.ads);
}

/** Where the member says they are — for "Why am I seeing this?". */
export function useAdAudience(): Where {
  return useSyncExternalStore(subscribe, () => state.where, () => state.where);
}

export const adsOn = (): boolean => isOn("ads");

async function prefetch(urls: (string | null)[]): Promise<void> {
  await Promise.all(urls.filter((u): u is string => !!u).map((u) => Image.prefetch(u).catch(() => false)));
}

function rows(data: unknown): Ad[] {
  return Array.isArray(data) ? (data as AdRow[]).map(rowToAd).filter((a): a is Ad => a != null) : [];
}

/**
 * Fetch this member's adverts (at app start and on coming back to it).
 * Targeting comes from the profile: country, county, home club. A failure
 * keeps whatever was there — no advert is better than a broken screen.
 */
export async function refreshAds(userId: string | null): Promise<Ad[]> {
  if (!adsOn() || !userId) {
    setState({ ads: [], userId });
    return [];
  }
  try {
    const { data: me } = await supabase
      .from("profiles")
      .select("country, county, home_club_id")
      .eq("id", userId)
      .maybeSingle<{ country: string | null; county: string | null; home_club_id: number | null }>();
    const where: Where = { country: me?.country ?? null, county: me?.county ?? null, clubId: me?.home_club_id ?? null };
    const { data, error } = await supabase.rpc("ads_for_me", { p_country: where.country, p_region: where.county, p_club_id: where.clubId });
    if (error) throw error;
    const ads = rows(data);
    // Course partners are fetched per course (loadCoursePartner); the rest warm up now.
    await prefetch(ads.filter((a) => a.format !== "course_partner").flatMap((a) => [a.imageUrl, a.imageWideUrl, a.imageSquareUrl]));
    setState({ ads, where, userId });
    return ads;
  } catch {
    return state.ads;
  }
}

// ---------------------------------------------------------------------------
// Course partners: per course, cached for ten minutes
// ---------------------------------------------------------------------------

const partnerCache = new Map<number, { at: number; ad: Ad | null }>();
const PARTNER_TTL = 10 * 60_000;

export async function loadCoursePartner(clubId: number): Promise<Ad | null> {
  if (!adsOn() || !Number.isFinite(clubId)) return null;
  const cached = partnerCache.get(clubId);
  if (cached && Date.now() - cached.at < PARTNER_TTL) return cached.ad;
  try {
    const { data, error } = await supabase.rpc("ads_for_me", { p_country: state.where.country, p_region: state.where.county, p_club_id: clubId });
    if (error) throw error;
    const hidden = await hiddenAdIds();
    const ad = rows(data).find((a) => a.format === "course_partner" && !hidden.has(a.id)) ?? null;
    if (ad) await prefetch([ad.imageUrl, ad.imageWideUrl]);
    partnerCache.set(clubId, { at: Date.now(), ad });
    return ad;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Counting
// ---------------------------------------------------------------------------

type Kind = "view" | "click" | "dismiss";
const queue: { id: number; kind: Kind }[] = [];
const sent = new Map<string, number>();
let timer: ReturnType<typeof setTimeout> | null = null;

/** The same window ad_log() de-duplicates on: an hour for views and dismisses, a day for clicks. */
function windowKey(id: number, kind: Kind, now: number): string {
  const span = kind === "click" ? 86_400_000 : 3_600_000;
  return `${id}:${kind}:${Math.floor(now / span)}`;
}

/** Count a view, tap or close. Repeats inside the server's window aren't sent at all. */
export function logAdEvent(id: number, kind: Kind): void {
  if (!adsOn()) return;
  const key = windowKey(id, kind, Date.now());
  if (sent.has(key)) return;
  sent.set(key, Date.now());
  if (sent.size > 500) sent.clear();
  queue.push({ id, kind });
  scheduleFlush(kind === "click" ? 0 : 4000);
}

function scheduleFlush(delay: number) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void flushAdEvents(), delay);
}

/** Send what's queued, ten at a time. Failures are dropped: a lost view costs the advertiser nothing. */
export async function flushAdEvents(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  while (queue.length) {
    const batch = queue.splice(0, 10);
    await Promise.all(
      batch.map((e) => supabase.rpc("ad_log", { p_campaign_id: e.id, p_kind: e.kind, p_source: "app" }).then(
        () => undefined,
        () => undefined
      ))
    );
  }
}

/** Count the tap and open the advertiser's page. */
export async function openAd(ad: Ad): Promise<void> {
  logAdEvent(ad.id, "click");
  if (/^https:\/\/\S+$/.test(ad.linkUrl)) await Linking.openURL(ad.linkUrl).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Phone-only memory
// ---------------------------------------------------------------------------

const HIDDEN_KEY = "pinpals.ads.hidden";
const TAKEOVER_KEY = "pinpals.ads.lastTakeover";
let hiddenCache: Set<number> | null = null;
const hiddenListeners = new Set<() => void>();

export async function hiddenAdIds(): Promise<Set<number>> {
  if (hiddenCache) return hiddenCache;
  try {
    const raw = await SecureStore.getItemAsync(HIDDEN_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    hiddenCache = new Set(Array.isArray(list) ? list.filter((n): n is number => Number.isInteger(n)) : []);
  } catch {
    hiddenCache = new Set();
  }
  return hiddenCache;
}

/** "Hide this advert": on this phone, for good. */
export async function hideAd(id: number): Promise<void> {
  const set = await hiddenAdIds();
  set.add(id);
  hiddenCache = new Set(set);
  for (const l of hiddenListeners) l();
  logAdEvent(id, "dismiss");
  try {
    // SecureStore values are small; the newest 100 is plenty.
    await SecureStore.setItemAsync(HIDDEN_KEY, JSON.stringify([...hiddenCache].slice(-100)));
  } catch {
    // Not remembered past this session: it may show again, the safe failure.
  }
}

/** The hidden set, kept current when one is hidden anywhere. */
export function useHiddenAds(): ReadonlySet<number> {
  return useSyncExternalStore(subscribeHidden, () => hiddenCache ?? EMPTY, () => EMPTY);
}
const EMPTY: ReadonlySet<number> = new Set();

function subscribeHidden(listener: () => void) {
  hiddenListeners.add(listener);
  if (!hiddenCache) void hiddenAdIds().then(listener);
  return () => hiddenListeners.delete(listener);
}

export async function lastTakeoverAt(): Promise<number | null> {
  try {
    const raw = await SecureStore.getItemAsync(TAKEOVER_KEY);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export async function markTakeoverShown(at: number = Date.now()): Promise<void> {
  await SecureStore.setItemAsync(TAKEOVER_KEY, String(at)).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// "After a round": the certify screen asks; the takeover host decides
// ---------------------------------------------------------------------------

const takeoverListeners = new Set<(trigger: TakeoverTrigger) => void>();

export function requestTakeover(trigger: TakeoverTrigger): void {
  if (!adsOn()) return;
  for (const l of takeoverListeners) l(trigger);
}

export function onTakeoverRequest(listener: (trigger: TakeoverTrigger) => void): () => void {
  takeoverListeners.add(listener);
  return () => takeoverListeners.delete(listener);
}
