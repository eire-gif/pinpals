// Pure helpers for phone-store.ts and round-cache.ts. No React Native here,
// so vitest can test them (phone-store-rules.test.ts).

/**
 * JSON that survives Maps (a live round's scores are Map<player, Map<hole,
 * strokes>>). A Map is written as {"__map": [[key, value], ...]}.
 */
export function toStored(value: unknown): string {
  return JSON.stringify(value, (_key, v) => (v instanceof Map ? { __map: [...v.entries()] } : v));
}

export function fromStored<T>(raw: string): T {
  return JSON.parse(raw, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v) && Array.isArray((v as { __map?: unknown }).__map)
      ? new Map((v as { __map: [unknown, unknown][] }).__map)
      : v
  ) as T;
}

/**
 * SecureStore (the fallback store, on a phone without the file system
 * module) refuses values over about 2 KB. Long values are kept as numbered
 * pieces under the same key.
 */
export const CHUNK = 1800;

export function chunks(text: string, size = CHUNK): string[] {
  if (text.length === 0) return [""];
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

/** Keys allowed by SecureStore: letters, digits, ".", "-" and "_". */
export function safeKey(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, "_");
}
