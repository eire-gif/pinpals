import * as SecureStore from "expo-secure-store";

/**
 * Unsent words in a chat box, kept so the Chats list can say "Draft: …" and
 * the box still has them when the member comes back (Oct 2026, the WhatsApp
 * way).
 *
 * On the phone only — a draft is nobody else's business, and it never needs
 * to reach another device. SecureStore because it's what the build has (no
 * AsyncStorage); one key per thread so no single value grows large, plus a
 * small index so the list can read only the threads that have one.
 *
 * Every call swallows errors: a lost draft is a shrug, a screen that throws
 * while someone is typing is not.
 */

const INDEX_KEY = "chatDraft.ids";
const keyFor = (conversationId: number) => `chatDraft.${conversationId}`;
/** Generous for a chat message, and keeps each stored value small. */
const MAX_LENGTH = 500;
/** Oldest drafts drop off past this — nobody has forty half-written chats. */
const MAX_DRAFTS = 30;

let memory: Map<number, string> | null = null;

async function loadIndex(): Promise<Map<number, string>> {
  if (memory) return memory;
  const map = new Map<number, string>();
  try {
    const raw = await SecureStore.getItemAsync(INDEX_KEY);
    const ids = raw ? (JSON.parse(raw) as unknown) : [];
    if (Array.isArray(ids)) {
      const values = await Promise.all(
        ids.filter((id): id is number => typeof id === "number").map(async (id) => [id, await SecureStore.getItemAsync(keyFor(id))] as const)
      );
      for (const [id, text] of values) if (text && text.trim()) map.set(id, text);
    }
  } catch {
    // Start empty.
  }
  memory = map;
  return map;
}

async function saveIndex(map: Map<number, string>): Promise<void> {
  try {
    await SecureStore.setItemAsync(INDEX_KEY, JSON.stringify([...map.keys()]));
  } catch {
    // Best effort.
  }
}

/** Every saved draft, by conversation id. */
export async function loadDrafts(): Promise<Map<number, string>> {
  return new Map(await loadIndex());
}

/** The draft for one thread, or "". */
export async function loadDraft(conversationId: number): Promise<string> {
  return (await loadIndex()).get(conversationId) ?? "";
}

/** Saves (or, when empty, clears) one thread's draft. */
export async function saveDraft(conversationId: number, text: string): Promise<void> {
  const map = await loadIndex();
  const value = text.slice(0, MAX_LENGTH);
  try {
    if (value.trim()) {
      // Re-inserted so the newest sits last and the oldest drop first.
      map.delete(conversationId);
      map.set(conversationId, value);
      while (map.size > MAX_DRAFTS) {
        const oldest = map.keys().next().value as number;
        map.delete(oldest);
        await SecureStore.deleteItemAsync(keyFor(oldest));
      }
      await SecureStore.setItemAsync(keyFor(conversationId), value);
    } else {
      if (!map.has(conversationId)) return;
      map.delete(conversationId);
      await SecureStore.deleteItemAsync(keyFor(conversationId));
    }
  } catch {
    // Best effort.
  }
  await saveIndex(map);
}
