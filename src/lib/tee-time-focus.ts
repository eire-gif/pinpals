/**
 * A tee-time alert names the round it's about: /tee-times/requests?invite=12.
 * The pages then show just that round, so answering an offer or a request
 * doesn't mean finding it in a list. Pure; tested in tee-time-focus.test.ts.
 */
export function focusedInvite(raw: string | string[] | undefined): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !/^\d{1,15}$/.test(value)) return null;
  const id = Number(value);
  return id > 0 ? id : null;
}
