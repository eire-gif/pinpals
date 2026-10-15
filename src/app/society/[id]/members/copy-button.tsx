"use client";

import { useState } from "react";

import { buttonClass, type ButtonTone } from "@/components/society-console/forms";

/** Copies a value (the invite link, or the message with it) to the clipboard. */
export default function CopyButton({ value, label, tone = "primary" }: { value: string; label: string; tone?: ButtonTone }) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  return (
    <button
      type="button"
      className={buttonClass(tone, "sm")}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setState("done");
        } catch {
          setState("failed");
        }
        setTimeout(() => setState("idle"), 2000);
      }}
    >
      {state === "done" ? "Copied" : state === "failed" ? "Couldn't copy" : label}
    </button>
  );
}
