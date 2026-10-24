import { requireOptionalNativeModule } from "expo";
import * as SecureStore from "expo-secure-store";

import { chunks, fromStored, safeKey, toStored } from "./phone-store-rules";

/**
 * Data kept on the phone for playing with no signal (Oct 2026,
 * claude/offline-scoring.md): scores still to send, and the last copy of a
 * live round, its course and hole maps, so a round opens and scores with no
 * connection at all.
 *
 * Files in the app's own documents folder (expo-file-system, which every
 * build already carries as part of Expo). If a build somehow hasn't got it,
 * SecureStore instead, in pieces small enough for its ~2 KB limit — so this
 * ships as an ordinary over-the-air update.
 *
 * Writes to one key are made one after another, never at the same time.
 */

type FsFile = { exists: boolean; text(): Promise<string>; write(content: string): void; create(): void; delete(): void };
type FsModule = { File: new (...parts: unknown[]) => FsFile; Paths: { document: unknown } };

const HAS_FILES = requireOptionalNativeModule("FileSystem") != null;
let fs: FsModule | null = null;
function files(): FsModule | null {
  if (!HAS_FILES) return null;
  if (!fs) {
    try {
      // Required here, not imported: only touched when the native half exists.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      fs = require("expo-file-system") as FsModule;
    } catch {
      fs = null;
    }
  }
  return fs;
}

const fileFor = (m: FsModule, key: string) => new m.File(m.Paths.document, `pp-${safeKey(key)}.json`);

const queues = new Map<string, Promise<unknown>>();
function serial<T>(key: string, work: () => Promise<T>): Promise<T> {
  const before = queues.get(key) ?? Promise.resolve();
  const next = before.then(work, work);
  queues.set(
    key,
    next.catch(() => undefined)
  );
  return next;
}

async function readSecure(key: string): Promise<string | null> {
  const k = safeKey(key);
  const n = Number(await SecureStore.getItemAsync(`${k}.n`));
  if (!Number.isInteger(n) || n <= 0) return null;
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    const part = await SecureStore.getItemAsync(`${k}.${i}`);
    if (part == null) return null;
    parts.push(part);
  }
  return parts.join("");
}

async function writeSecure(key: string, text: string): Promise<void> {
  const k = safeKey(key);
  const old = Number(await SecureStore.getItemAsync(`${k}.n`)) || 0;
  const parts = chunks(text);
  for (let i = 0; i < parts.length; i++) await SecureStore.setItemAsync(`${k}.${i}`, parts[i]);
  await SecureStore.setItemAsync(`${k}.n`, String(parts.length));
  for (let i = parts.length; i < old; i++) await SecureStore.deleteItemAsync(`${k}.${i}`);
}

async function removeSecure(key: string): Promise<void> {
  const k = safeKey(key);
  const old = Number(await SecureStore.getItemAsync(`${k}.n`)) || 0;
  await SecureStore.deleteItemAsync(`${k}.n`);
  for (let i = 0; i < old; i++) await SecureStore.deleteItemAsync(`${k}.${i}`);
}

/** The value saved under `key`, or null. Never throws. */
export function getStored<T>(key: string): Promise<T | null> {
  return serial(key, async () => {
    try {
      const m = files();
      let raw: string | null = null;
      if (m) {
        const f = fileFor(m, key);
        raw = f.exists ? await f.text() : null;
      } else {
        raw = await readSecure(key);
      }
      return raw ? fromStored<T>(raw) : null;
    } catch {
      return null;
    }
  });
}

/** Saves `value` under `key` (Maps included). Never throws. */
export function setStored(key: string, value: unknown): Promise<void> {
  return serial(key, async () => {
    try {
      const text = toStored(value);
      const m = files();
      if (m) {
        const f = fileFor(m, key);
        if (!f.exists) f.create();
        f.write(text);
      }
      else await writeSecure(key, text);
    } catch {
      // The copy in memory still works while the app is open.
    }
  });
}

export function removeStored(key: string): Promise<void> {
  return serial(key, async () => {
    try {
      const m = files();
      if (m) {
        const f = fileFor(m, key);
        if (f.exists) f.delete();
      } else {
        await removeSecure(key);
      }
    } catch {
      // Nothing to remove.
    }
  });
}
