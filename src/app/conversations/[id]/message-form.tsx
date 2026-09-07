"use client";

import { useRef, useState } from "react";
import { MESSAGE_MAX_LENGTH, containsSensitiveData } from "@/lib/messaging";

/**
 * Purely presentational — ThreadView owns the actual send (optimistic
 * state, retry, the sendMessage() call itself); this just collects the text
 * and hands it up via `onSend`. The containsSensitiveData() check here is
 * the same client-side instant-feedback copy of validate_message_content()
 * (0049) that sendMessage() itself also runs — catching it here means a
 * bidder never even sees an optimistic "Sending…" bubble for a message the
 * server was always going to reject.
 */
export default function MessageForm({ onSend, disabled }: { onSend: (body: string) => void; disabled?: boolean }) {
  const [value, setValue] = useState("");
  const [warning, setWarning] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const body = value.trim();
    if (!body) return;
    const sensitive = containsSensitiveData(body);
    if (sensitive.blocked) {
      setWarning(sensitive.reason);
      return;
    }
    setWarning(null);
    onSend(body);
    setValue("");
    formRef.current?.reset();
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-2">
      <div className="flex items-end gap-2.5">
        <textarea
          name="body"
          required
          rows={2}
          maxLength={MESSAGE_MAX_LENGTH}
          placeholder={disabled ? "You can't message here right now" : "Write a message…"}
          disabled={disabled}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (warning) setWarning(null);
          }}
          className="flex-1 text-sm rounded-2xl border-[1.5px] border-line px-4 py-2.5 resize-none bg-surface disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={disabled || !value.trim()}
          className="shrink-0 px-5 py-2.5 rounded-full font-bold text-sm bg-green-700 text-cream-50 hover:bg-green-600 transition disabled:opacity-60"
        >
          Send
        </button>
      </div>
      {warning && <p className="text-xs text-red-600">{warning}</p>}
    </form>
  );
}
