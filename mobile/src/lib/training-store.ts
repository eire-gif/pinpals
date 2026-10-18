import { useCallback, useEffect, useState } from "react";
import * as SecureStore from "expo-secure-store";

import type { Hand } from "@/lib/training";

/**
 * What Training remembers, kept on the phone (like the guides' audience in
 * guide-audience.ts): which hand you play, your best score in each drill,
 * and how far you are through a plan. Nothing here is sent anywhere, and
 * nothing else in the app depends on it. A member who changes phone starts
 * their plan again — acceptable for a practice log; if it isn't, this is
 * the one file that moves to a table.
 */

const KEY = "pp_training_v1";

export type PlanProgress = { planId: string; startedAt: number; done: number[] };

export type TrainingState = {
  hand: "right" | "left";
  bests: Record<string, number>;
  plan: PlanProgress | null;
};

const EMPTY: TrainingState = { hand: "right", bests: {}, plan: null };

function parse(raw: string | null): TrainingState {
  if (!raw) return EMPTY;
  try {
    const v = JSON.parse(raw) as Partial<TrainingState>;
    return {
      hand: v.hand === "left" ? "left" : "right",
      bests: v.bests && typeof v.bests === "object" ? v.bests : {},
      plan: v.plan && typeof v.plan.planId === "string" && Array.isArray(v.plan.done) ? v.plan : null,
    };
  } catch {
    return EMPTY;
  }
}

let cache: TrainingState | null = null;
const listeners = new Set<(s: TrainingState) => void>();

async function load(): Promise<TrainingState> {
  if (cache) return cache;
  cache = parse(await SecureStore.getItemAsync(KEY).catch(() => null));
  return cache;
}

async function save(next: TrainingState): Promise<void> {
  cache = next;
  listeners.forEach((l) => l(next));
  await SecureStore.setItemAsync(KEY, JSON.stringify(next)).catch(() => undefined);
}

/** Training's saved state, shared by every screen that shows it. */
export function useTraining() {
  const [state, setState] = useState<TrainingState | null>(cache);

  useEffect(() => {
    let live = true;
    void load().then((s) => live && setState(s));
    const l = (s: TrainingState) => live && setState(s);
    listeners.add(l);
    return () => {
      live = false;
      listeners.delete(l);
    };
  }, []);

  const update = useCallback(async (fn: (s: TrainingState) => TrainingState) => {
    await save(fn(await load()));
  }, []);

  return {
    ready: state != null,
    hand: (state?.hand ?? "right") as Hand,
    bests: state?.bests ?? {},
    plan: state?.plan ?? null,
    setHand: (hand: Hand) => update((s) => ({ ...s, hand })),
    /** Keep a drill score if it beats the best so far (the caller decides "beats"). */
    setBest: (drillId: string, score: number) => update((s) => ({ ...s, bests: { ...s.bests, [drillId]: score } })),
    startPlan: (planId: string) => update((s) => ({ ...s, plan: { planId, startedAt: Date.now(), done: [] } })),
    stopPlan: () => update((s) => ({ ...s, plan: null })),
    toggleSession: (index: number) =>
      update((s) => {
        if (!s.plan) return s;
        const done = new Set(s.plan.done);
        if (done.has(index)) done.delete(index);
        else done.add(index);
        return { ...s, plan: { ...s.plan, done: [...done].sort((a, b) => a - b) } };
      }),
  };
}
