/**
 * The trip kitty (0202, claude/trip-kitty.md): the pure half.
 *
 * Each expense is split equally between the people it's for; odd cents go to
 * the first of them (in the order given), so every expense adds up exactly.
 * A balance is what you paid, less your shares, plus what you've paid back,
 * less what's been paid back to you. Balances always add up to zero.
 *
 * Pure: tested in kitty-rules.test.ts.
 */

export type KittyExpense = { id: number; amountCents: number; paidBy: string; shares: readonly string[] };
export type KittyPayment = { id: number; from: string; to: string; amountCents: number };

/** Each person's share of one expense, in cents. */
export function splitShares(amountCents: number, shares: readonly string[]): Map<string, number> {
  const out = new Map<string, number>();
  if (shares.length === 0) return out;
  const each = Math.floor(amountCents / shares.length);
  let rest = amountCents - each * shares.length;
  for (const id of shares) {
    const extra = rest > 0 ? 1 : 0;
    rest -= extra;
    out.set(id, (out.get(id) ?? 0) + each + extra);
  }
  return out;
}

/** Everyone's balance in cents: + they're owed, − they owe. */
export function kittyBalances(expenses: readonly KittyExpense[], payments: readonly KittyPayment[]): Map<string, number> {
  const out = new Map<string, number>();
  const add = (id: string, c: number) => out.set(id, (out.get(id) ?? 0) + c);
  for (const e of expenses) {
    add(e.paidBy, e.amountCents);
    for (const [id, c] of splitShares(e.amountCents, e.shares)) add(id, -c);
  }
  for (const p of payments) {
    add(p.from, p.amountCents);
    add(p.to, -p.amountCents);
  }
  return out;
}

export type KittyTransfer = { from: string; to: string; cents: number };

/** The fewest payments that square every balance: biggest debt to biggest credit first. */
export function settleKitty(bal: ReadonlyMap<string, number>): KittyTransfer[] {
  const debtors = [...bal].filter(([, c]) => c < 0).map(([id, c]) => ({ id, left: -c }));
  const creditors = [...bal].filter(([, c]) => c > 0).map(([id, c]) => ({ id, left: c }));
  const out: KittyTransfer[] = [];
  const order = (a: { id: string; left: number }, b: { id: string; left: number }) => b.left - a.left || a.id.localeCompare(b.id);
  while (debtors.some((d) => d.left > 0) && creditors.some((c) => c.left > 0)) {
    debtors.sort(order);
    creditors.sort(order);
    const d = debtors[0]!;
    const c = creditors[0]!;
    const cents = Math.min(d.left, c.left);
    out.push({ from: d.id, to: c.id, cents });
    d.left -= cents;
    c.left -= cents;
  }
  return out;
}

/** Total spent, and one person's share of it. */
export function kittyTotals(expenses: readonly KittyExpense[], me: string | null): { spent: number; myShare: number } {
  let spent = 0;
  let myShare = 0;
  for (const e of expenses) {
    spent += e.amountCents;
    if (me) myShare += splitShares(e.amountCents, e.shares).get(me) ?? 0;
  }
  return { spent, myShare };
}

/** "€1,280" or "€12.50". */
export function kittyEuros(cents: number): string {
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const part = abs % 100;
  const body = `€${whole.toLocaleString("en-IE")}${part ? `.${String(part).padStart(2, "0")}` : ""}`;
  return cents < 0 ? `−${body}` : body;
}

/** "1280", "12.50", "12,50", "€1,280" typed → cents, or null. */
export function parseKittyAmount(text: string): number | null {
  const t = text.replace(/[€\s]/g, "");
  const normal = /^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(t) ? t.replace(/,/g, "") : t.replace(",", ".");
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(normal)) return null;
  const cents = Math.round(Number(normal) * 100);
  return cents >= 1 && cents <= 10_000_000 ? cents : null;
}

export const KITTY_CATEGORIES = [
  { id: "golf", label: "Golf" },
  { id: "travel", label: "Travel" },
  { id: "food", label: "Food" },
  { id: "drinks", label: "Drinks" },
  { id: "stay", label: "Stay" },
  { id: "other", label: "Other" },
] as const;
export type KittyCategory = (typeof KITTY_CATEGORIES)[number]["id"];
