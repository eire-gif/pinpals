"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

import { IDLE, type ActionState } from "@/lib/society-console/action-state";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

const BUTTON = {
  primary: "bg-green-700 text-cream-50 hover:bg-green-600",
  navy: "bg-navy-900 text-cream-50 hover:bg-navy-800",
  gold: "bg-gold-500 text-navy-900 hover:bg-gold-400",
  quiet: "bg-surface text-ink-900 border border-line hover:bg-cream-100",
  danger: "bg-surface text-red-600 border border-red-600/30 hover:bg-red-100",
} as const;
export type ButtonTone = keyof typeof BUTTON;

export const buttonClass = (tone: ButtonTone = "primary", size: "sm" | "md" = "md") =>
  `inline-flex items-center justify-center gap-1.5 rounded-full font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed ${
    size === "sm" ? "px-3 py-1.5 text-xs" : "px-5 py-2.5 text-sm"
  } ${BUTTON[tone]}`;

export function SubmitButton({ children, tone = "primary", size = "md", pendingLabel }: { children: ReactNode; tone?: ButtonTone; size?: "sm" | "md"; pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={buttonClass(tone, size)}>
      {pending ? (pendingLabel ?? "Saving…") : children}
    </button>
  );
}

function Feedback({ state, quiet }: { state: ActionState; quiet?: boolean }) {
  if (state.error) {
    return (
      <p role="alert" className="text-sm text-red-600 bg-red-100 rounded-lg px-3 py-2">
        {state.error}
      </p>
    );
  }
  if (state.ok && !quiet) {
    return (
      <p aria-live="polite" className="text-sm text-green-700 bg-green-100 rounded-lg px-3 py-2">
        {state.message}
      </p>
    );
  }
  return null;
}

/**
 * A form posting to a society-console Server Action, with its answer shown
 * underneath. `confirm` asks first (cancelling an event, removing someone).
 * `reset` clears the fields after it worked (a new notice, a new guest).
 */
export function ConsoleForm({
  action,
  children,
  className,
  confirm,
  reset,
  quiet,
}: {
  action: Action;
  children: ReactNode;
  className?: string;
  confirm?: string;
  reset?: boolean;
  /** Don't print "Saved." — for one-click buttons in a list. */
  quiet?: boolean;
}) {
  const [state, formAction] = useActionState(action, IDLE);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (reset && state.ok) ref.current?.reset();
  }, [reset, state]);
  return (
    <form
      ref={ref}
      action={formAction}
      className={className}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
      <div className={state.error || (state.ok && !quiet) ? "mt-2" : undefined}>
        <Feedback state={state} quiet={quiet} />
      </div>
    </form>
  );
}

/** One button that runs one action, with hidden values. */
export function ActionButton({
  action,
  fields,
  children,
  tone = "quiet",
  size = "sm",
  confirm,
}: {
  action: Action;
  fields: Record<string, string | number | null | undefined>;
  children: ReactNode;
  tone?: ButtonTone;
  size?: "sm" | "md";
  confirm?: string;
}) {
  return (
    <ConsoleForm action={action} confirm={confirm} quiet className="inline-block">
      {Object.entries(fields).map(([k, v]) => (v == null ? null : <input key={k} type="hidden" name={k} value={String(v)} />))}
      <SubmitButton tone={tone} size={size} pendingLabel="…">
        {children}
      </SubmitButton>
    </ConsoleForm>
  );
}

export const inputClass =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink-900 placeholder:text-ink-500/70 focus:outline-none focus:ring-2 focus:ring-green-600/40";

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-bold uppercase tracking-[0.06em] text-ink-500 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-xs text-ink-500 mt-1">{hint}</span>}
    </label>
  );
}

export function Toggle({ name, label, hint, defaultChecked }: { name: string; label: string; hint?: string; defaultChecked?: boolean }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-0.5 h-4 w-4 accent-green-700" />
      <span>
        <span className="block text-sm font-semibold text-ink-900">{label}</span>
        {hint && <span className="block text-xs text-ink-500">{hint}</span>}
      </span>
    </label>
  );
}
