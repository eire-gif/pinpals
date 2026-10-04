/**
 * The shapes the app's admin screens render — shared contract between
 * src/lib/admin/app-views.ts (which builds them on the server from the same
 * queries the website's admin pages use) and mobile/src/lib/admin-views.ts
 * (a hand-kept copy; the app cannot import from the website).
 *
 * Deliberately generic. Twenty admin sections become two kinds of screen — a
 * list and a detail — so the app has two screens to get right instead of
 * forty, and a new admin section is a new builder on the server, not a new
 * app release.
 */

export type Tone = "green" | "red" | "gold" | "grey" | "navy";

export type Badge = { label: string; tone: Tone };

/** Where tapping something goes: another view, with its params. */
export type Open = { view: string; params?: Record<string, string> };

export type Row = {
  id: string;
  title: string;
  subtitle?: string;
  meta?: string;
  badges?: Badge[];
  open?: Open;
};

export type FieldOption = { value: string; label: string };

export type Field = {
  name: string;
  label: string;
  kind: "text" | "multiline" | "select" | "number" | "switch";
  options?: FieldOption[];
  required?: boolean;
  placeholder?: string;
  initial?: string;
  hint?: string;
};

export type Action = {
  /** Key into the action whitelist in /api/app/admin/action. */
  action: string;
  label: string;
  tone?: "primary" | "danger" | "neutral";
  /** Shown above the fields; for anything irreversible or money-moving. */
  confirm?: string;
  /** Values sent as-is (ids). */
  hidden?: Record<string, string>;
  /** What the member is asked for — usually a reason. */
  fields?: Field[];
};

export type Filter = {
  key: string;
  label: string;
  options: FieldOption[];
  value: string;
};

export type Stat = { label: string; value: string; tone?: Tone; open?: Open };

export type Section = {
  title: string;
  stats?: Stat[];
  fields?: { label: string; value: string }[];
  text?: string;
  rows?: Row[];
  empty?: string;
};

export type ListView = {
  kind: "list";
  title: string;
  summary?: string;
  search?: { placeholder: string; value: string };
  filters?: Filter[];
  rows: Row[];
  empty?: string;
  /** Present when there is another page. */
  nextPage?: string;
  /** Actions that are not about one row — "New support case", "Grant a role". */
  actions?: Action[];
  /** Shown above the rows — overview numbers for a section. */
  stats?: Stat[];
};

export type DetailView = {
  kind: "detail";
  title: string;
  subtitle?: string;
  badges?: Badge[];
  sections: Section[];
  actions?: Action[];
};

export type AdminView = ListView | DetailView;
