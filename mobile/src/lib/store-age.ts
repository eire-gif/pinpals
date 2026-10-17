import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";
import * as SecureStore from "expo-secure-store";

import {
  parseStoreMemo,
  parseStoreSignal,
  storeSignalDue,
  wantsStoreSignal,
  type AgeAccess,
  type StoreSignalMemo,
} from "./age-rules";
import { isOn } from "./features";
import { supabase } from "./supabase";

/**
 * App store age signals (junior members, claude/junior-members.md, 0159).
 *
 * Apple's Declared Age Range (iOS 26+) and Google Play's Age Signals say
 * what the phone's account knows about the owner's age. Once a day after
 * sign-in, for a member whose account says 18+ (or has no date of birth
 * yet), the app asks and hands the answer to report_store_age_signal(). An
 * upper bound under 18 flags the account for staff and treats it as 16–17
 * until they look. Nothing is decided here.
 *
 * The native half is modules/age-signals. Binaries built before it have no
 * such module: requireOptionalNativeModule returns null and this does
 * nothing (the same guard as native-capabilities.ts). Every failure on the
 * native side resolves to null too, so nothing here throws.
 */

type Native = { requestAgeRange(): Promise<unknown> };

const native: Native | null =
  Platform.OS === "ios" || Platform.OS === "android" ? requireOptionalNativeModule<Native>("PinPalsAgeSignals") : null;

/** The binary has the module. */
export const HAS_AGE_SIGNALS = native != null;

/** Per member, so a shared phone asks for each of them. */
const memoKey = (userId: string) => `pinpals.store-age.${userId.replace(/[^A-Za-z0-9]/g, "")}`;

async function readMemo(userId: string): Promise<StoreSignalMemo | null> {
  try {
    return parseStoreMemo(await SecureStore.getItemAsync(memoKey(userId)));
  } catch {
    return null;
  }
}

async function writeMemo(userId: string, memo: StoreSignalMemo): Promise<void> {
  try {
    await SecureStore.setItemAsync(memoKey(userId), JSON.stringify(memo));
  } catch {
    // Not remembered: asked again next launch, which is harmless.
  }
}

let running = false;

/** At most once a day per member; does nothing for under-18s or without the module. */
export async function checkStoreAgeSignal(userId: string, access: AgeAccess): Promise<void> {
  if (!native || running || !isOn("ageBands") || !wantsStoreSignal(access)) return;
  running = true;
  try {
    const now = new Date();
    if (!storeSignalDue(await readMemo(userId), now)) return;

    const signal = parseStoreSignal(await native.requestAgeRange().catch(() => null));
    // Remembered whatever happened, so a phone that can't answer isn't
    // asked on every launch; "declined" waits a month (age-rules.ts).
    await writeMemo(userId, { at: now.toISOString(), declined: signal?.status === "declined" });
    if (!signal || (signal.lower === null && signal.upper === null)) return;

    await supabase.rpc("report_store_age_signal", {
      p_platform: Platform.OS,
      p_lower: signal.lower,
      p_upper: signal.upper,
      p_status: signal.status,
    });
  } catch {
    // A signal is a nice-to-have; nothing to tell the member.
  } finally {
    running = false;
  }
}
