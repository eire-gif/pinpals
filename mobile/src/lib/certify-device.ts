import { Platform } from "react-native";
import * as Device from "expo-device";
import * as SecureStore from "expo-secure-store";

import { certificationSignature } from "./hmac-sha256";
import { supabase } from "./supabase";

/**
 * This phone's certification key (0128, claude/scorecard-certification.md).
 *
 * The server makes 32 random bytes for the member and hands them over once.
 * The phone keeps them in secure storage with `requireAuthentication`, so
 * they can only be read back after Face ID, Touch ID or a fingerprint —
 * the iOS Keychain (biometryCurrentSet) or an Android Keystore key that needs
 * a strong biometric. Certifying reads the key (which is what shows the
 * Face ID prompt) and signs the request with it; the server checks the
 * signature. Biometric data never leaves the phone.
 *
 * expo-secure-store is already in the app binary, so none of this needs a
 * store build — it ships over the air.
 *
 * Two things the OS does for us, and how they show up here:
 *   - Enrolling a new face or fingerprint invalidates the key: reading it
 *     then returns null, and we quietly set up a new one.
 *   - Cancelling the prompt throws; we turn that into CertifyCancelled.
 */

export type CertifyMethod = "face_id" | "touch_id" | "biometric" | "in_app";

/** How a certificate was given, as the card shows it. */
export const METHOD_LABEL: Record<CertifyMethod, string> = {
  face_id: "Face ID",
  touch_id: "Touch ID",
  biometric: "Biometrics",
  in_app: "In the app",
};

export class CertifyCancelled extends Error {
  constructor() {
    super("Cancelled");
    this.name = "CertifyCancelled";
  }
}

// iPhones that unlock with Touch ID and can run this app: 8, 8 Plus, SE (2nd
// and 3rd generation). Anything older is a Touch ID phone too. Every other
// iPhone since the X has Face ID.
const TOUCH_ID_IPHONES = new Set(["iPhone10,1", "iPhone10,2", "iPhone10,4", "iPhone10,5", "iPhone12,8", "iPhone14,6"]);

/** What this phone will ask for, as best we can tell without a native module. */
export function biometricMethod(): CertifyMethod {
  if (Platform.OS === "android") return "biometric";
  const model = Device.modelId ?? "";
  const m = model.match(/^iPhone(\d+),/);
  if (!m) return "biometric"; // iPads have either; don't guess.
  if (TOUCH_ID_IPHONES.has(model) || Number(m[1]) < 10) return "touch_id";
  return "face_id";
}

/** The button: "Certify with Face ID". */
export const certifyButtonLabel = (method: CertifyMethod): string =>
  method === "in_app" ? "Certify" : method === "biometric" ? "Certify with fingerprint" : `Certify with ${METHOD_LABEL[method]}`;

/** Can this phone keep a key behind biometrics? False: no Face ID / fingerprint set up. */
export function canUseBiometrics(): boolean {
  if (Platform.OS !== "ios" && Platform.OS !== "android") return false;
  try {
    return SecureStore.canUseBiometricAuthentication();
  } catch {
    return false;
  }
}

const keyIdItem = (memberId: string) => `pinpals_certify_v1_${memberId}_key`;
const secretItem = (memberId: string) => `pinpals_certify_v1_${memberId}_secret`;

const PROTECTED = (prompt: string): SecureStore.SecureStoreOptions => ({
  requireAuthentication: true,
  authenticationPrompt: prompt,
  keychainAccessible: SecureStore.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
});
const PLAIN: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

const isCancel = (e: unknown) => /cancel/i.test(e instanceof Error ? e.message : String(e));

/** Forget this phone's key (the server keeps it until it's retired). */
export async function resetCertifyKey(memberId: string): Promise<void> {
  await SecureStore.deleteItemAsync(secretItem(memberId), { requireAuthentication: true }).catch(() => undefined);
  await SecureStore.deleteItemAsync(keyIdItem(memberId), PLAIN).catch(() => undefined);
}

/**
 * Two steps on the server: register (it makes the key), then confirm once
 * the phone has stored it behind biometrics. A set-up cancelled in between
 * leaves an unconfirmed key that can't sign and retires none of the
 * member's other phones.
 */
async function enrol(memberId: string): Promise<{ keyId: string; secret: string }> {
  const { data, error } = await supabase.rpc("scorecard_certify_key_register", { p_platform: Platform.OS === "ios" ? "ios" : "android" });
  if (error) throw new Error(error.message || "Couldn't set this phone up to certify cards.");
  const { key_id, secret } = data as { key_id: string; secret: string };
  try {
    // Android asks for a fingerprint here; iOS doesn't until the key is read.
    await SecureStore.setItemAsync(secretItem(memberId), secret, PROTECTED("Set up certifying on this phone"));
  } catch (e) {
    if (isCancel(e)) throw new CertifyCancelled();
    throw e;
  }
  await SecureStore.setItemAsync(keyIdItem(memberId), key_id, PLAIN);
  const { error: confirmError } = await supabase.rpc("scorecard_certify_key_confirm", { p_key_id: key_id });
  if (confirmError) throw new Error(confirmError.message || "Couldn't set this phone up to certify cards.");
  return { keyId: key_id, secret };
}

async function readSecret(memberId: string, prompt: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(secretItem(memberId), PROTECTED(prompt));
  } catch (e) {
    if (isCancel(e)) throw new CertifyCancelled();
    throw e;
  }
}

/**
 * What this proves, honestly: the request was approved through the
 * certifier's own account, with a key it set up, and — in this app — only
 * after Face ID or a fingerprint. Without device attestation (App Attest /
 * Play Integrity, a future store build) the server can't rule out a
 * modified client; see claude/scorecard-certification.md.
 *
 * Face ID (or fingerprint), then the signature for this request. Sets the
 * phone up first if it has never certified, or if its key was invalidated
 * by a change to the phone's biometrics.
 */
export async function signCertification(
  memberId: string,
  request: { id: number; challenge: string; cardHash: string },
  prompt: string
): Promise<{ keyId: string; signature: string }> {
  let keyId = await SecureStore.getItemAsync(keyIdItem(memberId), PLAIN);
  let secret = keyId ? await readSecret(memberId, prompt) : null;
  if (!keyId || !secret) {
    await resetCertifyKey(memberId);
    const fresh = await enrol(memberId);
    keyId = fresh.keyId;
    // Android has just asked for a fingerprint to store it: don't ask twice.
    // iOS stores without asking, so reading it back is the Face ID moment.
    secret = Platform.OS === "android" ? fresh.secret : await readSecret(memberId, prompt);
    if (!secret) throw new Error("This phone couldn't keep its certification key. Check Face ID or fingerprint is set up, then try again.");
  }
  return { keyId, signature: certificationSignature(secret, request.id, request.challenge, request.cardHash) };
}
